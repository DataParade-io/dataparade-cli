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
import { parseComposerJson } from "./manifest-parsers";

function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}

export interface PhpManifestPackages {
  manifestRelativePath: string;
  /** The package's own name from composer.json `name`. */
  packageName?: string;
  packages: string[];
}

function createManifestFileInfo(manifestRelativePath: string): FileInfo {
  return {
    path: manifestRelativePath,
    name: path.basename(manifestRelativePath),
    content: "",
    language: "php",
    size: 0,
  };
}

export async function parsePhpDependencyManifests(
  rootPath: string,
  opts?: ManifestScanBudgetOptions,
): Promise<PhpManifestPackages[]> {
  const rootDir = path.resolve(rootPath);
  const manifests: string[] = [];

  const state = budgetStateFromOptions(opts);
  await walkForManifests(rootDir, manifests, {
    rootDir,
    state,
    excludePaths: opts?.excludePaths,
    isManifestFile: (_entry, entryPath) =>
      path.basename(entryPath).toLowerCase() === "composer.json",
  });

  const byManifest: PhpManifestPackages[] = [];

  let bytesRead = 0;
  const maxBytes = state.maxTotalManifestReadBytes;

  for (const manifestAbsPath of manifests) {
    if (bytesRead >= maxBytes) break;

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

    const parsed = parseComposerJson(raw);
    if (parsed.packages.length === 0) continue;

    byManifest.push({
      manifestRelativePath,
      packageName: parsed.name,
      packages: Array.from(new Set(parsed.packages)),
    });
  }

  return byManifest;
}

export async function detectPhpPatternsFromDependencyManifests(
  rootPath: string,
  opts?: ManifestScanBudgetOptions,
): Promise<RawFinding[]> {
  const manifestPackages = await parsePhpDependencyManifests(rootPath, opts);
  if (manifestPackages.length === 0) return [];

  const findings: RawFinding[] = [];

  for (const manifest of manifestPackages) {
    const manifestFile = createManifestFileInfo(manifest.manifestRelativePath);
    const imports = manifest.packages.map((p) => {
      const segments = p.split("/").filter(Boolean);
      return {
        module: p,
        names: Array.from(new Set([p, ...segments])),
      };
    });

    findings.push(
      ...matchPatterns({
        language: "php",
        file: manifestFile,
        normalizedPath: manifestFile.path,
        imports,
      }),
    );
  }

  return findings;
}
