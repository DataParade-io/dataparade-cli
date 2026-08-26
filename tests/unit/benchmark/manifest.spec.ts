import path from "path";

import {
  loadAnnotations,
  loadBenchmarkManifest,
} from "../../benchmark/manifest";
import type { AnnotationRecord } from "../../benchmark/schema";

const STARTER_REPOS = ["vgs-django", "easy-school"] as const;

const reposRoot = path.join(__dirname, "../../benchmark/repos");

describe("benchmark corpus manifests", () => {
  for (const repoKey of STARTER_REPOS) {
    const repoDir = path.join(reposRoot, repoKey);

    describe(repoKey, () => {
      let manifest: ReturnType<typeof loadBenchmarkManifest>;
      let annotations: AnnotationRecord[];

      beforeAll(() => {
        manifest = loadBenchmarkManifest(repoDir);
        annotations = loadAnnotations(repoDir, "components");
      });

      it("loads a valid manifest", () => {
        expect(manifest.repository).toMatch(/^[^/]+\/[^/]+$/);
        expect(manifest.commit).toMatch(/^[a-f0-9]{40}$/);
        expect(manifest.license.length).toBeGreaterThan(0);
        expect(manifest.scope.include.length).toBeGreaterThan(0);
        expect(manifest.coverage.layers).toContain("components");
        expect(manifest.coverage.languages.length).toBeGreaterThan(0);
        expect(manifest.selection_rationale.length).toBeGreaterThan(0);
        expect(manifest.annotation_version).toBeGreaterThanOrEqual(1);
      });

      it("loads component annotations with explicit review states", () => {
        expect(annotations.length).toBeGreaterThanOrEqual(1);

        for (const record of annotations) {
          expect(record.layer).toBe("components");
          expect(record.subject.key).toMatch(/^(asset|actor|third_party):/);
          expect(record.evidence.file_path.length).toBeGreaterThan(0);
          expect(record.evidence.start_line).toBeGreaterThan(0);
          expect(record.evidence.end_line).toBeGreaterThanOrEqual(
            record.evidence.start_line,
          );
          expect(record.expected.labels.length).toBeGreaterThan(0);
          expect(record.provenance.review_state).toBe("proposed");
          expect(record.provenance.proposed_by.length).toBeGreaterThan(0);
          expect(record.provenance.proposed_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      });

      it("uses unique annotation ids", () => {
        const ids = annotations.map((record) => record.id);
        expect(new Set(ids).size).toBe(ids.length);
      });
    });
  }

  describe("hyperswitch-vault data-item packet", () => {
    const repoDir = path.join(reposRoot, "hyperswitch-vault");
    let manifest: ReturnType<typeof loadBenchmarkManifest>;
    let annotations: AnnotationRecord[];

    beforeAll(() => {
      manifest = loadBenchmarkManifest(repoDir);
      annotations = loadAnnotations(repoDir, "data_items");
    });

    it("loads a pinned Rust card-vault scope", () => {
      expect(manifest.repository).toBe("juspay/hyperswitch-card-vault");
      expect(manifest.commit).toBe("abfca8e078039582460335be73341699ee826615");
      expect(manifest.license).toBe("Apache-2.0");
      expect(manifest.scope.include).toEqual(["src/routes/data/types.rs"]);
      expect(manifest.coverage.layers).toEqual(["data_items"]);
    });

    it("keeps every source-only data-item decision proposed", () => {
      expect(annotations.length).toBeGreaterThanOrEqual(20);
      expect(new Set(annotations.map((record) => record.id)).size).toBe(annotations.length);

      for (const record of annotations) {
        expect(record.layer).toBe("data_items");
        expect(record.subject.key).toMatch(/^data_item:/);
        expect(record.evidence.file_path).toBe("src/routes/data/types.rs");
        expect(record.evidence.start_line).toBeGreaterThan(0);
        expect(record.evidence.end_line).toBeGreaterThanOrEqual(record.evidence.start_line);
        expect(record.provenance.review_state).toBe("proposed");
      }
    });
  });
});
