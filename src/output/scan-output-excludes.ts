import path from "path";

/** Everything a scan writes next to dataflow.json (plus the KB folders `dataparade kb` adds). */
const SCAN_OUTPUT_ENTRIES = [
  "dataflow.json",
  "dataparade.json",
  "dataparade-graph.json",
  "discoveries-diagram.json",
  "discoveries-diagram.d2",
  "diagram.json",
  "ocsf-discoveries/**",
  "graphify-out/**",
  "briefs/**",
  "evidence/**",
];

/**
 * Exclude globs that keep a scan from reading its own previous output when the
 * output (the knowledge base) lives inside the scanned repo, e.g. `.dataparade/`.
 * Without this, a re-scan ingests thousands of Discovery files as source.
 */
export function scanOutputExcludes(scanRoot: string, dataflowOutputPath: string): string[] {
  const root = path.resolve(scanRoot);
  const outputDir = path.dirname(path.resolve(dataflowOutputPath));
  const relative = path.relative(root, outputDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return [];
  }
  const prefix = relative ? `${relative.split(path.sep).join("/")}/` : "";
  return prefix ? [`${prefix}**`] : SCAN_OUTPUT_ENTRIES;
}
