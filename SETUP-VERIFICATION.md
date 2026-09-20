# Implementation verification

Verified **20 September 2026, afternoon implementation checkpoint**. Identity, issue reporting and the core owner/reporter resolution workflow and evidence pipeline are implemented locally. The entire CampusFix product is not complete or deployed.

## Passed

- `npm.cmd run check`: 169-operation / 234-schema / 3-table contract structure; strict API/web/contracts TypeScript checks; 41 backend and three frontend-auth tests; Lambda and Vite production builds.
- `npm.cmd run test:integration`: three real DynamoDB Local scenarios with isolated tables. **47 automated tests pass in total.**
- Actual database tests cover profile/publication/command concurrent idempotency, version races, group/campus isolation, current revocation, staff queue, proposal/confirmation/reopening and preserved resolution attempts/history.
- Domain/security tests also cover wrong signatures/issuer/client/token purpose/scope, identity mismatch, unknown/spoofed inputs, private drafts, restricted cases, ownerless publication, expired roles, unavailable evidence, atomic quotas, bounded feed pagination and working calendars including DST.
- Workflow tests reject unauthorized or invalid transitions, stale versions, wrong resolution IDs, role revocation during commit and absent evidence explanations. Staff cannot confirm for the reporter. Closing removes the queue record; reopening restores it and invalidates the attempt.
- Synthetic browser journeys use actual React components, HTTP APIs, signed JWT verification and disposable DynamoDB Local tables: report/draft/feed, staff queue, acknowledgement/start/proposal, reporter confirmation/reopening and visible attributed history.
- No browser warning/error entries and no horizontal overflow at the observed 375 CSS px. Viewport reset. Temporary test server/tab stopped and its nine test tables removed; standard seed tables preserved.
- Browser-discovered stale next-action text and resolution capitalization were fixed. Full checks reran after both fixes; capitalization CSS was not separately visually re-rendered.

## Limits

- Cognito pool/app client, real registration/login and verified MFA remain unconfigured/unverified against AWS. The synthetic browser rig is not real Cognito acceptance or a production login mode.
- 13 operations fully implemented; twelve additional operations explicitly partial. Generic post endpoints currently support ISSUE only. Commands support eight actions; queue supports one authorized unit per request. The remainder is designed only.
- Real AWS scanning acceptance, replies/support/transfers, independent reviews/appeals, outbox consumers/notifications, knowledge/AI, campus administration and AWS deployment remain pending.
- Current resolutions preserve history and source validity, but no knowledge index or background invalidation consumer exists yet.
- External identity changes between profile syncs require a trusted revocation hook before real-campus deployment.
- No paid AWS resources, live messages, public deployment, load test, restore drill or real-campus pilot. Local emulation does not validate IAM, cloud latency or billing.
- Baseline committed and pushed as df2c0ad on codex/campusfix-lld. The verified evidence milestone is included in the next commit/push.

## Environment and repeat

- Node 24.11.1, npm 11.7.0 (`npm.cmd`), TypeScript 5.9.3; exact dependency versions in package-lock.json.
- Java DynamoDB Local 3.3.1 with verified download checksum; Docker unavailable. Database is synthetic and in memory on localhost:8000.
- Frontend JS approximately 112.86 kB gzip; API Lambda approximately 3.6 MB and evidence worker 3.4 MB before compression.
- Both servers read root `.env`; only public VITE_ settings enter the browser. `.env`, `.local`, node_modules and build output are ignored.

1. `npm.cmd ci`
2. Start Docker Compose or run `powershell -ExecutionPolicy Bypass -File scripts/start-local-db.ps1` in a separate terminal (Java 17+).
3. Run `scripts/init-local-db.ps1` and `scripts/seed-local-db.ps1`.
4. `npm.cmd run check`
5. `npm.cmd run test:integration`
6. `npm.cmd run dev` for production-auth application, or `npm.cmd run test:browser` for the separate synthetic test rig at http://127.0.0.1:3002.

See PROGRESS.md for the handoff and outstanding work. The overnight automation is paused after its cutoff.

## Evidence checkpoint

- Ten added domain/security/operational scenarios: immutable versions, malicious/unsupported/missing/timed-out scans, metadata removal and nested active-PDF rejection; scoped reads including empty lists; revocation during processing; concurrent processing/removal; quota/slot limits; omission at publication; holds; exhausted jobs; actual AWS presigning without network calls.
- Added real DynamoDB Local transaction test for concurrent reserve/complete/scan, a resolution citing clean evidence, scoped history/reads and physical deletion/quota release through the ready GSI.
- Browser verified a private draft, actual file input upload of the generated harmless fixture, checking-to-ready state and report publication. Initial new-tab download was not observed; changed to a same-tab attachment download and observed the browser download event. Evidence removal and mobile layout were checked separately. A test token expired and the API correctly denied further upload; the isolated rig was restarted.
- Configured mobile width was 375; observed document width and scrollWidth were both 360 CSS px. Full-page screenshot showed stitching repetitions; DOM inspection confirmed one evidence region and one history region. No horizontal overflow in the observed layout. Viewport reset after verification.
- Real AWS S3/GuardDuty/IAM/CORS and signed-URL expiration enforcement are untested. Offline signing verifies exact policy fields and 60-second versioned URLs. Quota counters cover logical originals, not all billed object versions/derivatives. Full retention, orphan lifecycle and Linux Sharp packaging remain deployment work.
