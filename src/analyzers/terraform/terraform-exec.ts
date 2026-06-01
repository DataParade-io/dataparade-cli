import { spawnSync } from "child_process";

/**
 * Run `terraform show -json <planFile>` with cwd set to the scan root.
 * Requires the `terraform` binary on `PATH`.
 */
export function runTerraformShowJsonSync(
  scanRoot: string,
  planRelativePath: string,
):
  | { ok: true; doc: Record<string, unknown> }
  | { ok: false; message: string } {
  const result = spawnSync(
    "terraform",
    ["show", "-json", planRelativePath],
    {
      cwd: scanRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  if (result.error) {
    return { ok: false, message: result.error.message };
  }

  if (result.status !== 0) {
    const stderr =
      typeof result.stderr === "string"
        ? result.stderr
        : String(result.stderr ?? "");
    return {
      ok: false,
      message: stderr.trim() || `terraform exited with code ${result.status}`,
    };
  }

  try {
    const doc = JSON.parse(result.stdout as string) as Record<string, unknown>;
    return { ok: true, doc };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `invalid JSON from terraform show: ${msg}` };
  }
}
