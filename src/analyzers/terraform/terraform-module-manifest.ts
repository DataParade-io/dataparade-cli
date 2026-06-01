import path from "path";

import type { FileInfo } from "../../core/types/file";
import { loadTerraformPatternConfig } from "./terraform-detection-config";
import { parseTerraformFile } from "./parser";

export interface TerraformModuleCallManifest {
  /**
   * Module source directory relative to scan root (posix, no trailing slash)
   * → Terraform module instance addresses declared in HCL (e.g. `module.vpc`).
   */
  instancesByModuleSourceDir: Map<string, string[]>;
}

const MODULE_SOURCE_LINE = /^\s*source\s*=\s*"([^"]+)"\s*$/m;

function posix(p: string): string {
  return p.replace(/\\/g, "/");
}

function isFilesystemModuleSource(source: string): boolean {
  const s = source.trim();
  if (!s) return false;
  return s.startsWith(".") || s.startsWith("/") || s.startsWith("..");
}

/**
 * Walk all Terraform files, parse `module` blocks, and index which HCL module
 * instance addresses (`module.foo`) target which on-disk module directory
 * (relative to the scan root). Used to qualify resource addresses inside
 * shared module sources so references and provider flows line up with root
 * `module.*` calls.
 */
export function buildTerraformModuleCallManifest(
  scanRootPath: string,
  files: FileInfo[],
): TerraformModuleCallManifest {
  const rootAbs = path.resolve(scanRootPath);
  const instancesByModuleSourceDir = new Map<string, string[]>();
  const config = loadTerraformPatternConfig();

  for (const file of files) {
    if (file.language !== "terraform") continue;

    const { blocks } = parseTerraformFile(file, config);
    const fromDirAbs = path.resolve(rootAbs, path.dirname(file.path));

    for (const block of blocks) {
      if (block.kind !== "module") continue;
      const srcMatch = MODULE_SOURCE_LINE.exec(block.bodyText);
      if (!srcMatch) continue;
      const sourceRaw = srcMatch[1]?.trim();
      if (!sourceRaw || !isFilesystemModuleSource(sourceRaw)) continue;

      const moduleSourceAbs = path.resolve(fromDirAbs, sourceRaw);
      const relDir = posix(path.relative(rootAbs, moduleSourceAbs));
      if (!relDir || relDir.startsWith("..")) continue;

      const fq = block.address;
      if (!fq.startsWith("module.")) continue;

      const list = instancesByModuleSourceDir.get(relDir) ?? [];
      list.push(fq);
      instancesByModuleSourceDir.set(relDir, list);
    }
  }

  for (const [k, v] of instancesByModuleSourceDir) {
    instancesByModuleSourceDir.set(
      k,
      Array.from(new Set(v)).sort((a, b) => a.localeCompare(b)),
    );
  }

  return { instancesByModuleSourceDir };
}

/** Directory of `filePath` relative to scan root (posix). */
export function terraformModuleDirKeyRelativeToRoot(
  scanRootPath: string,
  filePath: string,
): string {
  const rootAbs = path.resolve(scanRootPath);
  const dirAbs = path.resolve(rootAbs, path.dirname(filePath));
  return posix(path.relative(rootAbs, dirAbs));
}

export function moduleInstancePrefixesForFile(
  manifest: TerraformModuleCallManifest | undefined,
  scanRootPath: string,
  filePath: string,
): string[] {
  if (!manifest) return [];
  const dirKey = terraformModuleDirKeyRelativeToRoot(scanRootPath, filePath);
  return manifest.instancesByModuleSourceDir.get(dirKey) ?? [];
}
