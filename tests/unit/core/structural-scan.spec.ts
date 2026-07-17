import path from "path";

import { createDefaultScanConfiguration } from "../../../src/core/pipeline/orchestrator";
import {
  runStructuralScan,
  runStructuralScanPhase,
} from "../../../src/core/pipeline/structural-scan";

describe("core/pipeline/structural-scan - DP-P0-CLI-303", () => {
  it("populates ScanResult.dataFlows for a simple TS/JS fixture project", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "typescript-basic",
    );

    const { scanResult } = await runStructuralScan(fixturesRoot);

    expect(scanResult.components.length).toBeGreaterThan(0);
    expect(scanResult.dataFlows.length).toBeGreaterThan(0);

    for (const flow of scanResult.dataFlows) {
      expect(typeof flow.sourceComponentId).toBe("string");
      expect(flow.sourceComponentId).not.toHaveLength(0);
      expect(typeof flow.targetComponentId).toBe("string");
      expect(flow.targetComponentId).not.toHaveLength(0);
      expect([
        "api_call",
        "database_query",
        "message_queue",
        "file_transfer",
        "webhook",
        "rpc",
      ]).toContain(flow.type);
    }
  });

  it("DP-P0-CLI-304: detects structural flows by category for typescript-basic fixture", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "typescript-basic",
    );

    const { scanResult, findings } = await runStructuralScan(fixturesRoot);

    const componentsById = new Map(
      scanResult.components.map((component) => [component.id, component]),
    );

    const databaseFlows = scanResult.dataFlows.filter(
      (flow) => flow.type === "database_query",
    );
    const apiOrWebhookFlows = scanResult.dataFlows.filter(
      (flow) => flow.type === "api_call" || flow.type === "webhook",
    );

    const thirdPartyFlows = apiOrWebhookFlows.filter((flow) => {
      const target = componentsById.get(flow.targetComponentId);
      return target?.type === "third_party";
    });

    const serviceToServiceFlows = scanResult.dataFlows.filter((flow) => {
      const source = componentsById.get(flow.sourceComponentId);
      const target = componentsById.get(flow.targetComponentId);
      return source?.type === "asset" && target?.type === "asset";
    });

    // Assert counts per category for the typescript-basic fixture.
    expect(databaseFlows.length).toBe(1);
    expect(thirdPartyFlows.length).toBe(1);
    // Merged HTTP API hub plus per-section API synthesis: express_route wiring can use
    // the section API node, and detectDataFlows adds a synthetic main → section-API edge.
    expect(serviceToServiceFlows.length).toBe(2);

    // DB interaction: asset → database asset.
    const dbFlow = databaseFlows[0];
    const dbSource = componentsById.get(dbFlow.sourceComponentId);
    const dbTarget = componentsById.get(dbFlow.targetComponentId);
    expect(dbSource?.type).toBe("asset");
    expect(dbTarget?.type).toBe("asset");
    expect(dbTarget?.subType).toBe("database");

    // External service call: asset → third_party (Stripe).
    const tpFlow = thirdPartyFlows[0];
    const tpSource = componentsById.get(tpFlow.sourceComponentId);
    const tpTarget = componentsById.get(tpFlow.targetComponentId);
    expect(tpSource?.type).toBe("asset");
    expect(tpTarget?.type).toBe("third_party");
    expect(tpFlow.endpoint).toBe("https://api.stripe.com/v1/customers");

    const dbS2s = serviceToServiceFlows.find((f) => f.id === dbFlow.id);
    expect(dbS2s).toBeDefined();
    const mainToSectionApi = serviceToServiceFlows.find(
      (f) =>
        f.targetScopeReason === "main-to-section-api" &&
        (componentsById.get(f.targetComponentId)?.properties?.isSectionApiNode === true ||
          componentsById.get(f.targetComponentId)?.properties?.isSectionApiNode === "true"),
    );
    expect(mainToSectionApi).toBeDefined();
    expect(mainToSectionApi?.targetScope).toBe("local");
  });

  it("rejects terraformJsonPath outside scan root", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "typescript-basic",
    );
    const outside = path.join(
      fixturesRoot,
      "..",
      "terraform-show-extra-bucket.json",
    );
    const warnings: string[] = [];
    const config = createDefaultScanConfiguration({ enableAiInference: false,
      terraformJsonPath: outside,
    });

    await runStructuralScanPhase(fixturesRoot, config, (w) => warnings.push(w));

    expect(
      warnings.some((w) => w.includes("terraform-json: path must be under scan root")),
    ).toBe(true);
  });
});

