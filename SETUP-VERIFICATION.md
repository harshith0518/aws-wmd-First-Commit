# Implementation verification

Verified **20 September 2026, AWS release preparation checkpoint**. Identity, issue reporting and the core owner/reporter resolution workflow and evidence pipeline are implemented locally. The entire CampusFix product is not complete. AWS infrastructure is implemented and synthesized; live account deployment/sign-in remains unverified.

## Passed

- `npm.cmd run check`: 173-operation / 241-schema / 3-table contract structure; strict API/web/contracts TypeScript checks; 82 backend and five frontend-auth/routing tests; six CDK security/navigation/dependency tests; Lambda and Vite production builds.
- `npm.cmd run test:integration`: nine real DynamoDB Local scenarios with isolated tables. **102 automated tests pass in total** across domain, web, infrastructure and database suites. The added seed scenario was rerun separately after fixing its retry sequence.
- Actual database tests cover profile/publication/command concurrent idempotency, version races, group/campus isolation, current revocation, staff queue, proposal/confirmation/reopening and preserved resolution attempts/history.
- Domain/security tests also cover wrong signatures/issuer/client/token purpose/scope, identity mismatch, unknown/spoofed inputs, private drafts, restricted cases, ownerless publication, expired roles, unavailable evidence, atomic quotas, bounded feed pagination and working calendars including DST.
- Workflow tests reject unauthorized or invalid transitions, stale versions, wrong resolution IDs, role revocation during commit and absent evidence explanations. Staff cannot confirm for the reporter. Closing removes the queue record; reopening restores it and invalidates the attempt.
- Synthetic browser journeys use actual React components, HTTP APIs, signed JWT verification and disposable DynamoDB Local tables: report/draft/feed, staff queue, acknowledgement/start/proposal, reporter confirmation/reopening and visible attributed history.
- No browser warning/error entries and no horizontal overflow at the observed 375 CSS px. Viewport reset. Temporary test server/tab stopped and its nine test tables removed; standard seed tables preserved.
- Browser-discovered stale next-action text and resolution capitalization were fixed. Full checks reran after both fixes; capitalization CSS was not separately visually re-rendered.

## Limits

- Cognito pool/app client are defined in CDK; actual live login and verified MFA remain unverified against AWS. The synthetic browser rig is not real Cognito acceptance or a production login mode.
- 23 operations fully implemented; twenty-three additional operations explicitly partial. Generic post endpoints currently support ISSUE only. Commands support all fourteen specified actions; queue supports one authorized unit per request. The remainder is designed only.
- Real AWS scanning acceptance, review evidence/reassignment/appeals, outbox consumers/notifications, optional AI, campus administration and AWS deployment remain pending.
- Knowledge uses scoped discovery pointers and synchronous canonical source/resolution checks. Reopening invalidates reads/retrieval immediately. Expired/source-stale pointer sweeping remains operational work; stale/retire commands remove their pointers atomically.
- External identity changes between profile syncs require a trusted revocation hook before real-campus deployment.
- No paid AWS resources, live messages, public deployment, load test, restore drill or real-campus pilot. Local emulation does not validate IAM, cloud latency or billing.
- Baseline committed and pushed as df2c0ad on codex/campusfix-lld. The verified evidence milestone is pushed as 3cb7801.

## Environment and repeat

- Node 24.11.1, npm 11.7.0 (`npm.cmd`), TypeScript 5.9.3; exact dependency versions in package-lock.json.
- Java DynamoDB Local 3.3.1 with verified download checksum; Docker unavailable. Database is synthetic and in memory on localhost:8000.
- Frontend JS approximately 125.39 kB gzip; API Lambda approximately 3.6 MB and evidence worker 3.4 MB before compression.
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
- Real AWS S3/GuardDuty/IAM/CORS and signed-URL expiration enforcement are untested. Offline signing verifies exact policy fields and 60-second versioned URLs. Quota counters cover logical originals, not all billed object versions/derivatives. Full retention and orphan lifecycle remain deployment work. Linux x64 Sharp packaging is now checked offline; native execution is additionally checked by the CloudShell package script.

## Discussion checkpoint

- Eight added domain/HTTP/security cases and one real DynamoDB integration scenario pass. Tested one-level nesting, current scoped mentions, private notes/history, removed-text revision restrictions, quota/idempotency, source-version races and author revocation at commit.
- Support races accept one conflicting source-version write and preserve one record per member; removing support removes its My Activity index keys. Replayed commands reauthorize after membership revocation.
- UI includes public/STAFF composers, nested reply lists, edit/removal reasons, retained revisions and a real affected-status toggle. Question metadata, REPLY evidence and actual mention notifications remain unimplemented.

- Discussion browser verification PASS: student posted and edited a reply; prior text/reason appeared in revisions; affected count changed to one; owner saved a separate private note and posted a one-level response. Switching to the student hid both the note and staff control. Browser warnings/errors: none. Tab/rig stopped; cleanup targeted only test tables for 121821be-a807-4378-8e82-a4cd86f710cd.

## Ownership checkpoint

- Eight domain/security cases cover authorized assignment, owner acceptance, rejection and replay after loss of access, expiry, sensitive grants, revocation at commit, resolution cancellation and a temporary same-unit lead's denied assignment attempt.
- One added real DynamoDB scenario checks collaborator access, concurrent accept/reject (one winner), stale expiry no-op and duplicate expiry delivery. Initial expiry lookup failed with an invalid key; fixed to use only pk/sk. Full verification result follows below.
- Workflow worker bundle is approximately 2.1 MB before compression. WORKFLOW_SCHEDULE_ARN must be configured by infrastructure before trusted scheduled execution; no paid resources were provisioned.

