import type { DiscoverySeed } from "./load-discovery-seed";
import type { LoadedOcsfDiscoveries } from "./load-ocsf-discoveries";
import { landScanDiscoveryToOcsfRecords } from "./scan-discovery-to-ocsf";
import { projectOcsfToDiscoveriesDocument } from "./project-ocsf-to-discoveries-document";
import type { A0DiscoveriesDocument } from "./a0-discoveries-document.schema";
import { discoverySeedToDiscoveryInput } from "../../../src/discoveries/scan-result-to-discovery-input";

export interface BuildA0DiscoveriesDocumentInput {
  seed: DiscoverySeed;
  discoveries?: LoadedOcsfDiscoveries;
}

export function buildA0DiscoveriesDocument(
  input: BuildA0DiscoveriesDocumentInput,
): A0DiscoveriesDocument {
  const scanRecords = landScanDiscoveryToOcsfRecords(discoverySeedToDiscoveryInput(input.seed));
  const overlayRecords = input.discoveries?.records ?? [];

  return projectOcsfToDiscoveriesDocument({
    records: [...scanRecords, ...overlayRecords],
  });
}
