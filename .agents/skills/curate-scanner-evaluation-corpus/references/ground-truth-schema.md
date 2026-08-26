# Ground-truth record guidance

Use the repository's native serialization format when one exists. Preserve these concepts even if field names differ.

## Corpus manifest

```yaml
repository: owner/name
commit: full-commit-sha
license: SPDX-or-reviewed-license
scope:
  include:
    - path/to/complete/file-or-directory
  exclude:
    - path: path/to/generated/file
      reason: generated source
coverage:
  layers: [components, data_flows, pii_signals, data_items]
  languages: [python]
  domains: [healthcare]
selection_rationale: What independent coverage this repository adds.
annotation_version: 1
```

Use full immutable commit identifiers. Treat line numbers as evidence pointers, not record identity, because later annotation-only edits may move lines.

## Annotation record

```yaml
id: stable-human-readable-id
layer: data_items
subject:
  key: canonical-layer-specific-identity
  name: declared_identifier
evidence:
  file_path: repository/relative/path.py
  start_line: 42
  end_line: 42
expected:
  status: positive # positive | negative | ambiguous
  labels: [phone_number]
rationale: Why the source represents or does not represent the concept.
provenance:
  proposed_by: agent-or-human
  proposed_at: YYYY-MM-DD
  reviewed_by: human-identity
  reviewed_at: YYYY-MM-DD
  review_state: accepted # proposed | accepted | rejected | needs_adjudication
```

`unread` is evaluation-run state, not annotation truth. Store it in results with the exact scanned-file inventory.

## Exhaustive scope requirements

To calculate true precision, declare a scope in which every relevant scanner finding can be judged. A list of selected positive and negative lines is not exhaustive.

For each included file:

1. Review every declaration, relationship, or signal relevant to the evaluated layer.
2. Record all positives.
3. Record explicit negatives when they are valuable regression traps.
4. Treat any scanner output not matching accepted positive ground truth as a false-positive candidate.
5. Adjudicate false-positive candidates before publishing final precision.

If exhaustive review is incomplete, publish recall and negative-case results only. Label any output-derived precision as provisional.

## Correction record

```yaml
annotation_id: stable-human-readable-id
change_type: annotation_defect # annotation_defect | taxonomy_change | scope_change
before:
  status: negative
  labels: []
after:
  status: positive
  labels: [user_email]
evidence: Source and taxonomy evidence supporting the correction.
rationale: Why the earlier annotation was wrong or became obsolete.
reviewed_by: human-identity
reviewed_at: YYYY-MM-DD
```

Keep correction history append-only or recoverable through version control. In the evaluation report, state which metric changes result from corpus corrections.

## Human-review worksheet

Present one decision at a time with:

- repository and pinned commit;
- file, lines, and surrounding source context;
- evaluated layer and subject identity;
- proposed status and labels;
- concise source-based rationale;
- choices to approve, correct, mark ambiguous, or request more context.

Hide current scanner output during initial review unless the reviewer explicitly requests it. This reduces anchoring and prevents the benchmark from mirroring current behavior.
