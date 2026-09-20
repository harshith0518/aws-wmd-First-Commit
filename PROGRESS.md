# CampusFix progress

Last checkpoint: **20 September 2026, afternoon**. Implementation resumed under the user’s new instruction to push and finish the LLD for tonight’s deadline. The expired overnight heartbeat remains PAUSED; current work is directly authorized.

## Current result

- Working local vertical flow: private draft / direct report → eligible owner → staff queue → acknowledgement → work/progress/wait/resume → structured resolution proposal → reporter confirmation → reporter reopening with prior attempt retained and invalidated.
- Real API and DynamoDB Local persistence back the UI. Browser verification used separately signed synthetic student and owner identities. Real Cognito login has not been configured or accepted against AWS.
- `npm.cmd run check` PASS: 169-operation / 234-schema / 3-table contract checks; strict workspace TypeScript checks; 41 API + 3 browser-auth unit/security tests; Lambda and Vite builds.
- `npm.cmd run test:integration` PASS: three isolated real DynamoDB Local integration scenarios, including concurrent profile/publication/command retries, source version races, owner/reporter resolution lifecycle, queue removal/restoration, history and revocation. **47 automated tests total.**
- Frontend JS: 112.86 kB gzip. API Lambda ESM approximately 3.6 MB; evidence worker approximately 3.4 MB. No cloud resources were provisioned.
- OpenAPI marks **13 operations fully implemented and twelve partial**. Partial operations support ISSUE only, eight of the designed issue commands, and a queue for one authorized unit at a time; future types/actions are not claimed complete.

## Authorization, cutoff and repository

- User authorized implementation plus repeated build → test → fix loops until morning. Assumed cutoff was 08:00 IST on 20 September 2026.
- A later time check returned 12:14 IST, already after the cutoff. New feature work stopped at that check; a bounded browser/build/integration pass and its display fixes were then completed. Do not claim the run stopped precisely at 08:00 or ran continuously through the elapsed interval.
- Heartbeat `campusfix-overnight-implementation` was explicitly set to PAUSED after the cutoff. Do not restart it without a new user request.
- Coding workspace: `C:\Users\ASUS\Desktop\my_files\Competitions\AWS Hackathon CampusFix`.
- Original task cwd is sibling `aws - first commit`; only scratch generation scripts live there. Never copy its stale staging tree over this project.
- Branch `codex/campusfix-lld`, origin `harshith0518/aws-wmd-First-Commit`. Baseline design/implementation committed and pushed as df2c0ad. Evidence milestone committed and pushed as 3cb7801; working tree was clean after the push. Current uncommitted work is the replies/support vertical slice. GitHub connector refused draft PR creation with 403; Git push itself succeeded.
- Preserve all files and user remarks. Latest developer instruction forbids proactive subagents; implement locally unless explicitly requested.

## Implemented behavior

### M1 identity and authorization

- Cognito RS256 JWT checks enforce signature, issuer, app client, expiry, token purpose and API scope. Server-side userInfo verifies email on profile sync.
- Profile sync writes canonical profile, audit, outbox and 24-hour idempotency receipt atomically. Personal campus discovery rehydrates canonical memberships from lookup pointers.
- Fresh membership/campus/profile validation enforces campus, group, role expiry and restricted-case access. Ordinary campus administrators cannot bypass sensitive-case scope.
- PKCE/state/nonce and ID/access-token verification; memory-only browser tokens; profile, campus chooser and membership screens; root `.env` loading.
- Safe DTOs/errors, no-store responses, request IDs, 64 KB request limit, bounded queries and encrypted cursors. No production impersonation mode.

### M2 issue reporting

