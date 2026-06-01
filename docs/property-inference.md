# Property Inference (YAML-driven)

This document describes how `cli/patterns/property.patterns.yaml` is used to infer **component properties** from `RawFinding`s.

It is implemented by `cli/src/analyzers/shared/property-inference.ts` and loaded/validated by `cli/src/config/property-detection-config.ts`.

Property inference/enrichment runs in both analyzers:

- TypeScript/JavaScript: `cli/src/analyzers/typescript/detector.ts`
- Python: `cli/src/analyzers/python/detector.ts`

## Where the rules live

The YAML lives at `cli/patterns/property.patterns.yaml` and contains:

- `regexes`: named regular expressions used by `when.regex` conditions
- `external_api_known_documentation_urls`: lookup table for `external_api_call` documentation URLs
- `external_api_known_package_names`: lookup table for `external_api_call` code reference packages
- `inference_rules`: the main ruleset, keyed by `patternId`
- `enhance`: separate defaults/metadata for classification enhancement (not covered here)

## How rules are selected

`getPropertiesFromFinding(finding, fileContent?)`:

1. Uses `finding.pattern` as the key into `inference_rules`
2. Iterates the associated rules **in order**
3. For each rule:
   - evaluates `when`
   - if it matches, applies all entries in `set`

There is no early stop: multiple rules can set properties on the same output object.

## Inference rule schema

### Shape

`inference_rules` is:

```yaml
inference_rules:
  <patternId>:
    - when: <WhenCondition>
      set: <SetAssignments>
```

`patternId` must be one of the engine’s valid `patternId` values (see `cli/src/core/types/detection.ts`).

### Available inputs for `when`

When evaluating conditions, the inference context is built from:

- `content`: passed as `fileContent` to `getPropertiesFromFinding` (or `""`)
- `key`: from `finding.properties.key`
- `library`: from `finding.properties.library`
- `strategy`: from `finding.properties.strategy`
- `strategyStr`: `${strategy} ${library} ${content}` (joined with spaces, ignoring empty parts)
- `serviceName`: from `finding.properties.serviceName`
- `documentationUrl`: from `finding.properties.documentationUrl`
- `apiVersion`: from `finding.properties.apiVersion`
- `url`: from `finding.properties.url`
- `httpMethods`: from `finding.properties.httpMethods`
- `path`: from `finding.properties.path`

These names match the `input:` fields you use in rule conditions (`exists`, `regex`, `equals`).

Note: `when.notSet` is different: it refers to an output property key (i.e. `out[outputProperty]`), not one of the inference context inputs.

### `when` conditions (validated)

Supported `when` shapes:

- `always: true`
- `notSet: <outputPropertyName>` (matches when `out[outputPropertyName]` is `undefined`, i.e. not set yet)
- `exists: <inputName>` (matches when the input value is “truthy”; empty string/empty array are treated as false)
- `regex`:
  - `input: <inputName>`
  - `regex: <regexName>` (must exist under the top-level `regexes:` section)
- `equals`:
  - `input: <inputName>`
  - `value: <any>` (comparison uses `String(actual) === String(expected)`)
- boolean combinators:
  - `anyOf: [ <when>, ... ]`
  - `allOf: [ <when>, ... ]`
  - `not: <when>`

## `set` assignments (validated)

### `set` assignment shape

`set` is an object whose keys are the output property names:

```yaml
set:
  some_property: <Assignment>
  other_property: <Assignment>
```

Output property keys are validated against the set of assignable properties (`DETECTABLE_PROPERTY_KEYS`).

An assignment can be:

1. A constant:
   - `string | number | boolean | null`
2. `fromInput`:
   - `fromInput: <inputName>`
3. `preferInputOrConstant`:
   - `preferInputOrConstant: { input: <inputName>, fallback: <constant> }`
   - If the input value is truthy, uses it; otherwise uses `fallback`
4. `lookup`:
   - `lookup: { map: <lookupName>, keyInput: <inputName>, transform?: lowercase, onMissing?: skip }`
   - `map` selects a lookup table loaded from YAML:
     - `external_api_known_documentation_urls`
     - `external_api_known_package_names`
   - If `transform: lowercase`, the lookup key is lowercased before matching.

## Examples

### `auth_middleware` MFA rule

Matches when `strategy` or `content` matches `regexes.mfa_strategy` and sets:

- `mfa_required: true`
- `authentication_method: mfa`

```yaml
inference_rules:
  auth_middleware:
    - when:
        anyOf:
          - regex: { input: strategy, regex: mfa_strategy }
          - regex: { input: content, regex: mfa_strategy }
      set:
        mfa_required: true
        authentication_method: mfa
```

### `env_variable` cloud provider

Matches first by `env_cloud_aws`, then `env_cloud_gcp`, then `env_cloud_azure` while `cloud_provider` is not set.

```yaml
inference_rules:
  env_variable:
    - when:
        allOf:
          - notSet: cloud_provider
          - regex: { input: key, regex: env_cloud_aws }
      set:
        cloud_provider: AWS
```

### `external_api_call` known package name

Uses the `external_api_known_package_names` lookup table keyed by `serviceName`.

```yaml
inference_rules:
  external_api_call:
    - when:
        exists: serviceName
      set:
        code_reference_package:
          lookup:
            map: external_api_known_package_names
            keyInput: serviceName
            transform: lowercase
            onMissing: skip
```

## Fail-fast validation

`loadPropertyDetectionConfig()` validates the structure of `inference_rules` using Zod.

When editing YAML, invalid shapes (unknown condition fields, wrong assignment shapes, or invalid `patternId` keys) will throw immediately during CLI startup/test runs.
