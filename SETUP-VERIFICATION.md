# Implementation verification

Verified **20 September 2026, 12:24 IST**. Identity, issue reporting and the core owner/reporter resolution workflow are implemented locally. The entire CampusFix product is not complete or deployed.

## Passed

- `npm.cmd run check`: 168-operation / 233-schema / 3-table contract structure; strict API/web/contracts TypeScript checks; 31 backend and three frontend-auth tests; Lambda and Vite production builds.
- `npm.cmd run test:integration`: two real DynamoDB Local scenarios with isolated tables. **36 automated tests pass in total.**
- Actual database tests cover profile/publication/command concurrent idempotency, version races, group/campus isolation, current revocation, staff queue, proposal/confirmation/reopening and preserved resolution attempts/history.
- Domain/security tests also cover wrong signatures/issuer/client/token purpose/scope, identity mismatch, unknown/spoofed inputs, private drafts, restricted cases, ownerless publication, expired roles, unavailable evidence, atomic quotas, bounded feed pagination and working calendars including DST.
- Workflow tests reject unauthorized or invalid transitions, stale versions, wrong resolution IDs, role revocation during commit and absent evidence explanations. Staff cannot confirm for the reporter. Closing removes the queue record; reopening restores it and invalidates the attempt.
- Synthetic browser journeys use actual React components, HTTP APIs, signed JWT verification and disposable DynamoDB Local tables: report/draft/feed, staff queue, acknowledgement/start/proposal, reporter confirmation/reopening and visible attributed history.
- No browser warning/error entries and no horizontal overflow at the observed 375 CSS px. Viewport reset. Temporary test server/tab stopped and its nine test tables removed; standard seed tables preserved.
- Browser-discovered stale next-action text and resolution capitalization were fixed. Full checks reran after both fixes; capitalization CSS was not separately visually re-rendered.

## Limits

- Cognito pool/app client, real registration/login and verified MFA remain unconfigured/unverified against AWS. The synthetic browser rig is not real Cognito acceptance or a production login mode.
- 13 operations fully implemented; six additional operations explicitly partial. Generic post endpoints currently support ISSUE only. Commands support eight actions; queue supports one authorized unit per request. The remainder is designed only.
- Evidence/scanning, replies/support/transfers, independent reviews/appeals, outbox consumers/notifications, knowledge/AI, campus administration and AWS deployment remain pending.
- Current resolutions preserve history and source validity, but no knowledge index or background invalidation consumer exists yet.
- External identity changes between profile syncs require a trusted revocation hook before real-campus deployment.
- No paid AWS resources, live messages, public deployment, load test, restore drill or real-campus pilot. Local emulation does not validate IAM, cloud latency or billing.
- Working changes are local and uncommitted; no new remote push.

## Environment and repeat

- Node 24.11.1, npm 11.7.0 (`npm.cmd`), TypeScript 5.9.3; exact dependency versions in package-lock.json.
- Java DynamoDB Local 3.3.1 with verified download checksum; Docker unavailable. Database is synthetic and in memory on localhost:8000.
- Frontend JS approximately 110.04 kB gzip; Lambda approximately 2.1 MB before compression.
- Both servers read root `.env`; only public VITE_ settings enter the browser. `.env`, `.local`, node_modules and build output are ignored.

1. `npm.cmd ci`
2. Start Docker Compose or run `powershell -ExecutionPolicy Bypass -File scripts/start-local-db.ps1` in a separate terminal (Java 17+).
3. Run `scripts/init-local-db.ps1` and `scripts/seed-local-db.ps1`.
4. `npm.cmd run check`
5. `npm.cmd run test:integration`
6. `npm.cmd run dev` for production-auth application, or `npm.cmd run test:browser` for the separate synthetic test rig at http://127.0.0.1:3002.

See PROGRESS.md for the handoff and outstanding work. The overnight automation is paused after its cutoff.
