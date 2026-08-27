Feature: Local GraphQL is a process

  Scenario: Start without a database server
    Given Plexus and Virtuus installed in the Python environment
    And a data directory on the workspace disk
    When I start the local GraphQL process
    Then GraphQL answers on the local URL
    And no Postgres, Docker, or container runtime is required

  Scenario: Data survives restart
    Given Items stored through that GraphQL process
    When I stop and start the process
    Then those Items are still readable
    And they exist as files under the data directory
