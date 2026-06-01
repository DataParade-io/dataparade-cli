import { spawnSync } from "child_process";
import path from "path";

import { runTerraformShowJsonSync } from "../../../src/analyzers/terraform/terraform-exec";

const hasTerraform =
  spawnSync("terraform", ["version"], { encoding: "utf8" }).status === 0;

describe("terraform-exec", () => {
  const itWithTf = hasTerraform ? it : it.skip;

  it("returns ok:false when plan file is missing", () => {
    const scanRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "terraform-basic",
    );
    const res = runTerraformShowJsonSync(scanRoot, "nonexistent.tfplan");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message.length).toBeGreaterThan(0);
  });

  itWithTf(
    "returns ok:false when file is not a valid Terraform plan/state",
    () => {
      const jsonFixture = path.join(
        __dirname,
        "..",
        "..",
        "fixtures",
        "terraform-show-extra-bucket.json",
      );
      const scanRoot = path.dirname(jsonFixture);
      const rel = path.basename(jsonFixture);
      const res = runTerraformShowJsonSync(scanRoot, rel);
      expect(res.ok).toBe(false);
    },
  );
});
