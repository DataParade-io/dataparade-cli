/**
 * Knowledge graph next to dataflow.json (scanner KDATAP-a528cd, KDATAP-d3e0bc).
 *
 * graphify maps the code structure (graphify-out/graph.json); the scanner adds
 * DataParade's privacy and security layer in the same NetworkX node-link format
 * (dataparade-graph.json), with edges that point at graphify's nodes. Loaded
 * together, they are one connected graph from data flows down to the functions and
 * lines that handle each data item. graphify is optional: without it, only
 * dataparade-graph.json is written. Problems here are warnings; they never fail the
 * scan or block dataflow.json.
 */
import { runGraphify, writeKnowledgeGraph, type OrchestratorScanResult } from "@dataparade/scanner";

export async function writeScanKnowledgeGraph(
  result: OrchestratorScanResult,
  scanRoot: string,
  outDir: string,
): Promise<void> {
  try {
    const structure = await runGraphify(scanRoot, { outDir });
    for (const warning of structure.warnings) {
      // eslint-disable-next-line no-console
      console.warn(`[scan] ${warning}`);
    }
    const written = await writeKnowledgeGraph(
      structure.info ? { ...result, structureGraph: structure.info } : result,
      outDir,
    );
    if (written.structureGraph) {
      // eslint-disable-next-line no-console
      console.log(`[scan] code-structure graph (graphify ${structure.info?.version}) written to ${written.structureGraph}`);
    }
    // eslint-disable-next-line no-console
    console.log(`[scan] knowledge graph written to ${written.dataparadeGraph}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      `[scan] warning: knowledge graph not written: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
