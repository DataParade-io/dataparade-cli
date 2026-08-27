# Human review packet: Ory Kratos password credential

Status: proposed; not included in evaluation denominators.

- Repository: `ory/kratos`
- Commit: `b86338da04a040247a07f46100a86dcfb3875909`
- License: Apache-2.0
- Complete scope: `identity/credentials_password.go` (21 lines)

The sole payload is explicitly documented as a hash representation of a password.
The boolean only controls migration-hook behavior. The proposed taxonomy treats a
password verifier as credential data but not a bearer password; review that policy
before accepting the two records.
