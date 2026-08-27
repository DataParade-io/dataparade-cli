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

  describe("gitea data-item packet", () => {
    const repoDir = path.join(reposRoot, "gitea");

    it("loads a pinned complete Go scope with proposed source-only labels", () => {
      const manifest = loadBenchmarkManifest(repoDir);
      const annotations = loadAnnotations(repoDir, "data_items");

      expect(manifest.repository).toBe("go-gitea/gitea");
      expect(manifest.commit).toBe("0b1067484fcdc497dc34d9113c467182231e6ea9");
      expect(manifest.license).toBe("MIT");
      expect(manifest.scope.include).toEqual([
        "models/auth/access_token.go",
        "modules/structs/user.go",
      ]);
      expect(annotations.length).toBeGreaterThanOrEqual(25);
      expect(new Set(annotations.map((record) => record.id)).size).toBe(annotations.length);
      expect(annotations.every((record) => record.layer === "data_items")).toBe(true);
      expect(annotations.every((record) => record.provenance.review_state === "proposed")).toBe(true);
    });
  });

  for (const packet of [
    {
      key: "saleor",
      repository: "saleor/saleor",
      commit: "030c1676145d63154687fa394d1a4abb224b1ac2",
      license: "BSD-3-Clause",
      minimumRecords: 20,
    },
    {
      key: "keycloak",
      repository: "keycloak/keycloak",
      commit: "b9b70f95f7e092ebadf898378948bab0971e015b",
      license: "Apache-2.0",
      minimumRecords: 15,
    },
    {
      key: "yjdh-employee",
      repository: "City-of-Helsinki/yjdh",
      commit: "b148e187b43dbaab7e6b9c6c4a394fe9e9ab7ee8",
      license: "MIT",
      minimumRecords: 18,
    },
    {
      key: "ory-kratos-password",
      repository: "ory/kratos",
      commit: "b86338da04a040247a07f46100a86dcfb3875909",
      license: "Apache-2.0",
      minimumRecords: 2,
    },
    {
      key: "medusa-customer",
      repository: "medusajs/medusa",
      commit: "847612908fdd1c11a4df09ccc2e8ab44d338bb04",
      license: "MIT (community paths only)",
      minimumRecords: 19,
    },
    {
      key: "posthog-user",
      repository: "PostHog/posthog",
      commit: "a2f78ff63a1c7e1db33c623be83488a651bf4251",
      license: "MIT (community paths only)",
      minimumRecords: 13,
    },
  ]) {
    describe(`${packet.key} data-item packet`, () => {
      it("loads a pinned, complete scope with proposed labels", () => {
        const repoDir = path.join(reposRoot, packet.key);
        const manifest = loadBenchmarkManifest(repoDir);
        const annotations = loadAnnotations(repoDir, "data_items");

        expect(manifest.repository).toBe(packet.repository);
        expect(manifest.commit).toBe(packet.commit);
        expect(manifest.license).toBe(packet.license);
        expect(manifest.scope.include.length).toBeGreaterThan(0);
        expect(annotations.length).toBeGreaterThanOrEqual(packet.minimumRecords);
        expect(annotations.every((record) => record.provenance.review_state === "proposed")).toBe(true);
      });
    });
  }
});