- Active campus directory for custom categories, official units and approved groups; 100 entries maximum per kind.
- Author-only drafts: create, list, read, versioned edit and discard. Publication validates active same-campus references, owner eligibility and explicit audience confirmation.
- Campus/group/restricted audiences; sensitive categories require restricted mode and an eligible designated sensitive handler. Missing eligible owner blocks publication while preserving a draft.
- UTC due times calculated from campus timezone, working minutes/weekdays/holidays; weekend and DST tests pass.
- Atomic campus commands include member/profile/campus/reference guards, canonical source, event, outbox and idempotency receipt. Fixed UTC counters enforce 5 creates/hour and 30/day; draft creation counts once, publication does not count again.
- Scoped feed merges campus/user/current-group streams, at most 200 fetched candidates and 25 results. Cursors preserve consumed positions and deduplicate overlapping scopes across pages. Canonical rechecks reject stale access projections.
- Frontend has private draft save/resume, audience preview, conflict comparison retaining unsaved text, filters, pagination and owner/deadline detail. Focus refresh preserves the open report form.

### M3 core accountability flow

- Commands implemented: acknowledge, start, progress, wait, resume, propose-resolution, confirm, reopen. Every command checks current permissions, source version, state and idempotency.
- Only the current eligible primary owner changes work state or proposes resolution; a currently eligible assigned collaborator can record progress. Only the original reporter confirms or reopens.
- Proposal requires symptom, completed action, observed outcome and an honest reason for absent evidence. No fake attachments. Confirmation binds the current resolution ID and source version.
- Each resolution attempt is retained as its own canonical record. Reopening atomically invalidates the current attempt, restores the open queue and retains prior confirmation/history. No automatic closure on reporter silence.
- Proposal changes the next action to reporter review; closure clears obsolete work commitments. Original service deadlines remain in the source history.
- Attributed history and resolution attempts require current source ACL. Private draft events are omitted for non-authors. Cursors bind actor/campus/post/authorization/ACL/page settings; source changes during serialization fail closed.
- Queue supports one authorized unit per request and MINE / UNIT / OVERDUE / AWAITING_CONFIRMATION. It uses a KEYS_ONLY index, rehydrates canonical posts and preserves post ACL even for unit staff. Closed sources are removed; reopened sources return.
- Real workflow UI includes owner forms, confirmation/reopening, current and prior resolution views, paginated history and staff queue. Conflict refresh retains entered text and requires fresh review.

## Browser verification

- M2: empty feed, hostel-scoped private draft, saved draft list/resume, publication with owner and working-day deadlines, one feed entry and mine/search URL filters.
- M3: synthetic student publishes; separate owner opens staff queue, acknowledges and starts work, proposes resolution; student confirms, then reopens; invalidated attempt and attributed prior confirmation remain visible.
- No browser warning/error log entries. Reporting and workflow pages measured 375 CSS px without horizontal overflow. Temporary viewport overrides reset and verification tab closed.
- Native datetime input was exercised with a keyboard commit after filling; the browser helper's fill alone did not update React state. Normal keyboard interaction succeeded.
- Browser found stale next-action text after proposal/closure and capitalization of resolution prose. Fixed both; added backend regression assertions and reran the full checks. The final CSS capitalization fix was build-verified, not separately visually re-rendered.
- `scripts/browser-test-server.ts` is a standalone rig on loopback 3002, with synthetic signed JWTs, construction-injected dependencies and React API client context. It is not included in production entries. `npm.cmd run test:browser` starts it.
- All nine temporary browser-test tables from this run were removed by exact generated IDs after stopping the server. Only the three standard `campusfix-local-*` tables remain. Terminating the Windows shell session can bypass graceful cleanup; always check and remove only exact generated test table names.

## Remaining work — do not claim complete

1. Real AWS evidence deployment/acceptance: private versioned buckets, GuardDuty/EventBridge, IAM/CORS/lifecycle/alarms and Linux Sharp packaging. Local evidence implementation is complete; production uploads default disabled.
2. Next implementation priority — finish M3: decline/duplicate/priority commands, due workers and independent service reviews with conflict-free reviewer selection. Review and appeal workflows are not implemented.
3. Outbox consumption, in-app/email delivery and delivery-status UI. Atomic outbox records exist, but no notifications are delivered.
4. Real campus onboarding, approved invitations/joins, directory administration, verified privileged MFA and trusted account/email-change revocation hook. Active open sessions currently detect external email changes at next profile sync.
5. Knowledge entries, source validation/invalidation integration and optional Bedrock AI. `knowledgeValid=false` prevents treating current attempts as a published knowledge source; no knowledge index exists yet.
6. AWS CDK/deployment, actual Cognito acceptance, S3 policy/scanning acceptance, IAM and cloud operational checks. Builder ID is not deployment credentials. No paid resources solely for tests.
7. Community questions, private activity teams, marketplace and other R2/R3 modules; feature flags remain false.
8. Pilot-level load/accessibility/backup/restore/retention/moderation checks and real billing measurements.

