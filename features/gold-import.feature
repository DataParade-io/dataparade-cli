Feature: Gold annotations as Plexus Items

  Scenario: One annotation becomes one Item
    Given a canonical gold annotation in git YAML
    And a local Plexus GraphQL server
    When I import that annotation
    Then a Plexus Item exists with ground truth Yes
    And the Item identifies the same repository, commit, file, and line span
    And only the proposed positive annotation is imported as an Item

  Scenario: Git YAML remains canonical
    Given an annotation that changes in git YAML
    When I import again
    Then the Plexus Item matches the git annotation
    And git YAML is still the source of truth
