/**
 * What a scan writes besides dataflow.json (DATAP-735):
 *
 *   facts.json          Facts from this scan, replaced on every scan
 *   data-items/*.json   one file per data item, with its occurrences
 *   graphify.json       Graphify's code-structure graph (graph.json, renamed)
 *
 * Graphify (https://github.com/Graphify-Labs/graphify) maps the code; the scanner's
 * knowledge graph links Facts to those code nodes. The graph is built in memory and only
 * feeds facts.json (code refs, relations) and the C4 hierarchy. Problems here are
 * warnings; they never fail the scan or block dataflow.json.
 */
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildDataParadeGraph,
  runGraphify,
  type DataParadeGraph,
  type OrchestratorScanResult,
} from '@dataparade/scanner';

import { buildFacts } from '../facts/build-facts';
import { writeFactsOutput } from '../facts/io';
import type { OutputLayout } from '../facts/layout';
import { buildDataflowHierarchy, type DataflowHierarchy } from './c4-hierarchy';

function warn(message: string): void {
  console.warn(`[scan] ${message}`);
}

/**
 * Where Graphify keeps its working files and cache between scans, outside the output
 * folder: `~/.cache/dataparade/graphify/<hash of the scan root>`.
 */
export function graphifyCacheDir(
  scanRoot: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const base =
    env.DATAPARADE_CACHE_DIR?.trim() ||
    path.join(
      env.XDG_CACHE_HOME?.trim() || path.join(os.homedir(), '.cache'),
      'dataparade'
    );
  const hash = createHash('sha256')
    .update(path.resolve(scanRoot))
    .digest('hex')
    .slice(0, 16);
  return path.join(base, 'graphify', hash);
}

/** The cache folder, or a temporary one when the home folder is not writable (e.g. Lambda). */
function usableGraphifyCacheDir(scanRoot: string): string {
  const preferred = graphifyCacheDir(scanRoot);
  try {
    fs.mkdirSync(preferred, { recursive: true });
    return preferred;
  } catch {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'dataparade-graphify-'));
  }
}

export interface ScanKnowledge {
  /** The scan result with Graphify's info attached, when Graphify ran. */
  result: OrchestratorScanResult;
  /** The knowledge graph, in memory only. Undefined when it could not be built. */
  graph?: DataParadeGraph;
}

/**
 * Run Graphify (unless disabled), copy its graph to graphify.json, and build the knowledge
 * graph. A stale graphify.json from an earlier scan is removed first.
 */
export async function prepareScanKnowledge(
  result: OrchestratorScanResult,
  scanRoot: string,
  layout: OutputLayout,
  options: { structureGraph: boolean }
): Promise<ScanKnowledge> {
  fs.rmSync(layout.graphifyPath, { force: true });
  let enriched = result;
  if (options.structureGraph) {
    try {
      const structure = await runGraphify(scanRoot, {
        outDir: usableGraphifyCacheDir(scanRoot),
      });
      for (const warning of structure.warnings) warn(warning);
      if (structure.info) {
        fs.mkdirSync(path.dirname(layout.graphifyPath), { recursive: true });
        fs.copyFileSync(structure.info.path, layout.graphifyPath);
        enriched = { ...result, structureGraph: structure.info };
        console.log(
          `[scan] code-structure graph (graphify ${structure.info.version}) written to ${layout.graphifyPath}`
        );
      }
    } catch (error) {
      warn(
        `warning: code-structure graph not written: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  try {
    return { result: enriched, graph: await buildDataParadeGraph(enriched) };
  } catch (error) {
    warn(
      `warning: knowledge graph not built: ${error instanceof Error ? error.message : String(error)}`
    );
    return { result: enriched };
  }
}

/** C4 hierarchy for `dataflow.json` metadata, from the knowledge graph. */
export function buildScanHierarchy(
  graph: DataParadeGraph | undefined,
  graphNodeIds: Iterable<string>
): DataflowHierarchy | undefined {
  if (!graph) return undefined;
  try {
    return buildDataflowHierarchy(graph, graphNodeIds);
  } catch (error) {
    warn(
      `warning: C4 hierarchy not computed: ${error instanceof Error ? error.message : String(error)}`
    );
    return undefined;
  }
}

export interface WriteScanFactsOptions {
  knowledge: ScanKnowledge;
  scanRoot: string;
  projectName: string;
  cliVersion: string;
  scannerVersion: string;
  scannedAt?: string;
}

/** Write facts.json and data-items/. answers.json is not touched. */
export function writeScanFacts(
  layout: OutputLayout,
  options: WriteScanFactsOptions
) {
  const built = buildFacts({
    result: options.knowledge.result,
    graph: options.knowledge.graph,
    scanRoot: options.scanRoot,
    projectName: options.projectName,
    cliVersion: options.cliVersion,
    scannerVersion: options.scannerVersion,
    scannedAt: options.scannedAt,
  });
  writeFactsOutput(layout, built.facts, built.dataItemFiles);
  return built;
}
