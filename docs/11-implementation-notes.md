# Implementation notes — 20 September 2026

- Current implementation status lives in `PROGRESS.md`, `SETUP-VERIFICATION.md` and each OpenAPI operation's `x-implemented` flag. The DOCX remains the approved design baseline.
- M1 adds four business operations: current profile read/sync, personal campus list, and own membership status. M2 reporting operations are documented below.
- Cognito subjects are opaque strings (1–128 key-safe characters), not necessarily RFC UUIDs. Profile/Person contracts now reflect the AWS guidance. Campus, post and other application-generated entity IDs remain UUIDs. Align remaining actor-reference input fields when their modules are implemented.
- Global profile changes use `GLOBAL#IDEMP#subject` and `GLOBAL#JOB#eventId` in Jobs, plus `U#subject / EVENT#date#id` in Core. These contain identity metadata only, never campus complaint content. Each sync writes profile, idempotency response, audit event and outbox atomically. The identity outbox consumer is not implemented yet.
- The backend verifies Cognito JWT signatures even behind API Gateway. No development impersonation header or production authentication bypass exists. Unit tests inject dependencies at construction; signed JWT fixtures use test keys.
- Cognito userInfo verifies email during profile synchronization. The frontend synchronizes the existing profile again after login; a changed email no longer matches the membership's approved hash and blocks active campus operations. A future email-change/account lifecycle hook must revoke membership immediately during an already-open session; external identity changes between synchronizations remain a pilot limitation.
- MFA enrollment is not inferred from userInfo or email verification. New profiles report `mfaEnrolled=false`; verified enrollment lookup and mandatory pool MFA are deployment work. Privileged grants are not implemented.
- Idempotency keys are 16–128 letters, digits, underscore or hyphen; the client uses UUIDs. Reuse the same key and payload after a recoverable failure. Results live for at least 24 hours; TTL deletion timing never decides whether a key is valid.
- Local cursor secrets are random per process when omitted; restarting expires outstanding local cursors. Production requires a stable injected secret. M2 content cursors also bind campus/authVersion/filters and consumed pointer positions.
- Docker Desktop did not become ready on this host. The official AWS downloadable archive currently identifies itself as DynamoDB Local 3.3.1; its published SHA-256 matched. `scripts/start-local-db.ps1` pins that verified archive checksum. It requires Java 17+; Java 23 is already installed here. The archive/runtime/data stay under ignored `.local/`.
- The local database is synthetic and in memory. Start it, run initialization and seeding, and run integration tests. Integration tests create unique test tables and remove only those exact tables. They never use a cloud endpoint.

Sources: [AWS access-token semantics and subject IDs](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html), [AWS DynamoDB Local setup and checksums](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.DownloadingAndRunning.html).

## M2 clarifications

- Text-only reporting is available; files fail closed until the quarantine/scan/clean gate exists. Draft publication, feed and detail are ISSUE-only subsets of the generic contract.
- Campus configuration is bounded to 100 active categories, units and groups of each kind. Admin editing is not yet implemented. Missing eligible unit leads block publication without losing a draft; automatic triage fallback remains pending.
- Working deadlines use Temporal with the campus timezone/open minutes/weekdays/holidays, including offset transitions. Store calculated UTC deadlines and calendar version on publication.
- Feed scans up to 200 candidates per request, returns at most 25 items, and may return an empty page with a continuation. Resume from consumed keys, not prefetched keys; adjacent equal sort keys are deduplicated across pages. Every returned issue passes fresh canonical authorization.
- Creation quotas count a private draft or direct issue once, with UTC fixed-hour/day atomic counters. Draft edits and publication do not consume another creation slot. Defaults are 5/hour and 30/day.
- Idempotency replays authorize the current source and return its current representation. Receipt snapshots are never returned after audience or permission changes.
- M2 history/outbox entries are atomic; consumers/notifications remain pending. Never present an outbox insert as a delivered notification.
- Synthetic browser testing injects the API client at the React context boundary and JWT verification dependencies at server construction. The standalone script, keys, identities and unique tables are never part of a deployment bundle. Production authentication has no impersonation mode.

## M3 core workflow clarifications

- Eight explicit commands are implemented: acknowledge/start/progress/wait/resume/propose-resolution/confirm/reopen. Remaining commands, service reviews, replies, support and workers remain pending. The generic command operation is marked partial.
- Only eligible current owners change work state; eligible assigned collaborators may add progress. Confirmation/reopening requires the original reporter and current source version. Confirmation also binds the current resolution ID.
- Resolution attempts are canonical RESOLUTION#id records under the post partition, with the current serialized attempt embedded on the source for atomic detail reads. Proposal, confirmation and invalidation update both in the same transaction with history/outbox. No automatic closure on silence.
- Reopening invalidates the attempt while retaining its former confirmation attribution. knowledgeValid stays false because publication to a knowledge index is not implemented. Future retrieval must check current source state/version and cannot treat a stale confirmed attempt as valid.
- Proposal updates the next action to reporter review and clears a work-update commitment; confirmed closure clears completed next-action text. Original service deadlines and prior events remain preserved.
- Queue requests select one authorized unit (or infer it when exactly one scoped unit exists), scan at most 200 index candidates and return at most 25 authorized canonical issues. Transfers are not supported yet. A UNIT tab does not grant access to otherwise-private group/restricted reports.
- History is currently ISSUE-only. Draft events remain author-private even after publication. Resolutions and history recheck source version/ACL and current membership after serialization. PUBLIC in an event DTO means the currently permitted source audience, never unauthenticated internet access.
- Evidence uploads remain unavailable; text-only proposals require an explicit evidence-omission explanation. Production evidence retention and scan gates are separate unfinished work.
- Native datetime inputs work with normal keyboard commitment. The automated browser helper may need a keypress after filling to trigger the framework change event.
