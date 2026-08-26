import fs from "fs";
import path from "path";
import { execSync } from "child_process";

import type { BenchmarkManifest } from "./schema";
import { isMaterializationComplete, readHeadSafely } from "./materialize-paths";
import { readSparseCheckoutContent } from "./materialize-orchestrator";

export class MaterializationInvalidError extends Error {
  readonly repoKey: string;
  readonly materializedPath: string;
  readonly reason: string;

  constructor(repoKey: string, materializedPath: string, reason: string) {
    super(
      `Benchmark repo '${repoKey}' cache at ${materializedPath} is invalid (${reason}). ` +
        `Run: pnpm run benchmark:materialize ${repoKey}`,
    );
    this.name = "MaterializationInvalidError";
    this.repoKey = repoKey;
    this.materializedPath = materializedPath;
    this.reason = reason;
  }
}

function readHeadFromDir(targetDir: string): string {
  return execSync("git rev-parse HEAD", {
    cwd: targetDir,
    encoding: "utf8",
  });
}

function isGitRepository(targetDir: string): boolean {
  const gitPath = path.join(targetDir, ".git");
  if (!fs.existsSync(gitPath)) {
    return false;
  }

  try {
    const stat = fs.statSync(gitPath);
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

export function validateMaterializedRepo(
  repoKey: string,
  materializedPath: string,
  manifest: BenchmarkManifest,
): void {
  if (!fs.existsSync(materializedPath)) {
    throw new MaterializationInvalidError(
      repoKey,
      materializedPath,
      "path does not exist",
    );
  }

  if (!isGitRepository(materializedPath)) {
    throw new MaterializationInvalidError(
      repoKey,
      materializedPath,
      "not a git repository",
    );
  }

  const includePaths = manifest.scope.include;
  const headRead = readHeadSafely(() => readHeadFromDir(materializedPath));
  if (headRead.status !== "ok") {
    throw new MaterializationInvalidError(
      repoKey,
      materializedPath,
      "repository head not available",
    );
  }

  const status = isMaterializationComplete({
    head: headRead.head,
    commit: manifest.commit,
    includePaths,
    exists: (relativePath) =>
      fs.existsSync(path.join(materializedPath, relativePath)),
    isDirectory: (relativePath) =>
      fs.statSync(path.join(materializedPath, relativePath)).isDirectory(),
    sparseCheckoutContent:
      includePaths.length > 0
        ? readSparseCheckoutContent(
            materializedPath,
            (filePath) => fs.existsSync(filePath),
            (filePath, encoding) => fs.readFileSync(filePath, encoding),
          )
        : null,
  });

  if (!status.complete) {
    throw new MaterializationInvalidError(
      repoKey,
      materializedPath,
      status.reason ?? "incomplete materialization",
    );
  }
}
