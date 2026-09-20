# CampusFix progress

Last verified checkpoint: **20 September 2026, 12:24 IST**. Overnight implementation is stopped and its heartbeat is **PAUSED**.

## Current result

- Working local vertical flow: private draft / direct report → eligible owner → staff queue → acknowledgement → work/progress/wait/resume → structured resolution proposal → reporter confirmation → reporter reopening with prior attempt retained and invalidated.
- Real API and DynamoDB Local persistence back the UI. Browser verification used separately signed synthetic student and owner identities. Real Cognito login has not been configured or accepted against AWS.
- `npm.cmd run check` PASS: 168-operation / 233-schema / 3-table contract checks; strict workspace TypeScript checks; 31 API + 3 browser-auth unit/security tests; Lambda and Vite builds.
- `npm.cmd run test:integration` PASS: two isolated real DynamoDB Local integration scenarios, including concurrent profile/publication/command retries, source version races, owner/reporter resolution lifecycle, queue removal/restoration, history and revocation. **36 automated tests total.**
- Frontend JS: 110.04 kB gzip. Lambda ESM bundle: approximately 2.1 MB. No cloud resources were provisioned.
- OpenAPI marks **13 operations fully implemented and six partial**. Partial operations support ISSUE only, eight of the designed issue commands, and a queue for one authorized unit at a time; future types/actions are not claimed complete.

## Authorization, cutoff and repository

- User authorized implementation plus repeated build → test → fix loops until morning. Assumed cutoff was 08:00 IST on 20 September 2026.
- A later time check returned 12:14 IST, already after the cutoff. New feature work stopped at that check; a bounded browser/build/integration pass and its display fixes were then completed. Do not claim the run stopped precisely at 08:00 or ran continuously through the elapsed interval.
- Heartbeat `campusfix-overnight-implementation` was explicitly set to PAUSED after the cutoff. Do not restart it without a new user request.
- Coding workspace: `C:\Users\ASUS\Desktop\my_files\Competitions\AWS Hackathon CampusFix`.
- Original task cwd is sibling `aws - first commit`; only scratch generation scripts live there. Never copy its stale staging tree over this project.
- Branch `codex/campusfix-lld`, origin `harshith0518/aws-wmd-First-Commit`. Design and implementation edits remain local and uncommitted. No new remote push has been made.
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

1. Secure evidence reservation/upload/quarantine/scanning/download/revocation. Attachment IDs currently fail closed with UPLOADS_UNAVAILABLE.
2. Finish M3: replies, support, assignment/collaborators, transfer acceptance/expiry, decline/duplicate/priority commands, due workers and independent service reviews with conflict-free reviewer selection. Review and appeal workflows are not implemented.
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
