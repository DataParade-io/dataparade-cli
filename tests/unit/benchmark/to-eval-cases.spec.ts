import path from "path";

import { loadAnnotations } from "../../benchmark/manifest";
import {
  annotationToEvalCase,
  annotationsToEvalCases,
} from "../../benchmark/to-eval-cases";
import type { AnnotationRecord } from "../../benchmark/schema";

const reposRoot = path.join(__dirname, "../../benchmark/repos");

describe("benchmark to eval cases", () => {
  describe("vgs-django", () => {
    const fixture = "vgs-django";
    const repoDir = path.join(reposRoot, fixture);
    let annotations: AnnotationRecord[];

    beforeAll(() => {
      annotations = loadAnnotations(repoDir, "components");
    });

    it("excludes proposed annotations by default", () => {
      expect(annotationsToEvalCases(annotations, fixture)).toEqual([]);
    });

    it("maps proposed annotations when includeProposed is true", () => {
      const cases = annotationsToEvalCases(annotations, fixture, {
        includeProposed: true,
      });

      expect(cases).toHaveLength(2);
      expect(cases.map((entry) => entry.id)).toEqual([
        "vgs-django-database-pii",
        "vgs-django-third-party-checkr",
      ]);
    });

    it("maps subject, evidence, and expected fields directly", () => {
      const databaseCase = annotationToEvalCase(
        annotations.find((entry) => entry.id === "vgs-django-database-pii")!,
        fixture,
        { includeProposed: true },
      );

      expect(databaseCase).toEqual({
        id: "vgs-django-database-pii",
        fixture: "vgs-django",
        layer: "components",
        subject: { key: "asset:database", name: "Database" },
        evidence: {
          file_path: "app/models.py",
          start_line: 4,
          end_line: 6,
        },
        expected: { status: "positive", labels: ["database"] },
        rationale: expect.stringContaining("PiiData Django model"),
      });
      expect(databaseCase?.expected).not.toHaveProperty("documentedGap");
    });

    it("skips rejected annotations even when includeProposed is true", () => {
      const rejected: AnnotationRecord = {
        ...annotations[0]!,
        id: "rejected-copy",
        provenance: {
          ...annotations[0]!.provenance,
          review_state: "rejected",
        },
      };

      expect(
        annotationToEvalCase(rejected, fixture, { includeProposed: true }),
      ).toBeNull();
    });
  });

  describe("easy-school", () => {
    const fixture = "easy-school";
    const repoDir = path.join(reposRoot, fixture);
    let annotations: AnnotationRecord[];

    beforeAll(() => {
      annotations = loadAnnotations(repoDir, "components");
    });

    it("excludes proposed annotations by default", () => {
      expect(annotationsToEvalCases(annotations, fixture)).toEqual([]);
    });

    it("maps proposed annotations when includeProposed is true", () => {
      const cases = annotationsToEvalCases(annotations, fixture, {
        includeProposed: true,
      });

      expect(cases).toHaveLength(1);
      expect(cases[0]).toMatchObject({
        id: "easy-school-database-guardian-ssn",
        fixture: "easy-school",
        layer: "components",
        subject: { key: "asset:database", name: "Database" },
        evidence: {
          file_path: "students/models.py",
          start_line: 57,
          end_line: 61,
        },
        expected: { status: "positive", labels: ["database"] },
      });
      expect(cases[0]?.expected).not.toHaveProperty("documentedGap");
    });
  });
});
