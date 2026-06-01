import type { DetectedComponent } from "../core/types/component";
import type { DetectedDataFlow } from "../core/types/data-flow";
import type { RawFinding } from "../core/types/detection";
import type { FileInfo } from "../core/types/file";
import type { ServiceSection } from "../core/sectioning/discover-service-sections";
import { detectDataFlows as detectRawDataFlows } from "./detect";
import { postprocessDataFlows } from "./postprocess";

/**
 * Thin coordinator that runs raw data-flow detection followed by structural
 * post-processing (dedupe, rewiring through the application, actor→app safety
 * flows, etc.).
 *
 * Callers that need fine-grained control over raw flows vs. post-processing
 * should import from `data-flow/detect` and `data-flow/postprocess`
 * directly instead.
 */
export function detectDataFlows(
  files: FileInfo[],
  components: DetectedComponent[],
  findings: RawFinding[],
  sections?: ServiceSection[],
): DetectedDataFlow[] {
  const raw = detectRawDataFlows(files, components, findings, sections);
  return postprocessDataFlows(components, raw);
}

