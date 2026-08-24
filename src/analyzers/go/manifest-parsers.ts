/**
 * Dependency extraction for Go module manifests.
 *
 * `go.mod` is the single source of truth for a Go module's dependencies, and
 * unlike most ecosystems its dependency tokens are already the same strings
 * that appear in `import` statements — so they feed the shared third-party
 * catalog directly.
 */

export interface GoModuleManifest {
  /** The `module` declaration, e.g. `github.com/acme/billing`. */
  modulePath?: string;
  /** Required module paths, versions stripped. */
  requires: string[];
}

const MODULE_REGEX = /^module\s+(\S+)/;
const REQUIRE_BLOCK_START_REGEX = /^require\s*\(/;
const REQUIRE_SINGLE_REGEX = /^require\s+(\S+)\s+\S+/;
const REPLACE_BLOCK_START_REGEX = /^(?:replace|exclude|retract)\s*\(/;
const REQUIRE_ENTRY_REGEX = /^(\S+)\s+v\S+/;

function stripLineComment(line: string): string {
  const index = line.indexOf("//");
  return index === -1 ? line : line.slice(0, index);
}

function isValidModulePath(token: string): boolean {
  if (!token || token.startsWith("//")) return false;
  // Module paths are domain-like or std-lib-like; reject stray syntax.
  return /^[A-Za-z0-9][A-Za-z0-9._~/-]*$/.test(token);
}

export function parseGoMod(content: string): GoModuleManifest {
  const requires = new Set<string>();
  let modulePath: string | undefined;

  let inRequireBlock = false;
  let inIgnoredBlock = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripLineComment(rawLine).trim();
    if (!line) continue;

    if (inIgnoredBlock) {
      if (line.startsWith(")")) inIgnoredBlock = false;
      continue;
    }

    if (inRequireBlock) {
      if (line.startsWith(")")) {
        inRequireBlock = false;
        continue;
      }
      const entry = line.match(REQUIRE_ENTRY_REGEX);
      if (entry && isValidModulePath(entry[1])) requires.add(entry[1]);
      continue;
    }

    if (!modulePath) {
      const moduleMatch = line.match(MODULE_REGEX);
      if (moduleMatch && isValidModulePath(moduleMatch[1])) {
        modulePath = moduleMatch[1];
        continue;
      }
    }

    if (REQUIRE_BLOCK_START_REGEX.test(line)) {
      inRequireBlock = true;
      continue;
    }

    // `replace`/`exclude`/`retract` blocks are skipped: they redirect or
    // remove dependencies rather than declare them.
    if (REPLACE_BLOCK_START_REGEX.test(line)) {
      inIgnoredBlock = true;
      continue;
    }

    const single = line.match(REQUIRE_SINGLE_REGEX);
    if (single && isValidModulePath(single[1])) {
      requires.add(single[1]);
    }
  }

  return { modulePath, requires: Array.from(requires) };
}

/**
 * `go.work` — Go workspaces list member module directories, which is how a
 * multi-module Go repository declares its services.
 */
export function parseGoWork(content: string): string[] {
  const members = new Set<string>();
  let inUseBlock = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripLineComment(rawLine).trim();
    if (!line) continue;

    if (inUseBlock) {
      if (line.startsWith(")")) {
        inUseBlock = false;
        continue;
      }
      members.add(line.replace(/^\.\//, ""));
      continue;
    }

    if (/^use\s*\(/.test(line)) {
      inUseBlock = true;
      continue;
    }

    const single = line.match(/^use\s+(\S+)/);
    if (single) members.add(single[1].replace(/^\.\//, ""));
  }

  return Array.from(members);
}