## Resume guidance

- Read AGENTS.md, this file, SETUP-VERIFICATION.md, relevant numbered chapters and prompts/03-accountability.md. The DOCX remains the approved design baseline; docs/11-implementation-notes.md records implementation clarifications.
- Continue one real vertical slice from the remaining list, with domain/authorization/real DynamoDB tests; do not overwrite completed M1–M3 work.
- Key modules: `apps/api/src/commands.ts`, `issues.ts`, `workflow.ts`, `policy.ts`; React `issues.tsx` and `workflow.tsx`; shared Zod contracts under `packages/contracts/src`.
- Idempotent command replays reauthorize the current resource and return its current representation, not the stored stale receipt snapshot.
- Java DynamoDB Local 3.3.1 works on localhost:8000; Docker did not start. Runtime/checksum pinned in scripts/start-local-db.ps1 and ignored under `.local/dynamodb`. Synthetic database is in memory.
- Use Node 24 / `npm.cmd`; PowerShell npm shim is broken. Initialize/seed after restarting the local DB. M2 seed was refreshed successfully.
- Development API/web were running in exec session 47181 on ports 3001/5173; check readiness before creating duplicates. Test browser server is stopped. Browser runtime can be reused if alive, but its temporary tab was closed.
- Actual project is outside original sandbox write root; authorized edits/builds used escalation. There is no unresolved approval rejection or dependency-install failure.

## Afternoon evidence milestone

- Implemented ISSUE/draft evidence reserve → direct upload → immutable receipt → trusted scan/structural validation → sanitized/original variants → scoped short download → tombstone/queued deletion. Maximum three files / 5 MiB each; source versions, idempotency, audit and quota guards apply.
- Added worker leases, exact-version scan records, stale/missing/failed scan rejection, bounded due queries/retries, hold-aware cleanup and discoverable FAILED jobs. Concurrent scan delivery/removal cannot resurrect files or delete another generation’s accepted derivatives.
- Added React upload/status/scope/download/removal controls. Draft publication includes only selected ready proof and requires explicit omission of unfinished files. Unsaved report text is preserved while file operations advance the source version.
- Resolution commands now accept clean reporter-visible evidence; current/history DTOs filter narrower or removed proof IDs. Original reads are logged and handler-scoped.
- Final evidence verification PASS: npm.cmd run check (169 operations, 234 schemas, 41 API + 3 frontend-auth tests, typechecks and builds) plus npm.cmd run test:integration (3 real DynamoDB Local tests). 47 tests total. Offline AWS policy test was corrected to the actual lowercase conditions field and passed.
- Browser upload/publication passed, corrected same-tab safe download produced a download event, and a narrow mobile layout had equal 360px document/scroll widths. Browser removal succeeded; final console warning/error list was empty. Viewport reset, tab closed, and rig stopped. Cleanup is limited to the nine exact tables created for suffixes d72e286d-4e62-433d-afa8-23457b1a11e4, 50e4b991-8621-4059-91c0-195a563de595 and 3ab491fc-2205-4182-9bcf-437a411c9a3b. No real data is present.
- No paid resources or deployment. Production file parent support remains ISSUE-only; other modules are not claimed complete. The quota is a logical-original admission counter, not a complete S3 bill cap. Lifecycle for replayed/orphan objects, cloud scan acceptance and deployment packaging remain explicit blockers for real evidence use.
- Evidence checkpoint pushed as 3cb7801 on codex/campusfix-lld. Replies/support follow below. Continue through remaining LLD modules without claiming the entire product complete.

