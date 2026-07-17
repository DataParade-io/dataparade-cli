import path from "path";
import fs from "fs";
import os from "os";

import { resolveScanConfiguration } from "../../../src/config/resolve";

describe("resolveScanConfiguration", () => {
  const cwd = path.join(__dirname, "..", "..", "..");

  it("returns empty overrides when no config file, env, or flags are present", () => {
    const { overrides, warnings } = resolveScanConfiguration({
      cwd,
      flags: {},
    });

    expect(warnings).toEqual([]);
    expect(overrides).toEqual({});
  });

  it("normalizes minimumConfidence from flags", () => {
    const { overrides } = resolveScanConfiguration({
      cwd,
      flags: { minimumConfidence: 2 },
    });

    expect(overrides.minimumConfidence).toBe(1);
  });

  it("applies exclude patterns from flags", () => {
    const { overrides } = resolveScanConfiguration({
      cwd,
      flags: { exclude: ["node_modules", "dist"] },
    });

    expect(overrides.excludePaths).toEqual(["node_modules", "dist"]);
  });

  it("maps terraform CLI flags to ScanConfiguration fields", () => {
    const { overrides } = resolveScanConfiguration({
      cwd,
      flags: {
        terraformJson: " ./out.json ",
        terraformPlan: "tfplan",
      },
    });

    expect(overrides.terraformJsonPath).toBe("./out.json");
    expect(overrides.terraformPlanPath).toBe("tfplan");
  });

  it("accepts python language from flags", () => {
    const { overrides } = resolveScanConfiguration({
      cwd,
      flags: { language: ["python"] },
    });

    expect(overrides.languages).toEqual(["python"]);
  });

  it("accepts python language from dataparade.config.json", () => {
    const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "dp-cli-config-"));
    const configPath = path.join(tempCwd, "dataparade.config.json");

    try {
      fs.writeFileSync(
        configPath,
        JSON.stringify({ languages: ["python"] }),
        "utf8",
      );

      const { overrides } = resolveScanConfiguration({
        cwd: tempCwd,
        flags: {},
      });

      expect(overrides.languages).toEqual(["python"]);
    } finally {
      fs.rmSync(tempCwd, { recursive: true, force: true });
    }
  });

  it("reads terraformStackSectionPathDepth from dataparade.config.json", () => {
    const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "dp-cli-tfsec-"));
    const configPath = path.join(tempCwd, "dataparade.config.json");

    try {
      fs.writeFileSync(
        configPath,
        JSON.stringify({ terraformStackSectionPathDepth: 3 }),
        "utf8",
      );

      const { overrides } = resolveScanConfiguration({
        cwd: tempCwd,
        flags: {},
      });

      expect(overrides.terraformStackSectionPathDepth).toBe(3);
    } finally {
      fs.rmSync(tempCwd, { recursive: true, force: true });
    }
  });

  it("reads aiProviderConcurrency from SCAN_AI_PROVIDER_CONCURRENCY", () => {
    const previous = process.env.SCAN_AI_PROVIDER_CONCURRENCY;
    process.env.SCAN_AI_PROVIDER_CONCURRENCY = "2";
    try {
      const { overrides } = resolveScanConfiguration({
        cwd,
        flags: {},
      });
      expect(overrides.aiProviderConcurrency).toBe(2);
    } finally {
      if (previous === undefined) {
        delete process.env.SCAN_AI_PROVIDER_CONCURRENCY;
      } else {
        process.env.SCAN_AI_PROVIDER_CONCURRENCY = previous;
      }
    }
  });

  it("does not set enableAiInference from BYOK envs alone (default comes from createDefaultScanConfiguration)", () => {
    const prevProvider = process.env.SCAN_BYOK_PROVIDER;
    const prevModel = process.env.SCAN_BYOK_MODEL;
    const prevKey = process.env.SCAN_BYOK_API_KEY;
    const prevInference = process.env.SCAN_AI_INFERENCE;
    process.env.SCAN_BYOK_PROVIDER = "openai";
    process.env.SCAN_BYOK_MODEL = "gpt-4o-mini";
    process.env.SCAN_BYOK_API_KEY = "sk-test";
    delete process.env.SCAN_AI_INFERENCE;
    try {
      const { overrides } = resolveScanConfiguration({ cwd, flags: {} });
      expect(overrides.enableAiInference).toBeUndefined();
    } finally {
      if (prevProvider === undefined) delete process.env.SCAN_BYOK_PROVIDER;
      else process.env.SCAN_BYOK_PROVIDER = prevProvider;
      if (prevModel === undefined) delete process.env.SCAN_BYOK_MODEL;
      else process.env.SCAN_BYOK_MODEL = prevModel;
      if (prevKey === undefined) delete process.env.SCAN_BYOK_API_KEY;
      else process.env.SCAN_BYOK_API_KEY = prevKey;
      if (prevInference === undefined) delete process.env.SCAN_AI_INFERENCE;
      else process.env.SCAN_AI_INFERENCE = prevInference;
    }
  });

  it("warns and drops invalid SCAN_BYOK_PROVIDER", () => {
    const previous = process.env.SCAN_BYOK_PROVIDER;
    process.env.SCAN_BYOK_PROVIDER = "open-ai";
    try {
      const { overrides, warnings } = resolveScanConfiguration({
        cwd,
        flags: {},
      });
      expect(overrides.aiProvider).toBeUndefined();
      expect(warnings.some((w) => w.includes("Unknown SCAN_BYOK_PROVIDER"))).toBe(
        true,
      );
    } finally {
      if (previous === undefined) {
        delete process.env.SCAN_BYOK_PROVIDER;
      } else {
        process.env.SCAN_BYOK_PROVIDER = previous;
      }
    }
  });

  it("reads third-party data-flow toggle from SCAN_AI_THIRD_PARTY_DATA_FLOW", () => {
    const previous = process.env.SCAN_AI_THIRD_PARTY_DATA_FLOW;
    process.env.SCAN_AI_THIRD_PARTY_DATA_FLOW = "false";
    try {
      const { overrides } = resolveScanConfiguration({
        cwd,
        flags: {},
      });
      expect(overrides.aiThirdPartyDataFlowEnabled).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.SCAN_AI_THIRD_PARTY_DATA_FLOW;
      } else {
        process.env.SCAN_AI_THIRD_PARTY_DATA_FLOW = previous;
      }
    }
  });
});

