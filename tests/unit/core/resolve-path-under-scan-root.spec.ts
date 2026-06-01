import fs from "fs";
import os from "os";
import path from "path";

import { resolvePathUnderScanRoot } from "../../../src/core/pipeline/resolve-path-under-scan-root";

describe("resolvePathUnderScanRoot", () => {
  it("accepts a relative path under the scan root", () => {
    const root = path.resolve("/project/scan");
    const result = resolvePathUnderScanRoot(root, "tf/plan.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolved).toBe(path.resolve(root, "tf/plan.json"));
    }
  });

  it("accepts an absolute path under the scan root", () => {
    const root = path.resolve("/project/scan");
    const inner = path.join(root, "overlay.json");
    const result = resolvePathUnderScanRoot(root, inner);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolved).toBe(inner);
    }
  });

  it("rejects paths that escape the scan root", () => {
    const root = path.resolve("/project/scan");
    const result = resolvePathUnderScanRoot(root, "../../../etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("under scan root");
    }
  });

  it("rejects empty paths", () => {
    const result = resolvePathUnderScanRoot("/project", "   ");
    expect(result.ok).toBe(false);
  });

  it("rejects absolute paths outside the scan root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-scan-root-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "dp-outside-"));
    try {
      const outsideFile = path.join(outside, "plan.json");
      fs.writeFileSync(outsideFile, "{}", "utf8");
      const result = resolvePathUnderScanRoot(root, outsideFile);
      expect(result.ok).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
