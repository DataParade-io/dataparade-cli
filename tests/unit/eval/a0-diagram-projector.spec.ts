import fs from "fs";
import path from "path";

import { validateDataflowJson } from "../../../src/core/schema/dataflow-wrapper.schema";
import type { OcsfDiscoveryRecord } from "../../eval/interview-a0/ocsf-discovery-types";
import { ocsfDiscoveryRecordSchema } from "../../eval/interview-a0/ocsf-discovery-types";
import {
  buildA0DiagramWrapper,
  buildA0DiscoveriesDocument,
  landDiscoverySeedToOcsfRecords,
  projectA0DiagramGraph,
  projectOcsfToDiscoveriesDocument,
} from "../../eval/a0-diagram/a0-diagram-projector";
import type { ScanDiscoveryInput } from "../../../src/discoveries/scan-discovery-input";
import { discoverySeedToDiscoveryInput } from "../../../src/discoveries/scan-result-to-discovery-input";
import { validateA0DiscoveriesDocument } from "../../eval/a0-diagram/a0-discoveries-document.schema";
import { loadDiscoverySeedFromFile } from "../../eval/a0-diagram/load-discovery-seed";
import { loadOcsfDiscoveriesFromDir } from "../../eval/a0-diagram/load-ocsf-discoveries";
import { renderDiagramToD2, renderDiagramToSvg } from "../../eval/a0-diagram/d2-diagram-render";
import { loadDefaultBriefSnapshot } from "../../eval/interview-a0/load-brief";
import { PINNED_BRIEF_SHA } from "../../eval/interview-a0/pins";

const DISCOVERY_SEED_PATH = path.join(
  __dirname,
  "../../eval/a0-diagram/fixtures/dataparade-discovery-seed.json",
);

const DOGFOOD_OCSF_DIR = path.join(
  __dirname,
  "../../../../knowledge-base/project/wiki/graph/dogfood/ocsf-discoveries",
);

