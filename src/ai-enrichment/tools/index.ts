import type { RawFinding } from "../../core/types/detection";
import type { FileInfo } from "../../core/types/file";
import type { ServiceSection } from "../../core/sectioning/discover-service-sections";
import type { DetectedComponent } from "../../core/types/component";
import type { DetectedDataFlow } from "../../core/types/data-flow";

import type { AiInferenceCandidate, AiProposal } from "../types";
import { resolveScannedFileExact } from "../scan-paths";

export interface AiScanContext {
  components: DetectedComponent[];
  dataFlows: DetectedDataFlow[];
  findings: RawFinding[];
  files: FileInfo[];
  sections: ServiceSection[];
}

export interface AgentTooling {
  getScanContext(): AiScanContext;
  listCandidates(filter?: {
    candidateType?: AiInferenceCandidate["candidateType"];
    minPriority?: number;
  }): AiInferenceCandidate[];
  getGraphNeighborhood(
    nodeOrFlowId: string,
    depth: number,
  ): {
    components: DetectedComponent[];
    dataFlows: DetectedDataFlow[];
  };
  readSnippet(filePath: string, startLine: number, endLine: number): string | undefined;
  searchInFiles(query: string, scope?: string[]): Array<{
    filePath: string;
    line: number;
    snippet: string;
  }>;
  getSymbolContext(symbol: string, filePath: string): string | undefined;
  validateProposal(proposal: AiProposal): { ok: true } | { ok: false; reason: string };
  emitProposal(proposal: AiProposal): void;
}

function fileLines(content: string): string[] {
  return content.split(/\r?\n/);
}

export function createAgentTooling(
  scanContext: AiScanContext,
  candidates: AiInferenceCandidate[],
  proposalSink: AiProposal[],
): AgentTooling {
  const byFilePath = new Map(scanContext.files.map((file) => [file.path, file]));

  return {
    getScanContext: () => scanContext,
    listCandidates: (filter) =>
      candidates.filter((candidate) => {
        if (filter?.candidateType && candidate.candidateType !== filter.candidateType) {
          return false;
        }
        if (
          typeof filter?.minPriority === "number" &&
          candidate.priority < filter.minPriority
        ) {
          return false;
        }
        return true;
      }),
    getGraphNeighborhood: (nodeOrFlowId, depth) => {
      const targetFlow = scanContext.dataFlows.find((flow) => flow.id === nodeOrFlowId);
      const startNodes = new Set<string>();
      if (targetFlow) {
        startNodes.add(targetFlow.sourceComponentId);
        startNodes.add(targetFlow.targetComponentId);
      } else {
        startNodes.add(nodeOrFlowId);
      }
      const frontier = new Set(startNodes);
      const visited = new Set(startNodes);
      for (let i = 0; i < Math.max(1, depth); i += 1) {
        const next = new Set<string>();
        for (const flow of scanContext.dataFlows) {
          if (frontier.has(flow.sourceComponentId)) {
            next.add(flow.targetComponentId);
          }
          if (frontier.has(flow.targetComponentId)) {
            next.add(flow.sourceComponentId);
          }
        }
        for (const nodeId of next) {
          visited.add(nodeId);
        }
      }
      return {
        components: scanContext.components.filter((component) => visited.has(component.id)),
        dataFlows: scanContext.dataFlows.filter(
          (flow) => visited.has(flow.sourceComponentId) || visited.has(flow.targetComponentId),
        ),
      };
    },
    readSnippet: (filePath, startLine, endLine) => {
      const file = byFilePath.get(filePath);
      if (!file) return undefined;
      const lines = fileLines(file.content);
      const start = Math.max(1, startLine);
      const end = Math.max(start, endLine);
      return lines.slice(start - 1, end).join("\n");
    },
    searchInFiles: (query, scope) => {
      const q = query.toLowerCase();
      return scanContext.files
        .filter((file) =>
          !scope || scope.length === 0
            ? true
            : scope.some((prefix) => file.path.startsWith(prefix)),
        )
        .flatMap((file) => {
          const lines = fileLines(file.content);
          const matches: Array<{ filePath: string; line: number; snippet: string }> = [];
          lines.forEach((line, idx) => {
            if (line.toLowerCase().includes(q)) {
              matches.push({
                filePath: file.path,
                line: idx + 1,
                snippet: line.trim().slice(0, 240),
              });
            }
          });
          return matches;
        })
        .slice(0, 50);
    },
    getSymbolContext: (symbol, filePath) => {
      const file = byFilePath.get(filePath);
      if (!file) return undefined;
      const lines = fileLines(file.content);
      const idx = lines.findIndex((line) => line.includes(symbol));
      if (idx < 0) return undefined;
      const start = Math.max(0, idx - 4);
      const end = Math.min(lines.length, idx + 5);
      return lines.slice(start, end).join("\n");
    },
    validateProposal: (proposal) => {
      if (proposal.evidence.length === 0) {
        return { ok: false, reason: "missing_evidence" };
      }
      if (proposal.confidence.score < 0 || proposal.confidence.score > 1) {
        return { ok: false, reason: "invalid_confidence_range" };
      }
      const files = scanContext.files;
      if (proposal.provider !== "mock" && files.length > 0) {
        for (const ev of proposal.evidence) {
          const fp = ev.filePath.trim().toLowerCase();
          if (!fp || fp === "unknown") {
            return { ok: false, reason: "evidence_path_invalid" };
          }
          if (!resolveScannedFileExact(files, ev.filePath)) {
            return { ok: false, reason: "evidence_path_not_in_scan" };
          }
        }
      }
      return { ok: true };
    },
    emitProposal: (proposal) => {
      proposalSink.push(proposal);
    },
  };
}
