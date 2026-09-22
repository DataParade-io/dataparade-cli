import type { DiscoverySeed } from "./load-discovery-seed";
import type { LoadedOcsfDiscoveries } from "./load-ocsf-discoveries";
import { landDiscoverySeedToOcsfRecords } from "./scan-discovery-to-ocsf";
import { projectOcsfToDiscoveriesDocument } from "./project-ocsf-to-discoveries-document";
import type { PersonalDataProjectionInput } from "./personal-data-projection-input";
import type { A0DiscoveriesDocument } from "./a0-discoveries-document.schema";

export interface BuildA0DiscoveriesDocumentInput {
  seed: DiscoverySeed;
  discoveries?: LoadedOcsfDiscoveries;
  personalData?: PersonalDataProjectionInput;
}

export function buildA0DiscoveriesDocument(
  input: BuildA0DiscoveriesDocumentInput,
): A0DiscoveriesDocument {
  const scanRecords = landDiscoverySeedToOcsfRecords(input.seed);
  const overlayRecords = input.discoveries?.records ?? [];

  return projectOcsfToDiscoveriesDocument({
    records: [...scanRecords, ...overlayRecords],
    personalData: input.personalData,
  });
}
