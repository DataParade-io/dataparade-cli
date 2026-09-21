import fs from "fs";
import path from "path";

import { validateDataflowJson } from "../../../src/core/schema/dataflow-wrapper.schema";
import {
  buildA0DiagramWrapper,
  buildA0DiscoveriesDocument,
  projectA0DiagramGraph,
} from "../../eval/a0-diagram/a0-diagram-projector";
import { validateA0DiscoveriesDocument } from "../../eval/a0-diagram/a0-discoveries-document.schema";
import { loadOcsfDiscoveriesFromDir } from "../../eval/a0-diagram/load-ocsf-discoveries";
import { renderDiagramToD2, renderDiagramToSvg } from "../../eval/a0-diagram/d2-diagram-render";
import { loadDefaultBriefSnapshot } from "../../eval/interview-a0/load-brief";
import { fixturesRoot } from "../../eval/interview-a0/manifest";
import { PINNED_BRIEF_SHA } from "../../eval/interview-a0/pins";

const DOGFOOD_OCSF_DIR = path.join(
  __dirname,
  "../../../../knowledge-base/project/wiki/graph/dogfood/ocsf-discoveries",
);

function loadBriefMarkdown(): string {
  return fs.readFileSync(path.join(fixturesRoot, "dpkb/dogfood-brief-a0.md"), "utf8");
}

describe("a0DiagramProjector (DATAP-699)", () => {
  const briefMarkdown = loadBriefMarkdown();
  const brief = loadDefaultBriefSnapshot();
  const discoveries = (() => {
    if (!fs.existsSync(DOGFOOD_OCSF_DIR)) {
      throw new Error(`Missing dogfood OCSF dir: ${DOGFOOD_OCSF_DIR}`);
    }
    return loadOcsfDiscoveriesFromDir(DOGFOOD_OCSF_DIR);
  })();

  it("builds dogfood A0 discoveries dataflow.json from brief scan rows and OCSF", () => {
    const document = buildA0DiscoveriesDocument({ briefMarkdown, discoveries });

    expect(validateA0DiscoveriesDocument(document).ok).toBe(true);
    expect(document.components.length).toBe(28);
    expect(document.dataFlows.length).toBe(20);
    expect(document.dataItems).toEqual([]);
    expect(document.mentions).toEqual([]);
    expect(document.system?.in_scope).toContain("Every repository in the DataParade-io GitHub organization");

    const cmp6 = document.components.find((row) => row.id === "cmp_6");
    expect(cmp6?.actor_kind).toBeDefined();

    const flow103 = document.dataFlows.find((row) => row.id === "flow_103");
    expect(flow103?.data_categories).toEqual(["other"]);
    expect(flow103?.purpose).toBeDefined();

    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain('"position"');
    expect(serialized).not.toContain('"viewport"');
  });

  it("projects dogfood A0 to a valid diagram.json wrapper in interview mode", () => {
    const discoveriesDocument = buildA0DiscoveriesDocument({ briefMarkdown, discoveries });
    const wrapper = buildA0DiagramWrapper({
      briefMarkdown,
      brief,
      discoveries,
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
    const discoveriesDocument = buildA0DiscoveriesDocument({ briefMarkdown, discoveries });
    const graph = projectA0DiagramGraph({
      briefMarkdown,
      brief,
      discoveries,
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
    const discoveriesDocument = buildA0DiscoveriesDocument({ briefMarkdown, discoveries });
    const graph = projectA0DiagramGraph({
      briefMarkdown,
      brief,
      discoveries,
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
    const discoveriesDocument = buildA0DiscoveriesDocument({ briefMarkdown, discoveries });
    const wrapper = buildA0DiagramWrapper({
      briefMarkdown,
      brief,
      discoveries,
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
    const discoveriesDocument = buildA0DiscoveriesDocument({ briefMarkdown, discoveries });
    const graph = projectA0DiagramGraph({
      briefMarkdown,
      brief,
      discoveries,
      discoveriesDocument,
      mode: "filled",
    });

    const interview = projectA0DiagramGraph({
      briefMarkdown,
      brief,
      discoveries,
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
      briefMarkdown,
      discoveries: discoveriesWithoutFlow103Purpose,
    });

    const interview = projectA0DiagramGraph({
      briefMarkdown,
      brief,
      discoveries: discoveriesWithoutFlow103Purpose,
      discoveriesDocument,
      mode: "interview",
    });
    const interviewEdge = interview.edges.find((edge) => edge.id === "flow_103");
    expect(interviewEdge).toBeDefined();
    expect(interviewEdge!.data!.privacy?.purposeStatus).toBe("unknown");
    expect(interviewEdge!.data!.privacy?.categoriesStatus).toBe("known");

    const filled = projectA0DiagramGraph({
      briefMarkdown,
      brief,
      discoveries: discoveriesWithoutFlow103Purpose,
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
