# Human review packet: PostHog analytics user model

Status: proposed; not included in evaluation denominators.

- Repository: `PostHog/posthog`
- Commit: `a2f78ff63a1c7e1db33c623be83488a651bf4251`
- License: MIT for this non-`ee/` path under the pinned root license
- Complete scope: `posthog/models/user.py` (706 lines)

Recommended positives are email, pending email, pseudonymous distinct ID, and the
temporary token. Keep organization/team relations, reset timestamps, JSON settings,
roles, and account flags negative or ambiguous as recorded. Review the pinned source
without scanner output, then adjudicate individual records.
