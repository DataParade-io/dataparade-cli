import { promises as fs } from "fs";
import * as path from "path";

export type IgnoreRule = {
  baseDir: string;
  pattern: string;
  negate: boolean;
  dirOnly: boolean;
  regex: RegExp;
};

export function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}

export function gitignorePatternToRegex(
  pattern: string,
  dirOnly: boolean,
): RegExp {
  // Very small subset of .gitignore-style patterns:
  // - * matches any chars except path separator
  // - ** matches across directories
  // - ? matches a single non-separator
  // - pattern without leading slash matches anywhere under baseDir
  let escaped = pattern.replace(/[-\\^$+?.()|[\]{}*?]/g, "\\$&");

  // Restore globs
  escaped = escaped.replace(/\\\*\\\*/g, ".*"); // **
  escaped = escaped.replace(/\\\*/g, "[^/]*"); // *
  escaped = escaped.replace(/\\\?/g, "[^/]"); // ?

  const suffix = dirOnly ? "(?:/.*)?$" : "$";
  // Match from start of the relative path
  return new RegExp(`^${escaped}${suffix}`);
}

export async function readGitignore(dir: string): Promise<IgnoreRule[]> {
  const gitignorePath = path.join(dir, ".gitignore");
  try {
    const content = await fs.readFile(gitignorePath, "utf8");
    const lines = content.split(/\r?\n/);
    const rules: IgnoreRule[] = [];

    for (const rawLine of lines) {
      let line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      let negate = false;
      if (line.startsWith("!")) {
        negate = true;
        line = line.slice(1).trim();
        if (!line) continue;
      }

      let dirOnly = false;
      if (line.endsWith("/")) {
        dirOnly = true;
        line = line.slice(0, -1);
        if (!line) continue;
      }

      const regex = gitignorePatternToRegex(toPosixPath(line), dirOnly);
      rules.push({
        baseDir: dir,
        pattern: line,
        negate,
        dirOnly,
        regex,
      });
    }

    return rules;
  } catch (error: unknown) {
    // If .gitignore does not exist, ignore silently
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function gitignoreRulesForDir(
  currentDir: string,
  accumulatedRules: IgnoreRule[],
): Promise<IgnoreRule[]> {
  const localRules = await readGitignore(currentDir);
  return accumulatedRules.concat(localRules);
}

export function isPathIgnored(
  absolutePath: string,
  isDirectory: boolean,
  rules: IgnoreRule[],
): boolean {
  const normalizedPath = toPosixPath(absolutePath);
  let ignored = false;

  for (const rule of rules) {
    const base = toPosixPath(rule.baseDir);
    if (!normalizedPath.startsWith(base.endsWith("/") ? base : `${base}/`)) {
      continue;
    }

    const rel = normalizedPath.slice(base.length + (base.endsWith("/") ? 0 : 1));
    if (!rel) continue;

    if (rule.dirOnly && !isDirectory) {
      continue;
    }

    if (rule.regex.test(rel)) {
      ignored = !rule.negate;
    }
  }

  return ignored;
}
