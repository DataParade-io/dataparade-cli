import fs from "fs";
import os from "os";
import path from "path";

import { run } from "../../../src/cli";

describe("cli config command", () => {
  it("prints effective configuration as JSON", async () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await run(["node", "cli", "config"]);

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("redacts SCAN_BYOK_API_KEY in printed JSON", async () => {
    const previous = process.env.SCAN_BYOK_API_KEY;
    process.env.SCAN_BYOK_API_KEY = "sk-must-not-appear-in-output";
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    try {
      await run(["node", "cli", "config"]);
      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).not.toContain("sk-must-not-appear-in-output");
      expect(output).toContain("<redacted>");
    } finally {
      consoleSpy.mockRestore();
      if (previous === undefined) {
        delete process.env.SCAN_BYOK_API_KEY;
      } else {
        process.env.SCAN_BYOK_API_KEY = previous;
      }
    }
  });

  it("loads dataparade.config.json from the given project path", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dp-cli-config-path-"));
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      fs.writeFileSync(
        path.join(tempRoot, "dataparade.config.json"),
        JSON.stringify({ projectName: "config-path-fixture" }),
        "utf8",
      );

      await run(["node", "cli", "config", tempRoot]);

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toContain("config-path-fixture");
    } finally {
      consoleSpy.mockRestore();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

