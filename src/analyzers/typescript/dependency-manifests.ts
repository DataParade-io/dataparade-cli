import { promises as fs } from "fs";
import path from "path";

import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import { matchPatterns } from "../../patterns/engine";
import {
  type ManifestScanBudgetOptions,
  budgetStateFromOptions,
} from "../shared/manifest-budgets";
import { walkForManifests } from "../shared/manifest-fs";
import { extractPackagesFromPackageJsonObject } from "./manifest-parsers";

function normalizePosix(p: string): string {
  return p.split(path.sep).join("/");
}

export interface TypeScriptManifestPackages {
  manifestRelativePath: string;
  packages: string[];
  packageName?: string;
}

const FRONTEND_FRAMEWORKS_BY_PACKAGE: ReadonlyArray<{
  packageName: string;
  framework: string;
}> = [
  { packageName: "next", framework: "nextjs" },
  { packageName: "react", framework: "react" },
  { packageName: "vue", framework: "vue" },
  { packageName: "@angular/core", framework: "angular" },
  { packageName: "svelte", framework: "svelte" },
  { packageName: "solid-js", framework: "solid" },
  { packageName: "@builder.io/qwik", framework: "qwik" },
  { packageName: "@ionic/react", framework: "ionic" },
  { packageName: "electron", framework: "electron" },
];

function inferFrontendFrameworkFromPackages(packages: string[]): string | undefined {
  const packageSet = new Set(packages.map((p) => p.toLowerCase()));
  const matched = FRONTEND_FRAMEWORKS_BY_PACKAGE.find((entry) =>
    packageSet.has(entry.packageName),
  );
  return matched?.framework;
}

export async function parseTypeScriptDependencyManifests(
  rootPath: string,
  opts?: ManifestScanBudgetOptions,
): Promise<TypeScriptManifestPackages[]> {
  const rootDir = path.resolve(rootPath);
  const manifests: string[] = [];

  const state = budgetStateFromOptions(opts);
  await walkForManifests(rootDir, manifests, {
    rootDir,
    state,
    excludePaths: opts?.excludePaths,
    isManifestFile: (entry) => entry.isFile() && entry.name === "package.json",
  });

  const byManifest: TypeScriptManifestPackages[] = [];

  let bytesRead = 0;
  const maxBytes = state.maxTotalManifestReadBytes;
  for (const manifestAbsPath of manifests) {
    if (bytesRead >= maxBytes) break;
    const manifestRelativePath = normalizePosix(
      path.relative(rootDir, manifestAbsPath),
    );

    const raw = await fs.readFile(manifestAbsPath, "utf8").catch(() => "");
    bytesRead += raw.length;
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw) as unknown;
      const packages = extractPackagesFromPackageJsonObject(parsed);
      if (packages.length === 0) continue;
      const packageName =
        typeof (parsed as { name?: unknown }).name === "string"
          ? ((parsed as { name?: string }).name ?? "").trim()
          : "";

      byManifest.push({
        manifestRelativePath,
        packages,
        packageName: packageName || undefined,
      });
    } catch {
      // Ignore malformed package.json files.
    }
  }

  return byManifest;
}

function createManifestFileInfo(
  manifestRelativePath: string,
): FileInfo {
  const fileInfo: FileInfo = {
    path: manifestRelativePath,
    name: path.basename(manifestRelativePath),
    content: "",
    language: "typescript", // ensures language-specific detectors behave consistently
    size: 0,
  };

  return fileInfo;
}

export async function detectTypeScriptPatternsFromDependencyManifests(
  rootPath: string,
  opts?: ManifestScanBudgetOptions,
): Promise<RawFinding[]> {
  const manifestPackages = await parseTypeScriptDependencyManifests(
    rootPath,
    opts,
  );
  if (manifestPackages.length === 0) return [];

  const findings: RawFinding[] = [];

  for (const manifest of manifestPackages) {
    const manifestFile = createManifestFileInfo(manifest.manifestRelativePath);
    const imports = manifest.packages.map((p) => ({
      module: p,
      names: [p],
    }));

    const manifestFindings = matchPatterns({
      language: manifestFile.language,
      file: manifestFile,
      normalizedPath: manifestFile.path,
      imports,
    });
    findings.push(
      ...manifestFindings.map((finding) => ({
        ...finding,
        properties: {
          ...finding.properties,
          sourceContext: "dependency_manifest",
          packageName: manifest.packageName,
        },
      })),
    );

    const frontendFramework = inferFrontendFrameworkFromPackages(manifest.packages);
    if (frontendFramework) {
      findings.push({
        pattern: "express_route",
        name: "Frontend Application",
        confidence: 0.75,
        location: {
          filePath: manifestFile.path,
          startLine: 1,
          endLine: 1,
        },
        properties: {
          framework: frontendFramework,
          sourceContext: "dependency_manifest",
          packageName: manifest.packageName,
          httpMethods: [],
          path: undefined,
        },
      });
    }
  }

  return findings;
}

