import fs from "fs";
import os from "os";
import path from "path";

import { discoverServiceSections } from "../../../src/core/sectioning/discover-service-sections";
import { classifyRawFindings } from "../../../src/classifier/classify";
import {
  injectApplicationAssetsPerSectionIfMissing,
} from "../../../src/classifier/application-injection";
import { enhanceComponents } from "../../../src/classifier/enhance";
import { detectTypeScriptPatternsFromDependencyManifests } from "../../../src/analyzers/typescript/dependency-manifests";
import { tagFindingsWithServiceSections } from "../../../src/core/sectioning/discover-service-sections";
import { detectDataFlows } from "../../../src/data-flow";

function write(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

describe("manifest package hub", () => {
  it("creates twenty-companion hub and declared edge to Anthropic from package.json", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-companion-"));
    try {
      write(
        path.join(root, "packages", "twenty-companion", "package.json"),
        JSON.stringify({
          name: "twenty-companion",
          dependencies: {
            "@anthropic-ai/sdk": "^0.30.0",
          },
        }),
      );

      const { sections } = await discoverServiceSections(root);
      const manifestFindings = await detectTypeScriptPatternsFromDependencyManifests(
        root,
      );
      tagFindingsWithServiceSections(manifestFindings, sections);

      const classified = classifyRawFindings(manifestFindings);
      const withHub = injectApplicationAssetsPerSectionIfMissing(
        classified,
        sections,
      );
      const enhanced = enhanceComponents(withHub);
      const flows = detectDataFlows([], enhanced, manifestFindings, sections);

      const hub = enhanced.find(
        (c) =>
          c.properties?.section_id === "packages/twenty-companion" &&
          c.properties?.isMainApplication === true,
      );
      const anthropic = enhanced.find(
        (c) =>
          c.type === "third_party" &&
          c.properties?.section_id === "packages/twenty-companion" &&
          c.name.toLowerCase().includes("anthropic"),
      );

      expect(hub?.name).toBe("twenty-companion");
      expect(anthropic).toBeDefined();

      const declared = flows.find(
        (f) =>
          f.sourceComponentId === hub?.id &&
          f.targetComponentId === anthropic?.id,
      );
      expect(declared).toBeDefined();
      expect(declared?.enrichmentNotes).toBe("declared_dependency");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
