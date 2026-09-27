import fs from "fs";
import path from "path";

import { defaultManifestPath, fixturesRoot, loadBriefManifest } from "../../eval/interview-a0/manifest";
import { parseTaxonomyFromSkill } from "../../eval/interview-a0/parse-skill";
import { PINNED_SKILL_SHA } from "../../eval/interview-a0/pins";

describe("interview-a0 parse-skill taxonomy", () => {
  it("parses ActorKind allowlist from ontology row, not write-example table (DATAP-677)", () => {
    const manifest = loadBriefManifest(defaultManifestPath);
    expect(manifest.skill_commit).toBe(PINNED_SKILL_SHA);

    const skillMarkdown = fs.readFileSync(
      path.join(fixturesRoot, manifest.skill_fixture),
      "utf8",
    );
    const taxonomy = parseTaxonomyFromSkill(skillMarkdown);

    expect(taxonomy.actorKinds).toEqual(expect.arrayContaining(["person", "role", "persona"]));
    expect(taxonomy.actorKinds).not.toContain("enum");
    expect(taxonomy.actorKinds).toHaveLength(3);
  });
});
