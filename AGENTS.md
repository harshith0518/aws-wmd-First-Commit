# CampusFix implementation instructions

Build the agreed campus accountability and community product incrementally from the design. This repository contains the tested accountability core and a CDK demo deployment package. Read the latest PROGRESS.md and AWS-DEPLOY.md before continuing; the full pilot/community LLD is not complete.

## Read first

Read README.md, docs/00-remarks-and-decisions.md, the relevant numbered LLD chapters, and specs/openapi.json. docs/09-build-plan-and-acceptance.md defines milestone order. Explicit current user directions take priority. Reconcile a contradictory schema and chapter before implementing affected behavior.

## Working rules

- Keep one TypeScript modular backend, React/Vite frontend and the documented DynamoDB access patterns. Do not add a second database, ORM, microservices, vector service or auth provider without explaining the concrete need.
- Use npm workspaces and the checked-in lockfile. On this Windows host run npm.cmd if npm.ps1 fails. Install only dependencies needed by the current milestone.
- Own a bounded set of files when working in parallel. You are not alone in the codebase: preserve others' edits and coordinate changes to packages/contracts and specs.
- Implement vertical slices. A mock screen, disabled button or hardcoded data does not complete its feature. Clearly label synthetic data and partial implementation.
- Centralize authorization and field serialization. Campus membership and scoped roles come from current server records. Never add a production auth bypass, browser AWS secrets or public evidence URLs.
- Revalidate canonical records after index lookups and before file/AI/export output. Every workflow write uses versions, idempotency where specified, history and outbox consistency.
- Preserve user remarks: custom categories and official bodies, independent service reviews for poor responses, and private event teams with leads/coordinators.
- Use task-specific environment variables. Never print credentials or complaint bodies. Keep .env and real campus data out of Git.
- Do not create or destroy paid cloud resources merely to run local tests. If deployment is requested, implement and validate the concrete CDK change before executing the authorized deployment.

## Verification

Run npm.cmd run check after meaningful code changes. Add domain tests that verify behavior and security, not tests that merely duplicate implementation. Use DynamoDB Local integration tests for conditional writes and concurrency once Docker is running. Read the release checks in chapter 9 for the affected module.

Keep SETUP-VERIFICATION.md honest. Record what ran, what passed and what remains untested. Finish with changed behavior, validation and material limitations.
