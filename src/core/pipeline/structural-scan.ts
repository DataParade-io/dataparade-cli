import path from "path";

import type {
  DetectedDataFlow,
  FileInfo,
  LanguageParserStats,
  RawFinding,
  ScanConfiguration,
  ScanResult,
  TerraformScanSummary,
} from "../types";
import type { ServiceSection } from "../sectioning/discover-service-sections";
import { validateScanResult } from "../schema/scan-result.schema";
import {
  ingestFileSystem,
  resolveScanFilesystemEntry,
} from "../../ingest/file-system";
import { runAnalyzers } from "../../analyzers/registry";
import { buildTerraformModuleCallManifest } from "../../analyzers/terraform/terraform-module-manifest";
import {
  mergeTerraformShowJsonFindings,
  mergeTerraformShowJsonFromDoc,
} from "../../analyzers/terraform/terraform-show-json";
import { runTerraformShowJsonSync } from "../../analyzers/terraform/terraform-exec";
import { parsePythonModule } from "../../analyzers/python/parser";
import {
  detectPythonPatternsFromDependencyManifests,
} from "../../analyzers/python/dependency-manifests";
import {
  detectTypeScriptPatternsFromDependencyManifests,
} from "../../analyzers/typescript/dependency-manifests";
import {
  discoverServiceSections,
  tagFindingsWithServiceSections,
} from "../sectioning/discover-service-sections";
import { runClassifierPhase } from "./classifier-phase";
import { runDataFlowPhase } from "./dataflow-phase";
import {
  sortComponentsDeterministically,
  sortDataFlowsDeterministically,
} from "./sorting";
import { DEFAULT_EXCLUDED_FILE_GLOBS } from "../../patterns/scan-exclusions";
import { resolvePathUnderScanRoot } from "./resolve-path-under-scan-root";

function patternToRegex(pattern: string): RegExp {
  // Very small subset of .gitignore-style patterns:
  // - * matches any chars except path separator
  // - ** matches across directories
  // - ? matches a single non-separator
  let escaped = pattern.replace(/[-\\^$+?.()|[\]{}*?]/g, "\\$&");

  // Restore globs
  escaped = escaped.replace(/\\\*\\\*/g, ".*"); // **
  escaped = escaped.replace(/\\\*/g, "[^/]*"); // *
  escaped = escaped.replace(/\\\?/g, "[^/]"); // ?

  return new RegExp(`^${escaped}$`);
}

export interface StructuralScanPhaseResult {
  files: FileInfo[];
  findings: RawFinding[];
  sections: ServiceSection[];
  monorepoPackageSectionPathDepth?: number;
  filesScanned: number;
  totalLines: number;
  languageStats: LanguageParserStats[];
  terraformScanSummary?: TerraformScanSummary;
}

export interface StructuralScanResult {
  scanResult: ScanResult;
  files: FileInfo[];
  findings: RawFinding[];
}

