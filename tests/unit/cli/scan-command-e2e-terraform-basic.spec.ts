import fs from "fs";
import os from "os";
import path from "path";
import { run } from "../../../src/cli";
import { validateDataflowJson } from "../../../src/core/schema/dataflow-wrapper.schema";

describe("cli scan command - terraform-basic fixture", () => {
  it(
    "scans terraform-basic fixture and produces valid dataflow.json with nodes and edges",
    async () => {
      const prevAiInference = process.env.DATAPARADE_AI_INFERENCE;
      process.env.DATAPARADE_AI_INFERENCE = "false";

      const fixturesRoot = path.join(
        __dirname,
        "..",
        "..",
        "fixtures",
        "terraform-basic",
      );

      const outputPath = path.join(
        os.tmpdir(),
        `dataparade-scan-e2e-terraform-basic-${Date.now()}.json`,
      );

      try {
        await run(["node", "cli", "scan", fixturesRoot, "--output", outputPath]);

        const contents = fs.readFileSync(outputPath, "utf8");
        const parsed = JSON.parse(contents);
        const validation = validateDataflowJson(parsed);

        expect(validation.ok).toBe(true);
        if (!validation.ok) return;

        const { graph } = validation.value;
        expect(Array.isArray(graph.nodes)).toBe(true);
        expect(Array.isArray(graph.edges)).toBe(true);
        expect(graph.nodes.length).toBeGreaterThan(1);
        expect(graph.edges.length).toBeGreaterThan(0);

        const dbNode = graph.nodes.find((node) => {
          const data = node.data as Record<string, unknown>;
          return (
            data &&
            data.componentType === "asset" &&
            data.componentSubType === "database"
          );
        });
        expect(dbNode).toBeDefined();

        const lambdaNode = graph.nodes.find((node) => {
          const data = node.data as Record<string, unknown>;
          return (
            data &&
            data.componentType === "asset" &&
            (data.managed_service_key === "lambda" ||
              data.resource_type === "aws_lambda_function")
          );
        });
        expect(lambdaNode).toBeDefined();

        const iamNode = graph.nodes.find((node) => {
          const data = node.data as Record<string, unknown>;
          return (
            typeof data.resource_type === "string" &&
            data.resource_type.startsWith("aws_iam_")
          );
        });
        expect(iamNode).toBeUndefined();

        fs.unlinkSync(outputPath);
      } finally {
        if (prevAiInference === undefined) {
          delete process.env.DATAPARADE_AI_INFERENCE;
        } else {
          process.env.DATAPARADE_AI_INFERENCE = prevAiInference;
        }
      }
    },
    15000,
  );
});
