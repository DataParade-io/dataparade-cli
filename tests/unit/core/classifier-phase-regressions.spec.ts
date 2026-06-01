import { runClassifierPhase } from "../../../src/core/pipeline/classifier-phase";
import type { RawFinding } from "../../../src/core/types/detection";
import type { ServiceSection } from "../../../src/core/sectioning/discover-service-sections";

describe("core/pipeline/classifier-phase regressions", () => {
  it("folds dependency-manifest frontend framework helper into section main app", () => {
    const findings: RawFinding[] = [
      {
        pattern: "express_route",
        name: "Frontend Application",
        confidence: 0.75,
        location: {
          filePath: "frontend/package.json",
          startLine: 1,
          endLine: 1,
        },
        properties: {
          framework: "nextjs",
          sourceContext: "dependency_manifest",
          section_id: "frontend",
          section_label: "frontend",
        },
      },
      {
        pattern: "express_route",
        name: "Route handler",
        confidence: 0.9,
        location: {
          filePath: "frontend/app/api/users/route.ts",
          startLine: 1,
          endLine: 1,
        },
        properties: {
          framework: "next_or_react_route",
          section_id: "frontend",
          section_label: "frontend",
        },
      },
    ];

    const sections: ServiceSection[] = [
      {
        id: "frontend",
        label: "frontend",
        role: "service",
        sectionDir: "frontend",
        manifestPaths: ["frontend/package.json"],
      },
      {
        id: "root",
        label: "root",
        role: "root",
        sectionDir: "",
        manifestPaths: [],
      },
    ];

    const components = runClassifierPhase(findings, sections, {
      projectName: "proj",
      minimumConfidence: 0,
    });

    expect(components.some((c) => c.name === "Nextjs")).toBe(false);

    const frontendMain = components.find(
      (c) =>
        c.properties?.section_id === "frontend" &&
        c.properties?.isMainApplication === true,
    );
    expect(frontendMain).toBeDefined();
    expect(frontendMain?.name).toBe("frontend");

    const framework = frontendMain?.properties?.framework;
    const frameworkValues = Array.isArray(framework) ? framework : [framework];
    expect(frameworkValues).toEqual(
      expect.arrayContaining(["nextjs", "next_or_react_route"]),
    );
  });
});
