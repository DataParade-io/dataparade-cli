import fs from "fs";
import path from "path";

import {
  discoveryIdsByResourceAssert,
  graphEntityUriFromResourceUid,
  relatedDiscoveryIdsFromFinding,
  resolveDiscoveryIdsForFinding,
  type OcsfFindingRecord,
} from "../../eval/interview-a0/finding-discovery-link";
import { ocsfDiscoveryRecordSchema } from "../../eval/interview-a0/ocsf-discovery-types";

const fixturesDir = path.join(__dirname, "../../fixtures/ocsf");

function loadJson<T>(filename: string): T {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, filename), "utf8")) as T;
}

describe("findingDiscoveryLink (DATAP-696 follow-on)", () => {
  const discovery = ocsfDiscoveryRecordSchema.parse(
    loadJson("discovery-cmp_6-actor_kind.json"),
  );
  const primaryFinding = loadJson<OcsfFindingRecord>("sample-finding-cmp_6.json");
  const explicitFinding = loadJson<OcsfFindingRecord>(
    "sample-finding-explicit-discovery-link.json",
  );

  it("normalizes short resource ids to dp:scan/entity URIs", () => {
    expect(graphEntityUriFromResourceUid("cmp_6")).toBe("dp:scan/entity/cmp_6");
    expect(graphEntityUriFromResourceUid("dp:scan/entity/cmp_6")).toBe(
      "dp:scan/entity/cmp_6",
    );
  });

  it("resolves Discovery id via primary join (Finding.resources[].uid → asserts)", () => {
    const ids = resolveDiscoveryIdsForFinding(primaryFinding, [discovery]);
    expect(ids).toEqual([
      "dp:discovery/interview/dp_scan_entity_cmp_6/actor_kind/20260917",
    ]);
  });

  it("resolves via short resource uid on the Finding", () => {
    const finding: OcsfFindingRecord = {
      ...primaryFinding,
      resources: [{ uid: "cmp_6", name: "cmp_6", type: "entity" }],
    };
    expect(discoveryIdsByResourceAssert(finding, [discovery])).toEqual([
      "dp:discovery/interview/dp_scan_entity_cmp_6/actor_kind/20260917",
    ]);
  });

  it("prefers explicit related_discovery_ids when present (secondary join)", () => {
    const ids = resolveDiscoveryIdsForFinding(explicitFinding, [discovery]);
    expect(ids).toEqual([
      "dp:discovery/interview/dp_scan_entity_cmp_6/actor_kind/20260917",
    ]);
    expect(relatedDiscoveryIdsFromFinding(explicitFinding)).toEqual([
      "dp:discovery/interview/dp_scan_entity_cmp_6/actor_kind/20260917",
    ]);
  });

  it("returns empty when no resource or explicit link (never invent)", () => {
    const orphanFinding: OcsfFindingRecord = {
      class_name: "Vulnerability Finding",
      class_uid: 2002,
      resources: [{ uid: "dp:scan/entity/cmp_999" }],
    };
    expect(resolveDiscoveryIdsForFinding(orphanFinding, [discovery])).toEqual([]);
  });

  it("does not map Finding class_uid to Discovery records", () => {
    const securityEventAsDiscovery = {
      ...discovery,
      class_uid: 2002,
      class_name: "Vulnerability Finding",
    };
    expect(
      discoveryIdsByResourceAssert(primaryFinding, [securityEventAsDiscovery as typeof discovery]),
    ).toEqual([]);
  });
});
