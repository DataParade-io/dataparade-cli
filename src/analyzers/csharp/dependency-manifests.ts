import fs from "fs/promises";
import * as path from "path";

import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import { matchPatterns } from "../../patterns/engine";
import {
  type ManifestScanBudgetOptions,
  budgetStateFromOptions,
} from "../shared/manifest-budgets";
import { walkForManifests } from "../shared/manifest-fs";
import {
  extractConnectionStringsFromAppSettings,
  extractPackagesFromPackagesConfig,
  extractPackagesFromPaketDependencies,
  extractPackagesFromProjectFile,
} from "./manifest-parsers";

function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}

export interface DotnetManifestPackages {
  manifestRelativePath: string;
  packages: string[];
}

const PROJECT_FILE_EXTENSIONS = [".csproj", ".fsproj", ".vbproj"];

function createManifestFileInfo(manifestRelativePath: string): FileInfo {
  return {
    path: manifestRelativePath,
    name: path.basename(manifestRelativePath),
    content: "",
    language: "csharp",
    size: 0,
  };
}

function isProjectManifestName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    PROJECT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext)) ||
    lower === "directory.packages.props" ||
    lower === "directory.build.props" ||
    lower === "packages.config" ||
    lower === "paket.dependencies"
  );
}

function isAppSettingsName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("appsettings") && lower.endsWith(".json");
}

function extractPackages(manifestName: string, raw: string): string[] {
  const lower = manifestName.toLowerCase();

  if (lower === "packages.config") {
    return extractPackagesFromPackagesConfig(raw);
  }
  if (lower === "paket.dependencies") {
    return extractPackagesFromPaketDependencies(raw);
  }
  return extractPackagesFromProjectFile(raw);
}

export async function parseDotnetDependencyManifests(
  rootPath: string,
  opts?: ManifestScanBudgetOptions,
): Promise<DotnetManifestPackages[]> {
  const rootDir = path.resolve(rootPath);
  const manifests: string[] = [];

  const state = budgetStateFromOptions(opts);
  await walkForManifests(rootDir, manifests, {
    rootDir,
    state,
    excludePaths: opts?.excludePaths,
    isManifestFile: (_entry, entryPath) =>
      isProjectManifestName(path.basename(entryPath)),
  });

  const byManifest: DotnetManifestPackages[] = [];

  let bytesRead = 0;
  const maxBytes = state.maxTotalManifestReadBytes;

  for (const manifestAbsPath of manifests) {
    if (bytesRead >= maxBytes) break;

    const manifestName = path.basename(manifestAbsPath);
    const manifestRelativePath = toPosixPath(
      path.relative(rootDir, manifestAbsPath),
    );

    let raw: string;
    try {
      raw = await fs.readFile(manifestAbsPath, "utf8");
    } catch {
      continue;
    }
    bytesRead += raw.length;

    const packages = extractPackages(manifestName, raw);
    if (packages.length === 0) continue;

    byManifest.push({
      manifestRelativePath,
      packages: Array.from(new Set(packages)),
    });
  }

  return byManifest;
}

/**
 * Third-party service detection from .NET project manifests, plus the
 * `ConnectionStrings` declared in `appsettings*.json` — often the only place a
 * .NET service names the databases it talks to.
 */
export async function detectDotnetPatternsFromManifests(
  rootPath: string,
  opts?: ManifestScanBudgetOptions,
): Promise<RawFinding[]> {
  const findings: RawFinding[] = [];

  const manifestPackages = await parseDotnetDependencyManifests(rootPath, opts);
  for (const manifest of manifestPackages) {
    const manifestFile = createManifestFileInfo(manifest.manifestRelativePath);
    const imports = manifest.packages.map((p) => ({
      module: p,
      names: Array.from(new Set([p, p.toLowerCase()])),
    }));

    findings.push(
      ...matchPatterns({
        language: "csharp",
        file: manifestFile,
        normalizedPath: manifestFile.path,
        imports,
      }),
    );
  }

  findings.push(...(await detectAppSettingsConnectionStrings(rootPath, opts)));

  return findings;
}

async function detectAppSettingsConnectionStrings(
  rootPath: string,
  opts?: ManifestScanBudgetOptions,
): Promise<RawFinding[]> {
  const rootDir = path.resolve(rootPath);
  const appSettingsFiles: string[] = [];

  const state = budgetStateFromOptions(opts);
  await walkForManifests(rootDir, appSettingsFiles, {
    rootDir,
    state,
    excludePaths: opts?.excludePaths,
    isManifestFile: (_entry, entryPath) =>
      isAppSettingsName(path.basename(entryPath)),
  });

  const findings: RawFinding[] = [];

  for (const absPath of appSettingsFiles) {
    const relativePath = toPosixPath(path.relative(rootDir, absPath));

    let raw: string;
    try {
      raw = await fs.readFile(absPath, "utf8");
    } catch {
      continue;
    }

    findings.push({
      pattern: "config_file",
      name: path.basename(relativePath),
      confidence: 0.9,
      location: { filePath: relativePath, startLine: 1, endLine: 1 },
      properties: {},
    });

    for (const connection of extractConnectionStringsFromAppSettings(raw)) {
      findings.push({
        pattern: "database_connection",
        name: connection.name,
        confidence: 0.85,
        location: { filePath: relativePath, startLine: 1, endLine: 1 },
        properties: {
          client: "appsettings_connection_string",
          databaseType: connection.databaseType,
          key: connection.name,
        },
      });
    }
  }

  return findings;
}
