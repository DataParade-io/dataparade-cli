import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";

const cliDistPath = path.join(__dirname, "../../dist/bin/cli.js");

describe("CLI", () => {
  beforeAll(() => {
    if (!existsSync(cliDistPath)) {
      throw new Error(
        `CLI not built. Run 'pnpm build' first. Expected: ${cliDistPath}`,
      );
    }
  });

  it("scan <path> writes a dataflow.json wrapper to the current directory and exits 0", () => {
    const result = spawnSync(
      "node",
      [cliDistPath, "scan", ".", "--no-ai-inference", "--skip-auto-upload"],
      {
        encoding: "utf-8",
        cwd: path.join(__dirname, "../../"),
      },
    );

    expect(result.status).toBe(0);

    const cliCwd = path.join(__dirname, "../../");
    const outputPath = path.join(cliCwd, "dataflow.json");
    const exists = existsSync(outputPath);

    expect(exists).toBe(true);

    const contents = readFileSync(outputPath, "utf8").trim();
    const dataflow = JSON.parse(contents);

    expect(dataflow.schemaVersion).toBeDefined();
    expect(dataflow.graph).toBeDefined();
    expect(Array.isArray(dataflow.graph.nodes)).toBe(true);
    expect(Array.isArray(dataflow.graph.edges)).toBe(true);
  });

  it("scan ../frontend produces a dataflow.json wrapper with at least one node", () => {
    const cliCwd = path.join(__dirname, "../../");
    const frontendPath = "../frontend";

    const result = spawnSync(
      "node",
      [
        cliDistPath,
        "scan",
        frontendPath,
        "--no-ai-inference",
        "--skip-auto-upload",
      ],
      {
        encoding: "utf-8",
        cwd: cliCwd,
      },
    );

    expect(result.status).toBe(0);

    const outputPath = path.join(cliCwd, "dataflow.json");
    const contents = readFileSync(outputPath, "utf8").trim();
    const dataflow = JSON.parse(contents);

    expect(Array.isArray(dataflow.graph.nodes)).toBe(true);
    expect(dataflow.graph.nodes.length).toBeGreaterThan(0);
  });

  it("scan ../frontend --output writes a dataflow.json wrapper to the given file and prints a short message", () => {
    const cliCwd = path.join(__dirname, "../../");
    const frontendPath = "../frontend";
    const outputFile = "scan-frontend-summary.json";

    const result = spawnSync(
      "node",
      [
        cliDistPath,
        "scan",
        frontendPath,
        "--output",
        outputFile,
        "--no-ai-inference",
        "--skip-auto-upload",
      ],
      {
        encoding: "utf-8",
        cwd: cliCwd,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `[scan] dataflow.json written to ${path.join(cliCwd, outputFile)}`,
    );

    const fileContents = readFileSync(
      path.join(cliCwd, outputFile),
      "utf8",
    ).trim();
    const dataflow = JSON.parse(fileContents);

    expect(dataflow.graph).toBeDefined();
    expect(Array.isArray(dataflow.graph.nodes)).toBe(true);
  });

  it("unknown command shows usage and exits non-zero", () => {
    const result = spawnSync("node", [cliDistPath, "unknowncommand"], {
      encoding: "utf-8",
      cwd: path.join(__dirname, "../../"),
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Unknown command|error|usage|Usage/i);
  });

  it("--help shows usage", () => {
    const result = spawnSync("node", [cliDistPath, "--help"], {
      encoding: "utf-8",
      cwd: path.join(__dirname, "../../"),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("dataparade");
    expect(result.stdout).toContain("scan");
  });

  it("scan --help shows scan usage", () => {
    const result = spawnSync("node", [cliDistPath, "scan", "--help"], {
      encoding: "utf-8",
      cwd: path.join(__dirname, "../../"),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/scan|path/i);
  });
});

