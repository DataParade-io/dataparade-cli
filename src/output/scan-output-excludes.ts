import path from "path";

/**
 * Everything a scan (and `dataparade kb`) writes next to dataflow.json, for when the
 * output folder is the scan root itself. Older versions' files are included so a folder
 * scanned by an earlier CLI is not read back in as source.
 */
const SCAN_OUTPUT_ENTRIES = [
  "dataflow.json",
  "facts.json",
  "data-items/**",
  "graphify.json",
  "answers.json",
  "diagram.json",
  "briefs/**",
  "evidence/**",
  // Written by CLI 0.0.26 and earlier.
  "dataparade.json",
  "dataparade-graph.json",
  "discoveries-diagram.json",
  "discoveries-diagram.d2",
  "ocsf-discoveries/**",
  "graphify-out/**",
];

/**
 * Exclude globs that keep a scan from reading its own previous output when the
 * output (the knowledge base) lives inside the scanned repo, e.g. `.dataparade/`.
 * Without this, a re-scan ingests its own Facts as source.
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
