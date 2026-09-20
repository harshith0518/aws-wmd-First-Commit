# 9 Implementation plan and acceptance

## 9A Start from the provided workspace

- Read README.md, docs/00-remarks-and-decisions.md and this LLD before coding. The editable chapter files and machine contracts accompany the DOCX so Codex CLI does not need to parse Word for each task.
- Start with Node 24 and npm.cmd on this Windows host. Run npm.cmd ci, then npm.cmd run check, then npm.cmd run dev. The current frontend shows the starter status and calls the health endpoint; it does not present fake working campus features.
- Frontend runs on localhost:5173; API runs on 127.0.0.1:3001. The Vite /api proxy is configured. Current health needs no AWS credentials. The starter does not automatically load root .env files; environment loading and validation is part of milestone M1.
- Docker Desktop must be running before docker compose up -d. The compose file pins DynamoDB Local. Run scripts/init-local-db.ps1, then scripts/seed-local-db.ps1 to create only local tables and synthetic records. These scripts refuse a remote database endpoint.
- The seed contains fake identity IDs for repository tests, not working Cognito logins. Identity implementation creates separate real dev-pool test users and maps their subs; never introduce a production request header that impersonates seed users.
- Use prompts/01-foundation.md onward as successive Codex CLI tasks from the new folder. Ask for one milestone, its tests and a reviewable diff at a time. Do not ask three isolated agents to invent frontend, backend and DB contracts independently.

## 9B Milestone sequence

- M0 complete in this package: architecture, page map, data keys, OpenAPI design, starter frontend/API/shared contract, lockfile, local table definitions, seed data, coding prompts and verification record. Business features and AWS infrastructure remain to implement.
- M1 identity and data foundation: add shared domain schemas, DynamoDB repositories, env validation, Cognito integration, campus membership policy and local integration tests. Implement public shell, callback, campus chooser and pending membership screen. Done when current member, former member and other-campus tests pass.
- M2 report and evidence: implement directory/custom categories, draft/issue creation, scoped feed/detail, upload reservations and safe file display. Done when a hostel user can report to IT and another hostel cannot read any record or attachment.
- M3 accountable work: implement owner queue, replies, progress, deadlines, transfers, confirmation, reopening, support, timeline and minimal independent service review. Done when the complete student -> staff -> student loop works with version conflicts and retries tested.
- M4 knowledge and AI: implement reviewed resolution cards, bounded source search, optional Bedrock generation, citations, quotas and invalidation. Done when AI failure leaves the ordinary report flow intact and unauthorized/reopened sources never enter a prompt.
- M5 deployment and hackathon demonstration: implement CDK, protected AWS endpoints, synthetic dev seed, logs/alarms, smoke tests and reproducible deployment. Create a demo under three minutes showing the problem, two roles, visibility, resolution and source-linked history. Recheck the current event rules before final submission.
- M6 real-campus pilot: complete verified onboarding, Questions/notices, moderation/service-review queues and independent appeals, scan pipeline, SES, exports, retention and recovery drill. Obtain named college owners and approved policies before real data.
- M7 community: build Activities with private event teams, then Marketplace/lost-and-found and private inquiries. Done only after concurrent joins, coordinator limits, participant removal, blocking and private evidence tests pass.
- M8 expansion: add second real college only after isolation/observability/cost review, then improve search from measured shortcomings. Keep the original contracts versioned; do not rewrite the whole stack to add a campus.

## 9C Work that can proceed in parallel

- After M1 contracts pass review: frontend can implement specified screens using contract-valid synthetic fixtures, backend can implement services, and data work can implement named access patterns. Shared schema changes must be coordinated and updated once.
- Ownership: frontend work owns apps/web; backend owns apps/api/modules; data owns apps/api/repositories and local DB scripts; one integrator owns packages/contracts, specs and infra. Agents must preserve others' changes and not overwrite shared contracts independently.
- Merge a vertical slice before building all screens. A mocked UI is useful for layout, but is never counted as a completed backend feature. Each slice needs an actual API, authorization, data write/read, error state and acceptance proof.

## 9D Test matrix

- Identity: wrong issuer/client, expired token, ID token, missing API scope, unverified email, invitation replay, wrong invited email, stale membership, last-admin removal and role expiry all fail appropriately.
- Read isolation: a second campus, another hostel, a revoked member and an unassigned administrator cannot read restricted titles, bodies, file links, notifications, metrics, exports or AI sources. Verify direct IDs as well as feeds.
- Mutation isolation: students cannot set actorId, owner, role, closure or clean-file state through body fields. Collaborators cannot transfer ownership. An original responder cannot review their own service complaint.
- Workflows: illegal transitions return 422; competing expectedVersion commands produce one success and a 409; idempotent retries produce one post/event; failed notification does not lose the issue; silence never confirms closure.
- Transactions: two simultaneous support requests count once; two requests for the last activity seat accept at most one; organizer seat is included; leaving restores capacity exactly once; a blocked buyer cannot create a replacement conversation.
- Files: oversized, mismatched mime, malicious, stale object-version, replayed upload, scan timeout and expired URL cases. No rejected/quarantined file is readable. Parent-specific review/team ACLs survive generic file listing and exports.
- AI: hostile source instruction, no precedent, invalid citation, changed permission during inference, reopened source, quota exhaustion and model timeout. All must preserve ordinary reporting and correct source access.
- Operations: duplicate SQS delivery, expired lease, DLQ retry, stale schedule jobs, daylight/timezone/holiday calculations, retention hold, deletion replay after restore and rollback to previous application artifact.
- UI: keyboard-only completion, screen-reader labels, narrow mobile layout, 200 percent zoom, slow network, failed save, unavailable item and unsaved-form conflict. Test key forms in a real browser, not just HTTP responses.
- Performance: a defined 50-concurrent-user workload, measured non-AI API p95 under two seconds, feed candidate ceiling enforced and no Scan in user request handlers. Record actual measurements; this package does not claim these targets have passed.

## 9E Release evidence and remaining real-world inputs

- Keep a test report with command, environment, date, result and known limits. Save contract validation, typecheck/build, critical integration tests, access tests, load results and restore evidence with the release commit.
- Required deployment inputs: actual AWS account/profile and cost authority; selected region; callback hostname; college representative and independent reviewers; approved domains and roster; unit leads/backups; emergency contacts; retention/appeal policy; SES sender; and approved AI model geography if enabled.
- These inputs do not prevent implementation against the supplied demo configuration. They must not be replaced with invented real approvals, identities, permissions or budget promises.
- Keep product, requirements and current LLD together. Future feedback should identify a page code, entity or operation and update the corresponding source and contract in the same change.
