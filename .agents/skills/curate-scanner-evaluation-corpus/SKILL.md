---
name: curate-scanner-evaluation-corpus
description: Select and pin third-party repositories for deterministic scanner evaluation, define exhaustive annotation scopes, prepare human-review worksheets, maintain versioned ground truth, and adjudicate disputed or corrected labels without leaking current scanner behavior into the benchmark. Use when building or expanding a precision, recall, label-accuracy, PII, component, data-flow, or data-item evaluation corpus; reviewing candidate repositories; annotating source code; or changing existing ground-truth labels.
---

# Curate Scanner Evaluation Corpus

Build a durable benchmark whose labels are independent of the scanner version being evaluated. Let agents accelerate discovery and evidence gathering; require humans to approve ground truth.

## Choose the workflow

- For repository discovery or corpus expansion, follow **Select repositories**.
- For first-time labeling, follow **Prepare an annotation packet** and **Adjudicate annotations**.
- For a disputed or changed label, follow **Correct ground truth**.
- For an evaluation run, follow **Protect metric integrity**.

Read [references/ground-truth-schema.md](references/ground-truth-schema.md) before creating or changing annotation records.

## Select repositories

1. Define the missing coverage before searching: output layer, language, framework, data domain, sensitive-data classes, and detection techniques.
2. Select repositories for the relevant data and code constructs they contain, not for what the current scanner already finds.
3. Inspect source and license before accepting a candidate. Reject repositories dominated by generated, vendored, minified, synthetic, or legally unusable material.
4. Prefer mature repositories with stable history and source that can be pinned to an exact commit.
5. Choose a manageable complete-file or complete-directory annotation scope. Avoid isolated handpicked lines when precision will be claimed.
6. Include both likely positives and realistic confusing negatives. Do not require the current scanner to read the language before selecting a useful repository.
7. Record why the repository adds coverage and how it differs from the existing corpus.

Do not use scanner output as the sole discovery mechanism. Search source semantics, framework models, schemas, types, migrations, API contracts, and domain terminology independently.

## Prepare an annotation packet

1. Materialize the exact pinned commit and verify its identity.
2. Inventory every source file inside the declared scope.
3. Exclude files only through an explicit recorded rule.
4. Present each scanner-relevant declaration or relationship with enough surrounding context to judge its meaning.
5. Propose a status and canonical label with source-based rationale.
6. Flag uncertainty instead of forcing a positive or negative answer.
7. Prepare the packet without showing the human the current scanner verdict by default. Reveal it only during explicit disagreement analysis.

For every record, capture location, subject identity, expected status, labels, rationale, annotation provenance, and review state. Use `ambiguous` when reasonable reviewers could disagree and `unread` only for evaluation coverage, never as a semantic label.

## Adjudicate annotations

Require human review for every new or changed ground-truth record.

Use this decision order:

1. Determine what the code represents in its application domain.
2. Apply the written taxonomy definition.
3. Decide whether the finding belongs to the evaluated output layer.
4. Assign canonical labels only after the prior decisions.
5. Mark unresolved cases `ambiguous` and exclude them from headline metric denominators.

Do not infer correctness from scanner agreement. Do not weaken a label because the scanner misses it. Do not add a negative merely because the scanner currently leaves it clean.

## Correct ground truth

Treat scanner disagreement as an investigation trigger, not permission to edit the benchmark.

1. Inspect the pinned source, surrounding context, taxonomy, and original rationale.
2. Classify the outcome as scanner defect, annotation defect, taxonomy change, scope defect, or unresolved ambiguity.
3. For an annotation or scope defect, create a separate corpus change with before and after values, evidence, rationale, reviewer, and date.
4. Recompute the baseline against both the old and new corpus when practical.
5. Report corpus-driven metric changes separately from scanner-driven changes.
6. Preserve history; never silently rewrite an accepted label.

Do not mix ground-truth corrections into a scanner implementation commit unless the user explicitly requests it and the changes remain separately reviewable.

## Protect metric integrity

Compute metrics only within evaluable, declared scopes.

- Recall: matched positive ground truth divided by all evaluable positives.
- Label accuracy: correctly labelled matches divided by matched positives.
- Correct-label recall: correctly labelled matches divided by all evaluable positives.
- Precision: matched valid findings divided by all scanner findings inside exhaustively annotated scopes.
- Negative-case pass rate: explicit negative cases left clean. Never present this as precision.
- Unread: cases whose exact files were not scanned. Report separately.

Count every unmatched scanner finding inside an exhaustively annotated scope as a false positive or route it to adjudication before publishing precision. Normalize paths and line ranges, but require layer-specific identity when multiple findings can overlap a location.

Report two change sets whenever the corpus changed:

```text
Scanner delta: precision 82% -> 87%, recall 71% -> 74%
Corpus delta: 4 labels corrected, 2 positives added, 1 case marked ambiguous
```

## Deliverables

Produce the artifacts requested by the repository, normally:

- candidate-repository rationale and pinned commit;
- declared annotation scope and exclusions;
- human-review worksheet or equivalent records;
- accepted ground-truth data with review state;
- corpus change note for corrections;
- evaluation summary separating scanner and corpus deltas.

Verify the physical ground-truth files, pinned source identity, and resulting metric denominators before claiming completion.