- Final ownership gate PASS: npm.cmd run check and npm.cmd run test:integration; 65 tests, typechecks, contracts and all three Lambda/web builds. Browser verified proposal with old ownership retained, recipient discovery/acceptance, new owner controls and former owner losing the scoped feed item. No warning/error logs. The final temporary-lead assignment guard was regression-tested after that browser rig started; it was not re-rendered in a second browser run. Rig/tab stopped and exact ed949974-d026-4a62-82d6-43f2bd66fb31 test tables removed.

## Private service-review checkpoint

- Nine domain/security tests and one DynamoDB Local integration scenario added. Tested independent fallback/exclusions, private partitions/lists, no implicit source access, unique active intake/idempotency, reviewer-only notes, revocation, reasoned decisions/appeal-window validation, corrective-action verification, historical involvement and concurrent competing decisions.
- Full contract/typecheck/test/build and integration gate passes: 75 automated tests. No real AWS, email or corrective-task delivery is claimed. Review files/reassignment/escalation/appeals remain partial.

- Browser PASS: student intake → original owner denied discovery → independent reviewer begins, adds private note and records reasoned decision → student sees decision with reviewer-only note/history filtered. No browser warnings/errors. Test server stopped and exact synthetic tables cleaned.

## Complete issue command surface

- PASS: full npm.cmd run check plus seven disposable DynamoDB integration scenarios; added explicit inaccessible/cross-campus duplicate regression after the full gate, and reran its complete seven-test triage file and contract validation. 82 backend + 3 frontend-auth + 7 integration = 83 passing tests.
- Browser PASS: owner priority change persisted as High with unchanged deadlines; student published another report; lead used scoped search to link it as a duplicate, followed the related report button, then declined the original with a reason/review route. Attributed history was visible; no browser warning/error logs. Terminal states showed a misleading next-action hint, which was removed and web typecheck/build verified after the journey.
- Duplicate target references never enter public history; source readers only receive the target ID after current target authorization. Canonical target path is bounded at twenty hops and guarded transactionally, preventing reciprocal cycles. Original submission age and service clocks are retained. Review-driven restoration of a declined issue remains pending with the full review corrective-action workflow.
- Per user instruction, keep AWS credits/deployment aside; continue completing real local behavior. No paid resources have been provisioned.

## Reviewed resolution library

- PASS: npm.cmd run check and npm.cmd run test:integration: 82 backend tests, 3 frontend-auth tests and 8 real DynamoDB scenarios (93 total), strict types, 173-operation / 241-schema contracts and all production bundles. Web typecheck/build repeated after the final source-card navigation adjustment.
- Added 30 labelled synthetic retrieval cases, stored in specs/knowledge-evaluation.json: 30/30 expected top results or correct empty outcomes, including expired/reopened/other-hostel/other-campus records. This is a deterministic search baseline, not an AI generation or routing-quality result.
- Current-source permissions, source-version changes, canonical confirmed resolution, reviewer role, stale flags, deadlines, retirement, cursor binding, a 100-row discovery ceiling, concurrent creation and atomic pointer deletion/restoration are verified. One card per source resolution. No raw file copies or permanent evidence links in cards.
- Browser PASS: owner curated a confirmed source, student discovered it in the library and flagged it stale with a reason, search withdrew the card, owner opened it from the source and rereviewed it, and the card returned to search with the new review date/attribution. No browser warnings/errors. The exact 231de68a-8471-43d0-af2a-2b3dd58c4454 synthetic tables were cleaned after stopping the rig.

## AWS release package

- PASS: full `npm.cmd run check`, including 82 API + 5 web + 6 infrastructure tests, contract structure, API/web/contracts/infra types, three Lambda bundles and Vite output. CDK tests verify authenticated business routes, exact CORS/callback derivation, no signup, private OAC origin, planned indexes/TTL, retained storage, disabled uploads/AI, scoped IAM without Scan and absence of resource cycles.
- PASS: existing eight DynamoDB integration scenarios plus the added real-cloud seed workflow/isolation scenario. First integration attempt failed because the prior in-memory DB process was stopped; restarted existing Java DynamoDB Local. Seed replay then exposed changing expectedVersion values; fixed deterministic initial-workflow requests and verified replay/group/campus/private-review behavior.
- PASS: `npm.cmd run aws:package` builds a Linux x64 artifact with Sharp/libvips; ELF header and required files checked. Native Lambda startup cannot be executed on this Windows host; the same packaging command imports the Lambda on Linux before any CloudShell deployment. Runtime dependencies have their own committed lockfile.
- PASS: `npm.cmd run aws:synth` with placeholder account 111111111111 and region ap-south-1; generated real CloudFormation/assets from the packaged Lambda. Synthesis is not deployment. No paid AWS resources were provisioned.
- Fixed production navigation retaining issue query parameters for library/review creation. Added validated HTTPS API base configuration so CloudFront/Cognito/API dependencies have no cycle. These changes passed automated tests; the live OAuth browser journey still requires account deployment.
- Added `AWS-DEPLOY.md`, `SUBMISSION.md`, deploy/publish/smoke/demo seed commands. Six genuine Cognito demo users are created only when the operator runs `aws:seed`; passwords stay in ignored mode-0600 artifacts, not Git or CLI arguments.
- Local AWS default credentials failed STS with InvalidClientTokenId. User can access the AWS Console, so instructions use its preauthenticated CloudShell. Live IAM, Cognito callback/login, CloudFront, CORS, quota/cost and signed-in end-to-end acceptance are pending. Automated public cloud smoke is provided but has not been run against a real account.
- Release intentionally excludes cloud uploads, Bedrock, notifications, community/admin modules, full review appeals/evidence and real-campus pilot readiness. The revised user instruction authorizes AWS deployment preparation; prior notes deferring deployment are historical.
