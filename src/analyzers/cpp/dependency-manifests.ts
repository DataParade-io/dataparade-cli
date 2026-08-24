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
  extractPackagesFromCMakeLists,
  extractPackagesFromConanfile,
  extractPackagesFromVcpkgJson,
} from "./manifest-parsers";

function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}

export interface CppManifestPackages {
  manifestRelativePath: string;
  packages: string[];
}

function createManifestFileInfo(manifestRelativePath: string): FileInfo {
  return {
    path: manifestRelativePath,
    name: path.basename(manifestRelativePath),
    content: "",
    language: "cpp",
    size: 0,
  };
}

function isCppManifestName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === "vcpkg.json" ||
    lower === "conanfile.txt" ||
    lower === "conanfile.py" ||
    lower === "cmakelists.txt"
  );
}

export async function parseCppDependencyManifests(
  rootPath: string,
  opts?: ManifestScanBudgetOptions,
): Promise<CppManifestPackages[]> {
  const rootDir = path.resolve(rootPath);
  const manifests: string[] = [];

  const state = budgetStateFromOptions(opts);
  await walkForManifests(rootDir, manifests, {
    rootDir,
    state,
    excludePaths: opts?.excludePaths,
    isManifestFile: (_entry, entryPath) =>
      isCppManifestName(path.basename(entryPath)),
  });

  const byManifest: CppManifestPackages[] = [];

  let bytesRead = 0;
  const maxBytes = state.maxTotalManifestReadBytes;

  for (const manifestAbsPath of manifests) {
    if (bytesRead >= maxBytes) break;

    const lower = path.basename(manifestAbsPath).toLowerCase();
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

    let packages: string[] = [];
    if (lower === "vcpkg.json") {
      packages = extractPackagesFromVcpkgJson(raw);
    } else if (lower === "conanfile.txt" || lower === "conanfile.py") {
      packages = extractPackagesFromConanfile(raw);
    } else if (lower === "cmakelists.txt") {
      packages = extractPackagesFromCMakeLists(raw);
    }

    if (packages.length === 0) continue;

    byManifest.push({
      manifestRelativePath,
      packages: Array.from(new Set(packages)),
    });
  }

  return byManifest;
}

export async function detectCppPatternsFromDependencyManifests(
  rootPath: string,
  opts?: ManifestScanBudgetOptions,
): Promise<RawFinding[]> {
  const manifestPackages = await parseCppDependencyManifests(rootPath, opts);
  if (manifestPackages.length === 0) return [];

  const findings: RawFinding[] = [];

  for (const manifest of manifestPackages) {
    const manifestFile = createManifestFileInfo(manifest.manifestRelativePath);
    const imports = manifest.packages.map((p) => ({
      module: p,
      names: Array.from(new Set([p, p.toLowerCase()])),
    }));

    findings.push(
      ...matchPatterns({
        language: "cpp",
        file: manifestFile,
        normalizedPath: manifestFile.path,
        imports,
      }),
    );
  }

  return findings;
}