## Afternoon discussion and support milestone

- Published ISSUE replies now support one child level, PUBLIC or assigned-handler-only STAFF scope, up to ten validated current-reader mentions, immutable role-at-posting labels and attributed edit history. Authors can remove their reply; the placeholder remains and removed text is available only to the author/current assigned handlers. Current permissions are checked for lists, empty pages, revisions and retries.
- The affected toggle writes one versioned per-member record and the source count atomically. Repeated equivalent toggles cannot double-count/decrement; changed state requires the current source version. Default hourly limits are 30 reply writes and 60 support writes per actor, with downward campus overrides.
- Real React composers, nested threads, mention choices, edit/remove reason forms, revision pagination and affected state are connected to these APIs. Version conflicts preserve unsent text. Mentions currently select from known conversation participants; full people search is pending.
- Verification PASS: npm.cmd run check (171 operations / 236 schemas, strict typechecks, 49 API + 3 auth tests, production builds) and npm.cmd run test:integration (4 real DynamoDB Local scenarios). Total 56 tests. Integration adds concurrent same-key replies/mentions, scope protection, revisions/removal and competing support writes.
- Evidence already pushed as 3cb7801; this discussion slice is the next checkpoint. No paid cloud resources. Reply attachments, official Question-answer metadata, votes and notification delivery remain pending; corresponding generic reply operations are marked partial.
- Next M3 slice: eligible collaborator assignment and two-party ownership transfer, with immediate removal of temporary grants on rejection/expiry. Then independent service reviews and deadline/notification workers.

- Discussion browser verification PASS: student posted and edited a reply; prior text/reason appeared in revisions; affected count changed to one; owner saved a separate private note and posted a one-level response. Switching to the student hid both the note and staff control. Browser warnings/errors: none. Tab/rig stopped; cleanup targeted only test tables for 121821be-a807-4378-8e82-a4cd86f710cd.

## Afternoon ownership milestone

- Discussion checkpoint pushed as 1bf2b0e. Its exact three browser-test tables were removed successfully after correcting the cleanup prefix; only standard local tables remained.
- Implemented collaborator assignment by the current authorized unit lead, with current same-unit handler checks, versioned ACL updates, source history/outbox, up to eight collaborators and individual feed pointers. Direct owner replacement is rejected.
- Implemented propose/accept/reject handovers. The old owner remains accountable until the proposed eligible owner accepts; the 48-hour temporary read grant expires in authorization independently of worker timing. Cross-unit acceptance moves the queue and clears collaborators; original timestamps/deadlines are preserved. Rejection that removes the caller's access returns only an AccessEnded acknowledgement, including on retry.
- Added a bounded four-shard transfer-expiry worker with atomic event/outbox/source/job writes, conflict retries and discoverable failures after five attempts. Its Lambda entry validates the exact configured EventBridge schedule/account/region. No AWS schedule is deployed yet; due reminders and notification delivery remain pending.
- Proposal of a resolution cancels a pending transfer. Temporary recipient access alone cannot authorize staff notes, evidence originals, status changes or collaborator assignment before acceptance.
- Full check target for this checkpoint: 172 operations / 239 schemas, 57 API + 3 auth + 5 real DynamoDB integration tests = 65 tests. Integration found an index-pointer GetItem key-shape error in expiry; corrected to pk/sk-only, then the real concurrency test passed. Final gate result is recorded below.
- Next priority: independent service-review intake and a conflict-free reviewer workflow, followed by remaining M3 commands/deadline workers and M4 reviewed knowledge. No real AWS, notifications or full-project completion is claimed.

- Final ownership gate PASS: npm.cmd run check and npm.cmd run test:integration; 65 tests, typechecks, contracts and all three Lambda/web builds. Browser verified proposal with old ownership retained, recipient discovery/acceptance, new owner controls and former owner losing the scoped feed item. No warning/error logs. The final temporary-lead assignment guard was regression-tested after that browser rig started; it was not re-rendered in a second browser run. Rig/tab stopped and exact ed949974-d026-4a62-82d6-43f2bd66fb31 test tables removed.