export async function runStructuralScanPhase(
  rootPath: string,
  config: ScanConfiguration,
  onWarning?: (warning: string) => void,
): Promise<StructuralScanPhaseResult> {
  const warn = (warning: string) => {
    if (onWarning) onWarning(warning);
  };

  const { scanRootDir, ingestTarget } =
    await resolveScanFilesystemEntry(rootPath);

  const allFiles = await ingestFileSystem(ingestTarget, {
    onWarning: warn,
    excludePaths: config.excludePaths,
  });

  // Apply language filtering and excludePaths from configuration.
  let files = allFiles;

  if (config.languages && config.languages.length > 0) {
    const allowed = new Set(config.languages);
    files = files.filter((file) => allowed.has(file.language));
  }

  if (config.excludePaths && config.excludePaths.length > 0) {
    const regexes = config.excludePaths.map((pattern) => patternToRegex(pattern));
    files = files.filter((file) => !regexes.some((regex) => regex.test(file.path)));
  }

  const filesScanned = files.length;
  const totalLines = files.reduce((sum, file) => {
    if (!file.content) return sum;
    return sum + file.content.split(/\r?\n/g).length;
  }, 0);

  const languageStats: LanguageParserStats[] = [];

  // Python parser stats (DP-P0-CLI-702):
  const pythonFiles = files.filter((file) => file.language === "python");
  if (pythonFiles.length > 0) {
    let functionsIndexed = 0;
    let moduleLevelCallsIndexed = 0;
    const parserWarnings: string[] = [];

    for (const file of pythonFiles) {
      try {
        const moduleModel = parsePythonModule(file);
        functionsIndexed += moduleModel.functions.length;
        moduleLevelCallsIndexed += moduleModel.moduleLevelCalls.length;
        if (moduleModel.warnings.length > 0) {
          parserWarnings.push(
            ...moduleModel.warnings.map((w) => `python-parser (${file.path}): ${w}`),
          );
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error in Python parser.";
        parserWarnings.push(`python-parser (${file.path}): ${message}`);
      }
    }

    for (const warning of parserWarnings) warn(warning);

    languageStats.push({
      language: "python",
      filesParsed: pythonFiles.length,
      functionsIndexed,
      moduleLevelCallsIndexed,
      warnings: parserWarnings,
    });
  }

  const minimumConfidence = config.minimumConfidence;
  const tfFiles = files.filter((f) => f.language === "terraform");
  const terraformModuleManifest =
    tfFiles.length > 0
      ? buildTerraformModuleCallManifest(scanRootDir, files)
      : undefined;
  let findings = runAnalyzers(files, {
    terraformModuleManifest,
    terraformScanRootPath: scanRootDir,
  });

  const staticTfFiles = files.filter((f) => f.language === "terraform").length;
  const jsonInputParts: string[] = [];
  let jsonFindingsMerged = 0;

  const planRel = config.terraformPlanPath?.trim();
  if (planRel) {
    const planResolved = resolvePathUnderScanRoot(scanRootDir, planRel);
    if (!planResolved.ok) {
      warn(`terraform-plan: ${planResolved.message}`);
    } else {
      const scanRoot = path.resolve(scanRootDir);
      const planArg = path.relative(scanRoot, planResolved.resolved);
      const execRes = runTerraformShowJsonSync(scanRootDir, planArg);
      if (execRes.ok) {
        const label = `terraform show -json (${planRel})`;
        const merged = mergeTerraformShowJsonFromDoc(
          findings,
          execRes.doc,
          label,
          warn,
        );
        findings.push(...merged.findings);
        jsonFindingsMerged += merged.mergedCount;
        jsonInputParts.push(`plan:${planRel}`);
      } else {
        warn(`terraform-plan: ${execRes.message}`);
      }
    }
  }

  const jsonPath = config.terraformJsonPath?.trim();
  if (jsonPath) {
    const jsonResolved = resolvePathUnderScanRoot(scanRootDir, jsonPath);
    if (!jsonResolved.ok) {
      warn(`terraform-json: ${jsonResolved.message}`);
    } else {
      const merged = mergeTerraformShowJsonFindings(
        findings,
        jsonResolved.resolved,
        warn,
      );
      findings.push(...merged.findings);
      jsonFindingsMerged += merged.mergedCount;
      jsonInputParts.push(jsonResolved.resolved);
    }
  }

  if (planRel && jsonPath) {
    warn(
      "terraform: both terraformPlanPath and terraformJsonPath are set; plan overlay is applied first, then the JSON file.",
    );
  }

  const terraformScanSummary = buildTerraformScanSummary({
    staticTfFiles,
    jsonFindingsMerged,
    jsonInputParts,
    hadPlanOption: Boolean(planRel),
    hadJsonFileOption: Boolean(jsonPath),
  });

  // Language-agnostic third-party service detection from Python dependency manifests.
  if (!config.languages || config.languages.includes("python")) {
    try {
      findings.push(
        ...(await detectPythonPatternsFromDependencyManifests(scanRootDir, {
          onWarning: warn,
          excludePaths: config.excludePaths,
        })),
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error parsing manifests.";
      warn(`python-manifests: ${message}`);
    }
  }

  // Language-agnostic third-party service detection from Node/TypeScript manifests.
  const wantsTsOrJs =
    !config.languages ||
    config.languages.some((l) => l === "typescript" || l === "javascript");
  if (wantsTsOrJs) {
    try {
      findings.push(
        ...(await detectTypeScriptPatternsFromDependencyManifests(scanRootDir, {
          onWarning: warn,
          excludePaths: config.excludePaths,
        })),
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unknown error parsing package manifests.";
      warn(`package-manifests: ${message}`);
    }
  }

  // Apply detection feature toggles from configuration.
  if (!config.enableAPIDetection) {
    findings = findings.filter(
      (f) => f.pattern !== "express_route" && f.pattern !== "auth_middleware",
    );
  }
  if (!config.enableDatabaseDetection) {
    findings = findings.filter((f) => f.pattern !== "database_connection");
  }
  findings = findings.filter((f) => f.confidence >= minimumConfidence);

  // Discover monorepo service sections and tag findings.
  const {
    sections,
    inferredTerraformStackSectionPathDepth,
    inferredMonorepoPackageSectionPathDepth,
    monorepoPackageSectionPathDepth: discoveredMonorepoDepth,
  } = await discoverServiceSections(scanRootDir, {
    excludePaths: config.excludePaths,
    terraformStackSectionPathDepth: config.terraformStackSectionPathDepth,
    autoInferTerraformStackSectionPathDepth:
      config.autoInferTerraformStackSectionPathDepth,
    monorepoPackageSectionPathDepth: config.monorepoPackageSectionPathDepth,
    autoInferMonorepoPackageSectionPathDepth:
      config.autoInferMonorepoPackageSectionPathDepth,
  });
  if (inferredTerraformStackSectionPathDepth != null) {
    warn(
      `terraform: registered stack sections at path depth ${inferredTerraformStackSectionPathDepth} (from .tf layout)`,
    );
  }
  if (inferredMonorepoPackageSectionPathDepth != null) {
    warn(
      `monorepo: grouping workspace packages at path depth ${inferredMonorepoPackageSectionPathDepth} (from package.json layout)`,
    );
  }
  const monorepoPackageSectionPathDepth =
    discoveredMonorepoDepth ??
    config.monorepoPackageSectionPathDepth ??
    inferredMonorepoPackageSectionPathDepth;
  tagFindingsWithServiceSections(findings, sections, {
    monorepoPackageSectionPathDepth,
  });

  return {
    files,
    findings,
    sections,
    monorepoPackageSectionPathDepth,
    filesScanned,
    totalLines,
    languageStats,
    terraformScanSummary,
  };
}

function buildTerraformScanSummary(input: {
  staticTfFiles: number;
  jsonFindingsMerged: number;
  jsonInputParts: string[];
  hadPlanOption: boolean;
  hadJsonFileOption: boolean;
}): TerraformScanSummary | undefined {
  const hadJsonInputs =
    input.jsonInputParts.length > 0 ||
    input.hadPlanOption ||
    input.hadJsonFileOption;
  if (
    input.staticTfFiles === 0 &&
    input.jsonFindingsMerged === 0 &&
    !hadJsonInputs
  ) {
    return undefined;
  }

  let mode: TerraformScanSummary["mode"];
  if (input.staticTfFiles > 0 && input.jsonFindingsMerged > 0) {
    mode = "json_overlay";
  } else if (input.staticTfFiles > 0) {
    mode = "static_tf";
  } else {
    mode = "json_only";
  }

  return {
    mode,
    staticTfFiles: input.staticTfFiles,
    jsonInputPath:
      input.jsonInputParts.length > 0
        ? input.jsonInputParts.join("; ")
        : undefined,
    jsonFindingsMerged: input.jsonFindingsMerged,
  };
}

export async function runStructuralScan(
  rootPath: string,
): Promise<StructuralScanResult> {
  const config: ScanConfiguration = {
    projectName: undefined,
    excludePaths: [...DEFAULT_EXCLUDED_FILE_GLOBS],
    enableAPIDetection: true,
    enableDatabaseDetection: true,
    enableDataFlowDetection: true,
    languages: undefined,
    minimumConfidence: 0.5,
    deepAnalysis: false,
  };
  const warnings: string[] = [];
  const errors: string[] = [];
  const start = Date.now();

  const structural = await runStructuralScanPhase(
    rootPath,
    config,
    (warning) => warnings.push(warning),
  );
  const {
    files,
    findings,
    sections,
    monorepoPackageSectionPathDepth,
    filesScanned,
    totalLines,
    languageStats,
    terraformScanSummary,
  } = structural;

  const components = runClassifierPhase(findings, sections, {
    projectName: "project",
    minimumConfidence: config.minimumConfidence,
  });

  let dataFlows: DetectedDataFlow[] = [];
  try {
    dataFlows = runDataFlowPhase(files, components, findings, sections, {
      enableDataFlowDetection: config.enableDataFlowDetection,
      minimumConfidence: config.minimumConfidence,
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Unknown error during data-flow detection.";
    errors.push(`data-flow: ${message}`);
  }

  sortComponentsDeterministically(components);
  sortDataFlowsDeterministically(dataFlows);

  const scanResult: ScanResult = {
    components,
    dataFlows,
    filesScanned,
    filesSkipped: 0,
    totalLines,
    scanDurationMs: Date.now() - start,
    warnings,
    errors,
    languageStats: languageStats.length > 0 ? languageStats : undefined,
    terraformScanSummary,
  };

  const validation = validateScanResult(scanResult);
  if (!validation.ok) {
    errors.push(...validation.errors);
    scanResult.errors = errors;
  }

  return {
    scanResult,
    files,
    findings,
  };
}

