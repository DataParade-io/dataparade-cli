import fs from "fs";
import os from "os";
import path from "path";

import { run } from "../../../src/cli";
import { validateDataflowJson } from "../../../src/core/schema/dataflow-wrapper.schema";
import { INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT } from "../../../src/classifier/application-injection";

type GraphNode = {
  id: string;
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
};

function nodeSourcePaths(node: GraphNode): string[] {
  const locs = node.data?.sourceLocations;
  if (!Array.isArray(locs)) return [];
  return locs
    .map((loc) =>
      typeof loc === "object" && loc && "filePath" in loc
        ? String((loc as { filePath?: string }).filePath ?? "")
        : "",
    )
    .filter(Boolean);
}

describe("cli scan command - monorepo app plus terraform", () => {
  it(
    "keeps app API hub, reduces TF to provider and module shells, and lays out app left of TF hub",
    async () => {
      const fixturesRoot = path.join(
        __dirname,
        "..",
        "..",
        "fixtures",
        "monorepo-app-plus-terraform",
      );

      const outputPath = path.join(
        os.tmpdir(),
        `dataparade-scan-e2e-monorepo-app-plus-terraform-${Date.now()}.json`,
      );

      await run([
        "node",
        "cli",
        "scan",
        fixturesRoot,
        "--output",
        outputPath,
        "--no-ai-inference",
        "--skip-auto-upload",
      ]);

      try {
        const contents = fs.readFileSync(outputPath, "utf8");
        const parsed = JSON.parse(contents);
        const validation = validateDataflowJson(parsed);

        expect(validation.ok).toBe(true);
        if (!validation.ok) return;

        const { graph } = validation.value;
        const nodes = graph.nodes as GraphNode[];

        const sectionApiNodes = nodes.filter(
          (n) => n.data?.isSectionApiNode === true,
        );
        expect(sectionApiNodes.length).toBeGreaterThan(0);
        expect(
          sectionApiNodes.some((n) => n.data?.section_id === "packages/app"),
        ).toBe(true);

        const placeholderUnderTfModules = nodes.filter((n) => {
          const inModuleTree = nodeSourcePaths(n).some((p) =>
            p.replace(/\\/g, "/").includes("terraform/modules/"),
          );
          const sid = n.data?.section_id;
          const inModuleSection =
            typeof sid === "string" && sid.includes("terraform/modules");
          if (!inModuleTree && !inModuleSection) return false;

          const sourceContext = n.data?.sourceContext;
          const isMain =
            n.data?.isMainApplication === true ||
            n.data?.isMainApplication === "true";
          const isActor = n.data?.componentType === "actor";
          return (
            sourceContext === INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT &&
            (isMain || isActor)
          );
        });
        expect(placeholderUnderTfModules).toHaveLength(0);

        const tfHubNodes = nodes.filter((n) => {
          const addr = n.data?.terraform_address;
          return (
            typeof addr === "string" &&
            (addr.startsWith("provider.") || addr.startsWith("module.")) &&
            n.data?.section_id !== "packages/app"
          );
        });
        expect(tfHubNodes.length).toBeGreaterThan(0);

        const providerNodes = tfHubNodes.filter((n) => {
          const addr = n.data?.terraform_address;
          return (
            typeof addr === "string" &&
            addr.startsWith("provider.") &&
            n.data?.componentType === "third_party"
          );
        });
        expect(providerNodes.length).toBeGreaterThan(0);

        const moduleShellNodes = tfHubNodes.filter((n) => {
          const addr = n.data?.terraform_address;
          if (typeof addr !== "string" || !addr.startsWith("module.")) {
            return false;
          }
          const rt = n.data?.resource_type;
          return (
            rt === undefined ||
            rt === null ||
            rt === "" ||
            rt === "unknown"
          );
        });
        expect(moduleShellNodes.length).toBeGreaterThan(0);

        const innerTfResourceNodes = nodes.filter((n) => {
          const rt = n.data?.resource_type;
          if (typeof rt !== "string" || !rt.trim() || rt === "unknown") {
            return false;
          }
          return (
            rt.startsWith("aws_db_") ||
            rt.startsWith("aws_subnet") ||
            rt === "aws_subnet"
          );
        });
        expect(innerTfResourceNodes).toHaveLength(0);

        const appNodes = nodes.filter((n) => n.data?.section_id === "packages/app");
        expect(appNodes.length).toBeGreaterThan(0);

        const maxAppX = Math.max(...appNodes.map((n) => n.position?.x ?? 0));
        const minTfHubX = Math.min(...providerNodes.map((n) => n.position?.x ?? 0));
        expect(maxAppX).toBeLessThan(minTfHubX);

        fs.unlinkSync(outputPath);
      } finally {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
      }
    },
    20000,
  );
});
