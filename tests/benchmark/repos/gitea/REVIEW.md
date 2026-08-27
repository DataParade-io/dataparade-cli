# Human review packet: Gitea account and access-token data

Status: proposed; not included in evaluation denominators.

## Source and complete scope

- Repository: `go-gitea/gitea`
- Commit: `0b1067484fcdc497dc34d9113c467182231e6ea9`
- License: MIT
- Files: `models/auth/access_token.go` (170 lines) and `modules/structs/user.go` (137 lines)
- Sources: https://github.com/go-gitea/gitea/blob/0b1067484fcdc497dc34d9113c467182231e6ea9/models/auth/access_token.go and https://github.com/go-gitea/gitea/blob/0b1067484fcdc497dc34d9113c467182231e6ea9/modules/structs/user.go

Review source only; do not consult scanner output. The line-level proposals are in
`annotations/data_items.yaml`.

## Recommended grouped decisions

1. Accept direct bearer-token values as `access_token`, and user account IDs,
   logins, external-authenticator IDs, full names, and email addresses as identity data.
2. Treat token hashes, salts, final-eight displays, scope, timestamps, and account
   flags as non-data-items for this taxonomy.
3. Keep avatar/profile URLs, location, website, description, and uploaded avatar
   image ambiguous until the taxonomy specifies how it treats links, free text, and
   image content.

## Acceptance record

For each decision, update `provenance` with reviewer, date, and rationale. Preserve
rejected records. Only accepted records enter the normal evaluator.
