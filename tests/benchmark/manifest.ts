import fs from "fs";
import path from "path";
import YAML from "yaml";

import {
  ANNOTATION_STATUSES,
  type AnnotationRecord,
  type BenchmarkLayer,
  type BenchmarkManifest,
  BENCHMARK_LAYERS,
  REVIEW_STATES,
  type ReviewState,
} from "./schema";

function isNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected non-empty string for ${field}`);
  }
  return value.trim();
}

function isRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected object for ${field}`);
  }
  return value as Record<string, unknown>;
}

function isStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Expected string array for ${field}`);
  }
  return value;
}

function validateManifest(raw: Record<string, unknown>, manifestPath: string): BenchmarkManifest {
  const scope = isRecord(raw.scope, `${manifestPath}:scope`);
  const coverage = isRecord(raw.coverage, `${manifestPath}:coverage`);

  const excludeRaw = scope.exclude;
  let exclude: BenchmarkManifest["scope"]["exclude"];
  if (excludeRaw !== undefined) {
    if (!Array.isArray(excludeRaw)) {
      throw new Error(`Expected array for ${manifestPath}:scope.exclude`);
    }
    exclude = excludeRaw.map((entry, index) => {
      const row = isRecord(entry, `${manifestPath}:scope.exclude[${index}]`);
      return {
        path: isNonEmptyString(row.path, `${manifestPath}:scope.exclude[${index}].path`),
        reason: isNonEmptyString(
          row.reason,
          `${manifestPath}:scope.exclude[${index}].reason`,
        ),
      };
    });
  }

  const layers = isStringArray(coverage.layers, `${manifestPath}:coverage.layers`);
  for (const layer of layers) {
    if (!BENCHMARK_LAYERS.includes(layer as BenchmarkLayer)) {
      throw new Error(`Unknown coverage layer '${layer}' in ${manifestPath}`);
    }
  }

  const commit = isNonEmptyString(raw.commit, `${manifestPath}:commit`);
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error(`Expected full commit SHA in ${manifestPath}:commit`);
  }

  const annotationVersion = raw.annotation_version;
  if (typeof annotationVersion !== "number" || !Number.isInteger(annotationVersion)) {
    throw new Error(`Expected integer annotation_version in ${manifestPath}`);
  }

  return {
    repository: isNonEmptyString(raw.repository, `${manifestPath}:repository`),
    commit,
    license: isNonEmptyString(raw.license, `${manifestPath}:license`),
    scope: {
      include: isStringArray(scope.include, `${manifestPath}:scope.include`),
      exclude,
    },
    coverage: {
      layers: layers as BenchmarkLayer[],
      languages: isStringArray(coverage.languages, `${manifestPath}:coverage.languages`),
      domains: isStringArray(coverage.domains, `${manifestPath}:coverage.domains`),
    },
    selection_rationale: isNonEmptyString(
      raw.selection_rationale,
      `${manifestPath}:selection_rationale`,
    ),
    annotation_version: annotationVersion,
  };
}

function validateAnnotation(
  raw: Record<string, unknown>,
  filePath: string,
  index: number,
): AnnotationRecord {
  const prefix = `${filePath}:annotations[${index}]`;
  const layer = isNonEmptyString(raw.layer, `${prefix}:layer`);
  if (!BENCHMARK_LAYERS.includes(layer as BenchmarkLayer)) {
    throw new Error(`Unknown annotation layer '${layer}' in ${prefix}`);
  }

  const subject = isRecord(raw.subject, `${prefix}:subject`);
  const evidence = isRecord(raw.evidence, `${prefix}:evidence`);
  const expected = isRecord(raw.expected, `${prefix}:expected`);
  const provenance = isRecord(raw.provenance, `${prefix}:provenance`);

  const status = isNonEmptyString(expected.status, `${prefix}:expected.status`);
  if (!ANNOTATION_STATUSES.includes(status as AnnotationRecord["expected"]["status"])) {
    throw new Error(`Unknown expected.status '${status}' in ${prefix}`);
  }

  const reviewState = isNonEmptyString(
    provenance.review_state,
    `${prefix}:provenance.review_state`,
  );
  if (!REVIEW_STATES.includes(reviewState as ReviewState)) {
    throw new Error(`Unknown provenance.review_state '${reviewState}' in ${prefix}`);
  }

  const startLine = evidence.start_line;
  const endLine = evidence.end_line;
  if (typeof startLine !== "number" || typeof endLine !== "number") {
    throw new Error(`Expected numeric line evidence in ${prefix}`);
  }

  const labels = expected.labels;
  if (!Array.isArray(labels) || labels.some((item) => typeof item !== "string")) {
    throw new Error(`Expected string array for ${prefix}:expected.labels`);
  }

  const record: AnnotationRecord = {
    id: isNonEmptyString(raw.id, `${prefix}:id`),
    layer: layer as BenchmarkLayer,
    subject: {
      key: isNonEmptyString(subject.key, `${prefix}:subject.key`),
      name:
        typeof subject.name === "string" && subject.name.trim().length > 0
          ? subject.name.trim()
          : undefined,
    },
    evidence: {
      file_path: isNonEmptyString(evidence.file_path, `${prefix}:evidence.file_path`),
      start_line: startLine,
      end_line: endLine,
    },
    rationale: isNonEmptyString(raw.rationale, `${prefix}:rationale`),
    expected: {
      status: status as AnnotationRecord["expected"]["status"],
      labels,
    },
    provenance: {
      proposed_by: isNonEmptyString(
        provenance.proposed_by,
        `${prefix}:provenance.proposed_by`,
      ),
      proposed_at: isNonEmptyString(
        provenance.proposed_at,
        `${prefix}:provenance.proposed_at`,
      ),
      reviewed_by:
        typeof provenance.reviewed_by === "string" &&
        provenance.reviewed_by.trim().length > 0
          ? provenance.reviewed_by.trim()
          : undefined,
      reviewed_at:
        typeof provenance.reviewed_at === "string" &&
        provenance.reviewed_at.trim().length > 0
          ? provenance.reviewed_at.trim()
          : undefined,
      review_state: reviewState as ReviewState,
    },
  };

  return record;
}

export function loadBenchmarkManifest(repoDir: string): BenchmarkManifest {
  const manifestPath = path.join(repoDir, "manifest.yaml");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing manifest at ${manifestPath}`);
  }

  const text = fs.readFileSync(manifestPath, "utf8");
  const parsed = YAML.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Expected YAML object in ${manifestPath}`);
  }

  return validateManifest(parsed as Record<string, unknown>, manifestPath);
}

export function loadAnnotations(repoDir: string, layer: string): AnnotationRecord[] {
  if (!BENCHMARK_LAYERS.includes(layer as BenchmarkLayer)) {
    throw new Error(`Unknown annotation layer '${layer}'`);
  }

  const filePath = path.join(repoDir, "annotations", `${layer}.yaml`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing annotations at ${filePath}`);
  }

  const text = fs.readFileSync(filePath, "utf8");
  const parsed = YAML.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Expected YAML object in ${filePath}`);
  }

  const root = parsed as Record<string, unknown>;
  const annotationsRaw = root.annotations;
  if (!Array.isArray(annotationsRaw)) {
    throw new Error(`Expected annotations array in ${filePath}`);
  }

  return annotationsRaw.map((entry, index) =>
    validateAnnotation(isRecord(entry, `${filePath}:annotations[${index}]`), filePath, index),
  );
}
