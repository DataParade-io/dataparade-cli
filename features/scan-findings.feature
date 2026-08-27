Feature: Scanner findings for a detector Score

  Scenario: A materialized tree yields file and line findings
    Given a tiny source tree on disk
    When I request scanner findings for that tree
    Then the results include a finding with a file path and line span
