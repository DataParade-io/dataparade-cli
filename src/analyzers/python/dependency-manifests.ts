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
  extractPackagesFromPipfile,
  extractPackagesFromPyprojectToml,
  extractPackagesFromRequirementsTxt,
} from "./manifest-parsers";

function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}

export interface PythonManifestPackages {
  manifestRelativePath: string;
  packages: string[];
}

function createManifestFileInfo(manifestRelativePath: string): FileInfo {
  return {
    path: manifestRelativePath,
    name: path.basename(manifestRelativePath),
    content: "",
    language: "python",
    size: 0,
  };
}

export async function parsePythonDependencyManifests(
  rootPath: string,
  opts?: ManifestScanBudgetOptions,
): Promise<PythonManifestPackages[]> {
  const rootDir = path.resolve(rootPath);
  const manifests: string[] = [];

  const state = budgetStateFromOptions(opts);
  await walkForManifests(rootDir, manifests, {
    rootDir,
    state,
    excludePaths: opts?.excludePaths,
    isManifestFile: (_entry, entryPath) => {
      const name = path.basename(entryPath);
      const lower = name.toLowerCase();
      const isRequirements =
        lower.startsWith("requirements") && lower.endsWith(".txt");
      const isPyproject = lower === "pyproject.toml";
      const isPipfile = name === "Pipfile";
      return isRequirements || isPyproject || isPipfile;
    },
  });

  const byManifest: PythonManifestPackages[] = [];

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
    if (lower.startsWith("requirements") && lower.endsWith(".txt")) {
      packages = extractPackagesFromRequirementsTxt(raw);
    } else if (lower === "pyproject.toml") {
      packages = extractPackagesFromPyprojectToml(raw);
    } else if (path.basename(manifestAbsPath).toLowerCase() === "pipfile") {
      packages = extractPackagesFromPipfile(raw);
    }

    // Skip empty manifests to avoid generating empty matchPatterns runs.
    if (packages.length === 0) continue;

    byManifest.push({
      manifestRelativePath,
      packages: Array.from(new Set(packages)),
    });
  }

  return byManifest;
}

export async function detectPythonPatternsFromDependencyManifests(
  rootPath: string,
  opts?: ManifestScanBudgetOptions,
): Promise<RawFinding[]> {
  const manifestPackages = await parsePythonDependencyManifests(rootPath, opts);
  if (manifestPackages.length === 0) return [];

  const findings: RawFinding[] = [];

  for (const manifest of manifestPackages) {
    const manifestFile = createManifestFileInfo(manifest.manifestRelativePath);
    const imports = manifest.packages.map((p) => ({
      module: p,
      names: [p],
    }));

    findings.push(
      ...matchPatterns({
        language: "python",
        file: manifestFile,
        normalizedPath: manifestFile.path,
        imports,
      }),
    );
  }

  return findings;
}

