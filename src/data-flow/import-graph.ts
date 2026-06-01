import path from "node:path";

import type { FileInfo } from "../core/types/file";

function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Normalize repo-relative paths for stable comparisons (POSIX, no leading ./). */
export function normalizeProjectPath(p: string): string {
  return path.posix.normalize(toPosixPath(p));
}

function resolveRelativeModule(
  fromFile: string,
  specifier: string,
  knownPaths: Set<string>,
): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const dir = path.posix.dirname(normalizeProjectPath(fromFile));
  const raw = path.posix.normalize(path.posix.join(dir, specifier));
  const candidates = [
    raw,
    `${raw}.ts`,
    `${raw}.tsx`,
    `${raw}.js`,
    `${raw}.mjs`,
    `${raw}.cjs`,
    path.posix.join(raw, "index.ts"),
    path.posix.join(raw, "index.tsx"),
    path.posix.join(raw, "index.js"),
    path.posix.join(raw, "index.mjs"),
  ];
  for (const c of candidates) {
    const n = normalizeProjectPath(c);
    if (knownPaths.has(n)) return n;
  }
  return undefined;
}

/**
 * Parse static relative imports (default, namespace, named, side-effect) and require() for bindings.
 */
export function parseStaticImportBindings(
  fromFile: string,
  content: string,
  knownPaths: Set<string>,
): Map<string, string> {
  const bindings = new Map<string, string>();
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    let m = trimmed.match(/^import\s+(\w+)\s+from\s+['"](\.[^'"]+)['"]/);
    if (m) {
      const resolved = resolveRelativeModule(fromFile, m[2], knownPaths);
      if (resolved) bindings.set(m[1], resolved);
      continue;
    }

    m = trimmed.match(/^import\s+\*\s+as\s+(\w+)\s+from\s+['"](\.[^'"]+)['"]/);
    if (m) {
      const resolved = resolveRelativeModule(fromFile, m[2], knownPaths);
      if (resolved) bindings.set(m[1], resolved);
      continue;
    }

    m = trimmed.match(/^import\s+\{([^}]+)\}\s+from\s+['"](\.[^'"]+)['"]/);
    if (m) {
      const resolved = resolveRelativeModule(fromFile, m[2], knownPaths);
      if (resolved) {
        for (const part of m[1].split(",")) {
          const seg = part.trim();
          const asMatch = seg.match(/^(\w+)\s+as\s+(\w+)$/);
          if (asMatch) bindings.set(asMatch[2], resolved);
          else if (/^\w+$/.test(seg)) bindings.set(seg, resolved);
        }
      }
      continue;
    }

    m = trimmed.match(/^import\s+['"](\.[^'"]+)['"]/);
    if (m) {
      void resolveRelativeModule(fromFile, m[1], knownPaths);
      continue;
    }

    m = trimmed.match(
      /(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/,
    );
    if (m) {
      const resolved = resolveRelativeModule(fromFile, m[2], knownPaths);
      if (resolved) bindings.set(m[1], resolved);
    }
  }

  return bindings;
}

function collectDirectImportedModules(
  fromFile: string,
  content: string,
  knownPaths: Set<string>,
): Set<string> {
  const edges = new Set<string>();
  const bindings = parseStaticImportBindings(fromFile, content, knownPaths);
  for (const resolved of bindings.values()) {
    edges.add(resolved);
  }
  for (const match of content.matchAll(/import\s+['"](\.[^'"]+)['"]/g)) {
    const resolved = resolveRelativeModule(fromFile, match[1], knownPaths);
    if (resolved) edges.add(resolved);
  }
  return edges;
}

export function buildKnownPathsSet(files: FileInfo[]): Set<string> {
  const set = new Set<string>();
  for (const f of files) {
    set.add(normalizeProjectPath(f.path));
  }
  return set;
}

export function buildImportAdjacency(
  files: FileInfo[],
  knownPaths: Set<string>,
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const file of files) {
    if (!file.content) continue;
    const fp = normalizeProjectPath(file.path);
    graph.set(fp, collectDirectImportedModules(fp, file.content, knownPaths));
  }
  return graph;
}

export function shortestImportDistance(
  graph: Map<string, Set<string>>,
  from: string,
  to: string,
): number | undefined {
  const start = normalizeProjectPath(from);
  const end = normalizeProjectPath(to);
  if (start === end) return 0;

  const seen = new Set<string>();
  const queue: { node: string; d: number }[] = [{ node: start, d: 0 }];

  while (queue.length > 0) {
    const { node, d } = queue.shift()!;
    if (seen.has(node)) continue;
    seen.add(node);
    const neighbors = graph.get(node);
    if (!neighbors) continue;
    for (const n of neighbors) {
      if (n === end) return d + 1;
      if (!seen.has(n)) queue.push({ node: n, d: d + 1 });
    }
  }
  return undefined;
}

