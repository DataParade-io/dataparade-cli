# Human review packet: YJDH employee serializer

Status: proposed; not included in evaluation denominators.

- Repository: `City-of-Helsinki/yjdh`
- Commit: `b148e187b43dbaab7e6b9c6c4a394fe9e9ab7ee8`
- License: MIT
- Complete scope: `backend/benefit/applications/api/v1/serializers/employee.py` (93 lines)

The source defines an employee API payload and directly validates a Finnish social
security number through `stdnum.fi.hetu`. Recommended positives are the national
identifier, name, email, birth date, job title, and compensation/expense values.
Keep collective agreement and commission description ambiguous as unstructured
employment text. Review only pinned source, then update the individual proposed
records in `annotations/data_items.yaml`.
