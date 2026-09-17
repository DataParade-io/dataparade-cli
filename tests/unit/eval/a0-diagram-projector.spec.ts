import fs from "fs";
import path from "path";

import { validateDataflowJson } from "../../../src/core/schema/dataflow-wrapper.schema";
import {
  A0FilledModeNotImplementedError,
  buildA0DataflowWrapper,
  projectA0DiagramGraph,
} from "../../eval/a0-diagram/a0-diagram-projector";
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

  it("projects dogfood A0 to a valid dataflow.json wrapper in interview mode", () => {
    const wrapper = buildA0DataflowWrapper({
      briefMarkdown,
      brief,
      discoveries,
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
    const graph = projectA0DiagramGraph({
      briefMarkdown,
      brief,
      discoveries,
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
    const graph = projectA0DiagramGraph({
      briefMarkdown,
      brief,
      discoveries,
      mode: "interview",
    });
    const d2 = renderDiagramToD2(graph);
    const svg = renderDiagramToSvg(graph);

    expect(d2).toContain("direction: right");
    expect(d2).toContain("cmp_6 -> cmp_7");
    expect(svg).toContain("<svg");
    expect(svg).toContain("Every repository in the DataParade-io GitHub organization");
  });

  it("stub filled mode with explicit not-implemented error", () => {
    expect(() =>
      projectA0DiagramGraph({
        briefMarkdown,
        brief,
        discoveries,
        mode: "filled",
      }),
    ).toThrow(A0FilledModeNotImplementedError);
  });
});
