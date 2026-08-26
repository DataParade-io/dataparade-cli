import path from "path";

import { ingestFileSystem } from "../../../../src/ingest/file-system";
import {
  matchPiiSignalsInFiles,
  piiSignalIdentity,
  type PiiSignalHit,
} from "../../../../src/pii-signals/match-pii-signals";
import type { FixtureScanResult, LayerFinding } from "../../types";

const FIXTURES_ROOT = path.join(__dirname, "../../../fixtures");

export function piiHitToLayerFinding(hit: PiiSignalHit): LayerFinding {
  return {
    key: piiSignalIdentity(hit.id),
    labels: [...hit.labels],
    sourceFilePaths: [hit.evidence.filePath],
    sourceLines: [
      {
        file_path: hit.evidence.filePath,
        start_line: hit.evidence.startLine,
        end_line: hit.evidence.endLine,
      },
    ],
  };
}

export async function scanFixturePiiSignals(fixture: string): Promise<FixtureScanResult> {
  const root = path.join(FIXTURES_ROOT, fixture);
  const files = await ingestFileSystem(root);

  const hits = matchPiiSignalsInFiles(
    files.map((file) => ({ filePath: file.path, content: file.content })),
  );

  return {
    fixture,
    findings: hits.map(piiHitToLayerFinding),
    scannedFiles: files.map((file) => file.path),
  };
}
