# Four-layer scanner evaluation

Local initiative: `KDATAP-0dbc61`. The only Jira issue on this board should be `DATAP-602`.

## Terms

- Keep: component, data flow, data item
- A line is a mention, evidence, or span. Not a "data item reference."
- Today's `data_items` eval (T0/T1) is mention-level.

## Four grades

1. Raw pattern hits (YAML rulebook fired)
2. Components and data flows (the map)
3. Data items (the unique personal-data thing)
4. Mentions / spans (the line)

Plexus runs those grades. It is not a fifth kind of finding.

## Epics

- `KDATAP-602d2b` ontology
- `KDATAP-7dc229` raw pattern hits
- `KDATAP-4e1cdb` component and data-flow Plexus grades
- `KDATAP-96092c` split mention eval from data-item eval
