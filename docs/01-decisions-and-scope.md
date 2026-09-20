# 1 Product and implementation decisions

Build CampusFix as one verified campus workspace for accountable service issues and student collaboration. This specification defines the full product and a staged implementation. The starter repository contains a working development shell and health endpoint; the business features described here are the work to implement next.

## 1A Release boundaries

- R1 hackathon: authenticated demo campus, approved memberships, campus and group feeds, issue creation and evidence, accountable assignment, replies, progress, resolution confirmation, reopening, history, staff queue, basic administration, minimal independent service review, and one optional source-linked AI suggestion. Use synthetic data for demonstrations.
- R2 campus pilot: real college onboarding, authority verification, Questions, notices, moderation and appeals, notification delivery, sensitive-case controls, file scanning, recovery and retention operations. Do not invite real students before these safeguards pass acceptance checks.
- R3 community: Activities, Marketplace, lost and found, private coordination, subscriptions and fuller analytics. They are fully specified here and must be implemented as later modules, not silently removed.
- R4 scale: onboard further campuses after isolation tests and operating costs are measured. Records carry campus IDs from R1 so this does not need a database rewrite.
- Feature flags live in campus configuration. A disabled feature is absent from navigation and its API returns FEATURE_DISABLED. Disabled AI still leaves keyword search available.

## 1B Chosen stack

- Frontend: React, TypeScript and Vite; React Router for routes, TanStack Query for server state, React Hook Form plus Zod for forms. Use ordinary CSS variables and small reusable components. Install the feature libraries when implementing their first module.
- Backend: TypeScript and Hono as one modular application. Run the same domain services through the Node adapter locally and the Lambda adapter on AWS. Route handlers validate and authorize; domain services enforce workflows; repository modules perform DynamoDB operations.
- Database: DynamoDB on demand, with Core, Discovery and Jobs tables. Exact query patterns and conditional writes are defined in section 4. Avoid an ORM that conceals partition keys or transactions.
- Identity: Cognito managed login using authorization code with PKCE. College roles and group memberships remain authoritative in Core, not browser state or long-lived token claims.
- Hosting: private S3 web bucket plus CloudFront; HTTP API Gateway and Lambda; private evidence buckets; SQS workers and scheduled jobs. AWS CDK in TypeScript will define infrastructure during implementation.
- AI: Bedrock Converse with an explicitly approved model or inference profile. Begin with authorized keyword retrieval; no training, vector database, agent tools or GPU service.
- Development: npm workspaces, Node 24 locally, lockfile, the Node test runner through TSX and later Playwright. Deploy using the supported nodejs24.x Lambda runtime on Amazon Linux 2023; keep the local and deployed major version aligned.
- SQL alternatives: PostgreSQL can express these relationships naturally, and Aurora DSQL is a credible pay-per-use option. DynamoDB is selected for this version to retain the agreed AWS direction, avoid SQL connection infrastructure and make per-request cost controls explicit. This decision carries the cost of implementing application-level references and feed projections.

## 1C Boundaries that keep the project small

- Keep one backend deployment plus asynchronous workers from the same codebase. Do not split every feature into a service.
- One college can start with one hostel and two service teams. Seed all category definitions, but activate only teams with an accountable lead and backup.
- Maximum 20 approved groups per member, 4 selected audience groups per post, 8 handling collaborators and 3 attachments per post. Reject a larger request with a clear error; these bounds keep authorization and transaction sizes predictable.
- Separate audience, topic, physical location and handling unit. Example: a hostel Wi-Fi report has hostel audience, connectivity topic, hostel location and IT ownership.
- Search first means selected feed filters and recent reviewed resolution matches. It is not an exhaustive full-text search engine; show this scope in the UI.
- Do not implement platform payments, live chat sockets, video uploads, live location, public complaint indexing or anonymous administrative accounts.
- General fee policy can be campus-visible. A student's receipt, marks, welfare report or personal dispute uses a restricted case. Open-source software does not make campus records public.

## 1D Repository responsibilities

- apps/web/src/features owns routes and view components grouped by identity, issues, questions, activities, marketplace and administration. Shared UI primitives belong in components; HTTP and auth wrappers in lib.
- apps/api/src/modules owns the same domain modules. Each module contains routes, service, repository and tests. Shared policy, errors, idempotency and AWS clients belong in core.
- packages/contracts owns public request and response schemas and inferred TypeScript types. It must not expose DynamoDB keys, Cognito secrets or staff-only fields to public DTOs.
- infra owns CDK stacks, environment validation and deployment outputs. scripts owns local database initialization, synthetic seed loading and smoke checks.
- docs owns reviewed human specifications; specs owns machine-readable contracts; prompts contains ordered implementation tasks for Codex CLI.
- Source order: explicit user feedback, the remarks decision log, these LLD chapters, then contracts. When a chapter and machine contract disagree, reconcile both in the same change before implementing the affected feature.

## 1E System request flow

- Browser authenticates with Cognito, calls /api/v1 using an access token, and sends the selected campus in the route.
- API verifies identity, reads active campus membership and scoped grants, validates input, authorizes the target, and performs a conditional transaction.
- The transaction writes canonical records, necessary discovery pointers, audit history and an outbox job. The response returns the committed version.
- Jobs dispatch notifications, file processing and reminders with deduplication. Each worker rechecks the current record before sending or changing anything.
- Every read through a discovery index resolves the canonical record and current permission before serializing a DTO. An index entry is a candidate, never proof of access.
