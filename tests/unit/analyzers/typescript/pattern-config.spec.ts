import fs from "fs";

import {
  clearTypeScriptPatternConfigCache,
  loadTypeScriptPatternConfig,
} from "../../../../src/analyzers/typescript/typescript-detection-config";

describe("analyzers/typescript/pattern-config - YAML loader", () => {
  it("loads the YAML config and normalizes it", () => {
    const config = loadTypeScriptPatternConfig();

    expect(config.routes.frameworks.length).toBeGreaterThan(0);
    expect(config.dbClients.length).toBeGreaterThan(0);
    expect(config.auth.libraries.length).toBeGreaterThan(0);
    expect(config.configKeys.keys.length).toBeGreaterThan(0);
  });

  it("throws when the YAML file cannot be loaded", () => {
    clearTypeScriptPatternConfigCache();
    jest.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
      throw new Error("simulated read error");
    });

    expect(() => loadTypeScriptPatternConfig()).toThrow(
      /TypeScript pattern config is required but could not be read/,
    );

    jest.restoreAllMocks();
  });
});

