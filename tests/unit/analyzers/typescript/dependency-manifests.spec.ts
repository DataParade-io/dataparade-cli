import { promises as fs } from "fs";
import os from "os";
import path from "path";

import { detectTypeScriptPatternsFromDependencyManifests } from "../../../../src/analyzers/typescript/dependency-manifests";

describe("analyzers/typescript/dependency-manifests", () => {
  async function withTempProject(
    packageJson: Record<string, unknown>,
  ): Promise<string> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dp-cli-manifest-"));
    const packageJsonPath = path.join(tmpDir, "package.json");
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), "utf8");
    return tmpDir;
  }

  it("emits a frontend framework finding for React dependencies", async () => {
    const root = await withTempProject({
      name: "sample",
      dependencies: {
        react: "^19.0.0",
      },
    });

    const findings = await detectTypeScriptPatternsFromDependencyManifests(root);
    const frontendFinding = findings.find(
      (f) =>
        f.pattern === "express_route" &&
        f.name === "Frontend Application" &&
        f.properties.framework === "react",
    );

    expect(frontendFinding).toBeDefined();
  });

  it("prefers nextjs over react when both dependencies exist", async () => {
    const root = await withTempProject({
      name: "sample-next",
      dependencies: {
        react: "^19.0.0",
        next: "^15.0.0",
      },
    });

    const findings = await detectTypeScriptPatternsFromDependencyManifests(root);
    const frontendFindings = findings.filter(
      (f) => f.pattern === "express_route" && f.name === "Frontend Application",
    );

    expect(frontendFindings.length).toBe(1);
    expect(frontendFindings[0].properties.framework).toBe("nextjs");
  });

  it("detects third-party services from manifest dependencies", async () => {
    const root = await withTempProject({
      name: "sample-frontend",
      dependencies: {
        "@google/genai": "^1.0.0",
        "@supabase/supabase-js": "^2.0.0",
        openai: "^6.0.0",
      },
    });

    const findings = await detectTypeScriptPatternsFromDependencyManifests(root);
    const externalFindings = findings.filter((f) => f.pattern === "external_api_call");
    const serviceNames = new Set(
      externalFindings
        .map((f) => (typeof f.properties.serviceName === "string" ? f.properties.serviceName : ""))
        .filter(Boolean),
    );

    expect(serviceNames.has("google_ai")).toBe(true);
    expect(serviceNames.has("supabase")).toBe(true);
    expect(serviceNames.has("openai")).toBe(true);
  });
});
