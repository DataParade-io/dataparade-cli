import type { FileInfo, FileLanguage } from "../core/types/file";
import type { RawFinding } from "../core/types/detection";
import type { Analyzer } from "./types";
import { ingestFileSystem } from "../ingest/file-system";
import { createPythonAnalyzer } from "./python";
import { createTerraformAnalyzer } from "./terraform";
import { createTypeScriptAnalyzer } from "./typescript";
import { loadTerraformPatternConfig } from "./terraform/terraform-detection-config";
import { detectTerraformPatterns } from "./terraform/detector";
import type { TerraformModuleCallManifest } from "./terraform/terraform-module-manifest";

const typeScriptAnalyzer = createTypeScriptAnalyzer();
const pythonAnalyzer = createPythonAnalyzer();
const terraformAnalyzer = createTerraformAnalyzer();

const registry = new Map<FileLanguage, Analyzer>([
  ["python", pythonAnalyzer],
  ["terraform", terraformAnalyzer],
  ["typescript", typeScriptAnalyzer],
  ["javascript", typeScriptAnalyzer],
]);

export interface RunAnalyzersOptions {
  terraformModuleManifest?: TerraformModuleCallManifest;
  terraformScanRootPath?: string;
}

export function registerAnalyzer(
  language: FileLanguage,
  analyzer: Analyzer,
): void {
  registry.set(language, analyzer);
}

export function getAnalyzerForFile(file: FileInfo): Analyzer | undefined {
  return registry.get(file.language);
}

export function runAnalyzers(
  files: FileInfo[],
  opts?: RunAnalyzersOptions,
): RawFinding[] {
  const findings: RawFinding[] = [];
  const tfConfig = loadTerraformPatternConfig();
  const tfOpts =
    opts?.terraformModuleManifest && opts.terraformScanRootPath
      ? {
          manifest: opts.terraformModuleManifest,
          scanRootPath: opts.terraformScanRootPath,
        }
      : undefined;

  for (const file of files) {
    if (file.language === "terraform") {
      findings.push(...detectTerraformPatterns(file, tfConfig, tfOpts));
      continue;
    }

    const analyzer = registry.get(file.language);
    if (!analyzer) continue;

    const result = analyzer.detect(file);
    if (Array.isArray(result) && result.length > 0) {
      findings.push(...result);
    }
  }

  return findings;
}

export async function runAnalyzersForRootPath(
  rootPath: string,
): Promise<RawFinding[]> {
  const files = await ingestFileSystem(rootPath);
  return runAnalyzers(files);
}

// Test-only helper to avoid cross-test pollution.
export function __clearAnalyzersForTest(): void {
  registry.clear();
}

