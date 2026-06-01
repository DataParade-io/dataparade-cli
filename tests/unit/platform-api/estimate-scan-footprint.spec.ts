import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { estimateScanFootprint } from "../../../src/platform-api/estimate-scan-footprint";

describe("estimateScanFootprint", () => {
  it("counts files and bytes under scan root", async () => {
    const root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "dp-footprint-"),
    );
    await fs.promises.writeFile(path.join(root, "a.ts"), "hello");
    await fs.promises.mkdir(path.join(root, "node_modules"), { recursive: true });
    await fs.promises.writeFile(
      path.join(root, "node_modules", "skip.js"),
      "ignored",
    );

    const footprint = await estimateScanFootprint(root);

    expect(footprint.fileCount).toBeGreaterThanOrEqual(1);
    expect(footprint.bytesIngested).toBeGreaterThanOrEqual(5);
  });
});
