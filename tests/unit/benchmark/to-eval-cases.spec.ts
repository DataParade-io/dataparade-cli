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

    it("includes accepted annotations by default", () => {
      expect(annotationsToEvalCases(annotations, fixture)).toHaveLength(2);
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
        exhaustiveScopeFiles: ["app/checker_client.py", "app/models.py"],
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

  describe("reviewStates selector", () => {
    const fixture = "vgs-django";
    const repoDir = path.join(reposRoot, fixture);
    let annotations: AnnotationRecord[];

    beforeAll(() => {
      annotations = loadAnnotations(repoDir, "components");
    });

    it("includes accepted by default", () => {
      expect(annotationsToEvalCases(annotations, fixture)).toHaveLength(2);
    });

    it("includes proposed when reviewStates includes proposed", () => {
      const cases = annotationsToEvalCases(annotations, fixture, {
        reviewStates: ["proposed"],
      });
      expect(cases).toHaveLength(0);
    });

    it("reviewStates overrides includeProposed", () => {
      const cases = annotationsToEvalCases(annotations, fixture, {
        includeProposed: true,
        reviewStates: ["proposed"],
      });
      expect(cases).toEqual([]);
    });

    it("includes both accepted and proposed when both are specified", () => {
      const proposed = annotations.map((a) => ({
        ...a,
        provenance: { ...a.provenance, review_state: "accepted" as const },
      }));
      const cases = annotationsToEvalCases(proposed, fixture, {
        reviewStates: ["accepted", "proposed"],
      });
      expect(cases).toHaveLength(2);
    });
  });

  describe("data_items layer", () => {
    it("converts data_items annotations to data-items eval cases", () => {
      const dataItemAnnotation: AnnotationRecord = {
        id: "test-data-item",
        layer: "data_items",
        subject: { key: "data_item:email", name: "email" },
        evidence: { file_path: "models/user.ts", start_line: 8, end_line: 8 },
        expected: { status: "positive", labels: ["email_address"] },
        rationale: "User email field",
        provenance: {
          proposed_by: "test",
          proposed_at: "2026-08-26",
          review_state: "proposed",
        },
      };

      const evalCase = annotationToEvalCase(dataItemAnnotation, "test-repo", {
        reviewStates: ["proposed"],
      });

      expect(evalCase).toEqual({
        id: "test-data-item",
        fixture: "test-repo",
        layer: "data-items",
        subject: { key: "data_item:email", name: "email" },
        evidence: { file_path: "models/user.ts", start_line: 8, end_line: 8 },
        expected: { status: "positive", labels: ["email_address"] },
        rationale: "User email field",
      });
    });
  });

  describe("easy-school", () => {
    const fixture = "easy-school";
    const repoDir = path.join(reposRoot, fixture);
    let annotations: AnnotationRecord[];

    beforeAll(() => {
      annotations = loadAnnotations(repoDir, "components");
    });

    it("includes accepted annotations by default", () => {
      expect(annotationsToEvalCases(annotations, fixture)).toHaveLength(1);
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
