# Human review packet: Keycloak user and credential entities

Status: proposed; not included in evaluation denominators.

- Repository: `keycloak/keycloak`
- Commit: `b9b70f95f7e092ebadf898378948bab0971e015b`
- License: Apache-2.0
- Complete scope: `UserEntity.java` (304 lines) and `CredentialEntity.java` (166 lines)

Recommended positives: user ID, username, first/last name, email, direct credential
secret and credential data. Recommended negatives: timestamps, realm/service links,
flags, credential type, priority, and salt. `userLabel` is deliberately ambiguous:
it is user-entered credential metadata without defined contents. Review only the
pinned source; update `annotations/data_items.yaml` to accept, reject, or refine.
