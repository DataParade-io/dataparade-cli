Feature: Executable Gherkin for Plexus-backed evaluation

  Scenario: Feature files are the eval specs
    Given Gherkin files for local Plexus evaluation
    When the feature runner loads those files
    Then the discovered files include plexus-eval.feature

  Scenario: Jest remains separate from Gherkin specs
    Given the Jest configuration for this repository
    When I inspect its test file patterns
    Then it matches only tests under tests/**/*.spec.ts and tests/eval/**/*.test.ts