describe("a0DiagramProjector (DATAP-699)", () => {
  const discoverySeed = loadDiscoverySeedFromFile(DISCOVERY_SEED_PATH);
  const brief = loadDefaultBriefSnapshot();
  const discoveries = (() => {
    if (!fs.existsSync(DOGFOOD_OCSF_DIR)) {
      throw new Error(`Missing dogfood OCSF dir: ${DOGFOOD_OCSF_DIR}`);
    }
    return loadOcsfDiscoveriesFromDir(DOGFOOD_OCSF_DIR);
  })();

  it("builds dogfood dataparade.json from scan OCSF land + interview overlay", () => {
    const scanRecords = landDiscoverySeedToOcsfRecords(discoverySeedToDiscoveryInput(discoverySeed));
    for (const record of scanRecords) {
      expect(() => ocsfDiscoveryRecordSchema.parse(record)).not.toThrow();
    }

    const document = buildA0DiscoveriesDocument({ seed: discoverySeed, discoveries });

    expect(validateA0DiscoveriesDocument(document).ok).toBe(true);
    expect(document.components.length).toBe(28);
    expect(document.dataFlows.length).toBe(20);
    expect(document.dataItems).toEqual([]);
    expect(document.mentions).toEqual([]);
    expect(document.system?.in_scope).toContain("Every repository in the DataParade-io GitHub organization");

    const cmp6 = document.components.find((row) => row.id === "cmp_6");
    expect(cmp6?.actor_kind).toBeDefined();
    expect(cmp6?.confidence).toBeGreaterThan(0);
    expect(cmp6?.sourceLocations.length).toBeGreaterThan(0);

    const flow103 = document.dataFlows.find((row) => row.id === "flow_103");
    expect(flow103?.data_categories).toEqual(["other"]);
    expect(flow103?.purpose).toBeDefined();
    expect(flow103?.sourceComponentId).toBeDefined();
    expect(flow103?.targetComponentId).toBeDefined();
    expect(flow103).not.toHaveProperty("sourceLocation");
    expect(document.mentions.some((row) => row.id.startsWith("mention:flow_103:"))).toBe(false);

    const flow254 = document.dataFlows.find((row) => row.id === "flow_254");
    expect(flow254).not.toHaveProperty("sourceLocation");
    expect(document.mentions.some((row) => row.id.startsWith("mention:flow_254:"))).toBe(false);

    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain('"position"');
    expect(serialized).not.toContain('"viewport"');
  });

  it("projects scanner personal-data mentions and data items from discovery input", () => {
    const scanInput: ScanDiscoveryInput = {
      ...discoverySeedToDiscoveryInput(discoverySeed),
      mentions: [
        {
          id: "mention:email",
          filePath: "backend/src/auth/login.ts",
          startLine: 12,
          endLine: 12,
          code: "const email = req.body.email;",
          labels: ["user_email"],
        },
      ],
      dataItems: [
        {
          id: "data_item:email",
          mentionIds: ["mention:email"],
          labels: ["user_email"],
        },
      ],
    };
    const scanRecords = landDiscoverySeedToOcsfRecords(scanInput);
    const document = projectOcsfToDiscoveriesDocument({
      records: [...scanRecords, ...discoveries.records],
    });

    const mention = document.mentions.find((row) => row.id === "mention:email");
    expect(mention?.filePath).toBe("backend/src/auth/login.ts");
    expect(mention?.startLine).toBe(12);

    const dataItem = document.dataItems.find((row) => row.id === "data_item:email");
    expect(dataItem?.mentionIds).toEqual(["mention:email"]);
    expect(document.mentions.some((row) => row.id.startsWith("mention:flow_103:"))).toBe(false);
  });

  it("does not manufacture mentions when flows only have sourceLocations", () => {
    const flowOnlySeed: ScanDiscoveryInput = {
      components: [
        {
          id: "cmp_6",
          name: "Customer",
          type: "actor",
          subType: "person",
          confidence: 0.85,
          sourceLocations: [],
        },
        {
          id: "cmp_7",
          name: "backend",
          type: "asset",
          subType: "service",
          confidence: 0.85,
          sourceLocations: [],
        },
      ],
      dataFlows: [
        {
          id: "flow_103",
          sourceComponentId: "cmp_6",
          targetComponentId: "cmp_7",
          type: "api_call",
          confidence: 0.85,
          targetScope: "local",
        },
      ],
      mentions: [],
      dataItems: [],
    };

    const scanRecords = landDiscoverySeedToOcsfRecords(flowOnlySeed);
    const document = projectOcsfToDiscoveriesDocument({ records: scanRecords });

    expect(document.mentions).toEqual([]);
    expect(document.dataItems).toEqual([]);
  });

  it("keeps two scans of the same relative path distinct by scan path", () => {
    const mention = {
      id: "mention:email:config/contacts.yml:2",
      filePath: "config/contacts.yml",
      startLine: 2,
      endLine: 2,
      code: "email: a@example.com",
      labels: ["email"],
    };
    const dataItem = {
      id: "data_item:email",
      mentionIds: [mention.id],
      labels: ["email"],
    };
    const firstPath = "/checkouts/partner-api";
    const secondPath = "/checkouts/partner-web";
    const first = landDiscoverySeedToOcsfRecords({
      scanPath: firstPath,
      components: [],
      dataFlows: [],
      mentions: [mention],
      dataItems: [dataItem],
    });
    const second = landDiscoverySeedToOcsfRecords({
      scanPath: secondPath,
      components: [],
      dataFlows: [],
      mentions: [mention],
      dataItems: [dataItem],
    });

    const document = projectOcsfToDiscoveriesDocument({
      records: [...first, ...second],
    });

    expect(document.mentions.map((row) => row.id).sort()).toEqual([
      `${firstPath}::${mention.id}`,
      `${secondPath}::${mention.id}`,
    ]);
    expect(document.mentions.map((row) => row.scanPath).sort()).toEqual([
      firstPath,
      secondPath,
    ]);
    expect(document.dataItems.map((row) => row.mentionIds[0]).sort()).toEqual([
      `${firstPath}::${mention.id}`,
      `${secondPath}::${mention.id}`,
    ]);
    expect(first[0]?.dataparade.asserts).toContain(encodeURIComponent(firstPath));
    expect(second[0]?.dataparade.asserts).not.toBe(first[0]?.dataparade.asserts);
  });

  it("rejects interview OCSF that would create a new component", () => {
    const interviewOnlyComponent: OcsfDiscoveryRecord = {
      ...discoveries.records[0],
      metadata: {
        ...discoveries.records[0].metadata,
        uid: "dp:discovery/interview/dp_scan_entity_cmp_999/actor_kind/test",
      },
      resources: [{ uid: "dp:scan/entity/cmp_999", name: "cmp_999", type: "entity" }],
      dataparade: {
        ...discoveries.records[0].dataparade,
        asserts: "dp:scan/entity/cmp_999",
        asserted_slot: "actor_kind",
        asserted_value: "person",
      },
    };

    expect(() =>
      buildA0DiscoveriesDocument({
        seed: discoverySeed,
        discoveries: {
          directory: discoveries.directory,
          records: [interviewOnlyComponent],
        },
      }),
    ).toThrow(/must not create/);
  });

  it("rejects interview OCSF that would create a new flow", () => {
    const interviewOnlyFlow: OcsfDiscoveryRecord = {
      ...discoveries.records[0],
      metadata: {
        ...discoveries.records[0].metadata,
        uid: "dp:discovery/interview/dp_scan_entity_flow_999/purpose/test",
      },
      resources: [{ uid: "dp:scan/entity/flow_999", name: "flow_999", type: "entity" }],
      dataparade: {
        ...discoveries.records[0].dataparade,
        asserts: "dp:scan/entity/flow_999",
        asserted_slot: "purpose",
        asserted_value: "service_delivery",
      },
    };

    expect(() =>
      buildA0DiscoveriesDocument({
        seed: discoverySeed,
        discoveries: { directory: discoveries.directory, records: [interviewOnlyFlow] },
      }),
    ).toThrow(/must not create/);
  });

  it("projects dogfood A0 to a valid diagram.json wrapper in interview mode", () => {
    const discoveriesDocument = buildA0DiscoveriesDocument({ seed: discoverySeed, discoveries });
    const wrapper = buildA0DiagramWrapper({
      brief,
      discoveries,
      discoverySeed,
      discoveriesDocument,
      mode: "interview",
      projectName: "dogfood-a0-test",
    });

    expect(validateDataflowJson(wrapper).ok).toBe(true);
    expect(wrapper.metadata?.projectName).toBe("dogfood-a0-test");
    const meta = wrapper.metadata as {
      a0Projector?: { mode?: string; briefSha?: string };
    };
    expect(meta.a0Projector?.mode).toBe("interview");
    expect(meta.a0Projector?.briefSha).toBe(PINNED_BRIEF_SHA);
    expect(wrapper.graph.nodes.length).toBeGreaterThan(5);
    expect(wrapper.graph.edges.length).toBe(20);
  });

  it("shows unknown/partial slots in interview mode", () => {
    const discoveriesDocument = buildA0DiscoveriesDocument({ seed: discoverySeed, discoveries });
    const graph = projectA0DiagramGraph({
      brief,
      discoveries,
      discoverySeed,
      discoveriesDocument,
      mode: "interview",
    });

    const systemNode = graph.nodes.find((node) => node.id === "system");
    expect(systemNode?.data.privacy?.slotStatus).toBe("partial");

    expect(systemNode?.data.privacy?.openSlots).toContain("system_boundary");

    const interviewSignals = [...graph.nodes, ...graph.edges].filter((item) => {
      const privacy = item.data?.privacy as { slotStatus?: string; openSlots?: string[] };
      return (
        privacy?.slotStatus === "unknown" ||
        privacy?.slotStatus === "partial" ||
        (privacy?.openSlots?.length ?? 0) > 0
      );
    });
    expect(interviewSignals.length).toBeGreaterThan(0);
  });

  it("renders D2 source and SVG with dashed unknown styling", () => {
    const discoveriesDocument = buildA0DiscoveriesDocument({ seed: discoverySeed, discoveries });
    const graph = projectA0DiagramGraph({
      brief,
      discoveries,
      discoverySeed,
      discoveriesDocument,
      mode: "interview",
    });
    const d2 = renderDiagramToD2(graph);
    const svg = renderDiagramToSvg(graph);

    expect(d2).toContain("direction: right");
    expect(d2).toContain("cmp_6 -> cmp_7");
    expect(svg).toContain("<svg");
    expect(svg).toContain("Every repository in the DataParade-io GitHub organization");
  });

  it("projects dogfood A0 to a valid diagram.json wrapper in filled mode", () => {
    const discoveriesDocument = buildA0DiscoveriesDocument({ seed: discoverySeed, discoveries });
    const wrapper = buildA0DiagramWrapper({
      brief,
      discoveries,
      discoverySeed,
      discoveriesDocument,
      mode: "filled",
      projectName: "dogfood-a0-filled-test",
    });

    expect(validateDataflowJson(wrapper).ok).toBe(true);
    const meta = wrapper.metadata as {
      a0Projector?: { mode?: string; briefSha?: string };
    };
    expect(meta.a0Projector?.mode).toBe("filled");
    expect(wrapper.graph.nodes.length).toBeGreaterThan(0);
    expect(wrapper.graph.edges.length).toBeGreaterThan(0);
  });

  it("omits unknown slots and question placeholders in filled mode", () => {
    const discoveriesDocument = buildA0DiscoveriesDocument({ seed: discoverySeed, discoveries });
    const graph = projectA0DiagramGraph({
      brief,
      discoveries,
      discoverySeed,
      discoveriesDocument,
      mode: "filled",
    });

    const interview = projectA0DiagramGraph({
      brief,
      discoveries,
      discoverySeed,
      discoveriesDocument,
      mode: "interview",
    });
    const interviewPartialOrUnknown = [...interview.nodes, ...interview.edges].some((item) => {
      const privacy = item.data?.privacy as { slotStatus?: string } | undefined;
      return privacy?.slotStatus === "partial" || privacy?.slotStatus === "unknown";
    });
    expect(interviewPartialOrUnknown).toBe(true);

    for (const item of [...graph.nodes, ...graph.edges]) {
      const privacy = item.data?.privacy as Record<string, unknown> | undefined;
      expect(privacy?.slotStatus).not.toBe("unknown");
      for (const [key, value] of Object.entries(privacy ?? {})) {
        if (key.endsWith("Status") || key === "slotStatus") {
          expect(value).not.toBe("unknown");
        }
      }
      expect(privacy?.openSlots).toEqual([]);
      const label = String(item.data?.label ?? "");
      expect(label).not.toContain("?");
      expect(label).not.toContain("(partial)");
      expect(label).not.toContain("(?)");
    }
  });

  it("drops unknown flow slots from filled edge privacy when only one side is known", () => {
    const discoveriesWithoutFlow103Purpose = {
      ...discoveries,
      records: discoveries.records.filter(
        (record) =>
          !(
            record.dataparade.asserts === "dp:scan/entity/flow_103" &&
            record.dataparade.asserted_slot === "purpose"
          ),
      ),
    };
    const discoveriesDocument = buildA0DiscoveriesDocument({
      seed: discoverySeed,
      discoveries: discoveriesWithoutFlow103Purpose,
    });

    const interview = projectA0DiagramGraph({
      brief,
      discoveries: discoveriesWithoutFlow103Purpose,
      discoverySeed,
      discoveriesDocument,
      mode: "interview",
    });
    const interviewEdge = interview.edges.find((edge) => edge.id === "flow_103");
    expect(interviewEdge).toBeDefined();
    expect(interviewEdge!.data!.privacy?.purposeStatus).toBe("unknown");
    expect(interviewEdge!.data!.privacy?.categoriesStatus).toBe("known");

    const filled = projectA0DiagramGraph({
      brief,
      discoveries: discoveriesWithoutFlow103Purpose,
      discoverySeed,
      discoveriesDocument,
      mode: "filled",
    });
    const filledEdge = filled.edges.find((edge) => edge.id === "flow_103");
    expect(filledEdge).toBeDefined();
    const privacy = filledEdge!.data!.privacy as Record<string, unknown> | undefined;
    expect(privacy?.categoriesStatus).toBe("known");
    expect(privacy?.purposeStatus).toBeUndefined();
    expect(privacy?.slotStatus).toBe("known");
    expect(privacy?.openSlots).toEqual([]);
    for (const [key, value] of Object.entries(privacy ?? {})) {
      if (key.endsWith("Status") || key === "slotStatus") {
        expect(value).not.toBe("unknown");
      }
    }
  });
});
