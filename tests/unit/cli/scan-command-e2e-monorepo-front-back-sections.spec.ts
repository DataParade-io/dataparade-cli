import fs from "fs";
import os from "os";
import path from "path";

import { run } from "../../../src/cli";
import { validateDataflowJson } from "../../../src/core/schema/dataflow-wrapper.schema";

describe("cli scan command - monorepo sections", () => {
  it(
    "tags nodes with section_id and avoids cross-section edges",
    async () => {
      const fixturesRoot = path.join(
        __dirname,
        "..",
        "..",
        "fixtures",
        "monorepo-front-back-sections",
      );

      const outputPath = path.join(
        os.tmpdir(),
        `dataparade-scan-e2e-monorepo-front-back-sections-${Date.now()}.json`,
      );

      await run(["node", "cli", "scan", fixturesRoot, "--output", outputPath]);

      const contents = fs.readFileSync(outputPath, "utf8");
      const parsed = JSON.parse(contents);
      const validation = validateDataflowJson(parsed);

      expect(validation.ok).toBe(true);
      if (!validation.ok) return;

      const { graph } = validation.value;

      const sectionIds = new Set(
        graph.nodes
          .map((n: any) => n?.data?.section_id)
          .filter((v: unknown) => typeof v === "string" && v.trim().length > 0),
      );

      expect(sectionIds.size).toBeGreaterThanOrEqual(2);

      // section_role is a user-facing hint: root vs service.
      for (const node of graph.nodes as any[]) {
        const sectionId = node?.data?.section_id;
        if (typeof sectionId !== "string" || !sectionId.trim()) continue;
        const sectionRole = node?.data?.section_role;
        expect(sectionRole).toBeDefined();
        if (sectionId === "root") {
          expect(sectionRole).toBe("root");
        } else {
          expect(sectionRole).toBe("service");
        }
      }

      const hasGlobalNode = graph.nodes.some(
        (n: any) => n?.data?.section_id === "global",
      );
      expect(hasGlobalNode).toBe(false);

      const nodeSectionId = new Map(
        graph.nodes.map((n: any) => [n.id, n?.data?.section_id] as const),
      );

      const isConcreteServiceSection = (sid: unknown): boolean => {
        if (typeof sid !== "string") return false;
        if (!sid.trim()) return false;
        if (sid === "root") return false;
        if (sid === "<unsectioned>") return false;
        if (sid === "global") return false;
        return true;
      };

      const hasCrossSectionEdge = graph.edges.some((e) => {
        const src = nodeSectionId.get(e.source);
        const tgt = nodeSectionId.get(e.target);
        const srcConcrete = isConcreteServiceSection(src);
        const tgtConcrete = isConcreteServiceSection(tgt);
        return srcConcrete && tgtConcrete && src !== tgt;
      });

      expect(hasCrossSectionEdge).toBe(false);

      const hasExpressRouteEvidence = graph.nodes.some((n: any) =>
        Array.isArray(n?.data?.detectedFrom)
          ? n.data.detectedFrom.some((ref: any) => ref?.pattern === "express_route")
          : false,
      );
      const sectionApiNodes = graph.nodes.filter(
        (n: any) => n?.data?.isSectionApiNode === true,
      );

      if (hasExpressRouteEvidence) {
        expect(sectionApiNodes.length).toBeGreaterThan(0);
      }

      fs.unlinkSync(outputPath);
    },
    20000,
  );
});

