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
import { parseGoMod } from "./manifest-parsers";

function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}

export interface GoManifestPackages {
  manifestRelativePath: string;
  /** The module's own path, from the `module` declaration. */
  modulePath?: string;
  packages: string[];
}

function createManifestFileInfo(manifestRelativePath: string): FileInfo {
  return {
    path: manifestRelativePath,
    name: path.basename(manifestRelativePath),
    content: "",
    language: "go",
    size: 0,
  };
}

export async function parseGoDependencyManifests(
  rootPath: string,
  opts?: ManifestScanBudgetOptions,
): Promise<GoManifestPackages[]> {
  const rootDir = path.resolve(rootPath);
  const manifests: string[] = [];

  const state = budgetStateFromOptions(opts);
  await walkForManifests(rootDir, manifests, {
    rootDir,
    state,
    excludePaths: opts?.excludePaths,
    isManifestFile: (_entry, entryPath) =>
      path.basename(entryPath).toLowerCase() === "go.mod",
  });

  const byManifest: GoManifestPackages[] = [];

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

    const parsed = parseGoMod(raw);
    if (parsed.requires.length === 0) continue;

    byManifest.push({
      manifestRelativePath,
      modulePath: parsed.modulePath,
      packages: Array.from(new Set(parsed.requires)),
    });
  }

  return byManifest;
}

export async function detectGoPatternsFromDependencyManifests(
  rootPath: string,
  opts?: ManifestScanBudgetOptions,
): Promise<RawFinding[]> {
  const manifestPackages = await parseGoDependencyManifests(rootPath, opts);
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
        language: "go",
        file: manifestFile,
        normalizedPath: manifestFile.path,
        imports,
      }),
    );
  }

  return findings;
}
