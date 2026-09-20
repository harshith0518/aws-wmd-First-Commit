# CampusFix for AWS First Commit

CampusFix makes college service issues traceable from student report to accountable resolution, with scoped student questions, event teams and a campus marketplace.

This folder contains the design and working identity and text reporting slices: private issue drafts, confirmed audience, accountable owner, service deadlines and permission-filtered feeds. See `PROGRESS.md` for current scope and `SETUP-VERIFICATION.md` for verification evidence. The core staff-to-reporter resolution loop and evidence lifecycle also work locally. Real AWS storage/scanning acceptance, review evidence/appeals, notifications and cloud deployment remain pending.

## Read in this order

1. `docs/00-remarks-and-decisions.md` — all three remarks from your Word draft and the resulting decisions.
2. `docs/CampusFix Low Level Design.docx` — the complete readable design.
3. `docs/01-...` through `docs/10-...` — editable, searchable versions for Codex CLI.
4. `specs/openapi.json` — typed API contract; each operation is explicitly marked implemented or pending.
5. `specs/dynamodb-tables.json` and `specs/demo-seed.dynamodb.json` — database setup and synthetic fixtures.
6. `docs/09-build-plan-and-acceptance.md` and `prompts/` — implementation order and ready-to-use coding tasks.

Original requirements and the copy containing your remarks are in `docs/source/`. The original project folder remains separate.

## Start locally

Use Node 24. On this Windows machine use `npm.cmd` because the PowerShell npm shim is broken.

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd run dev
```

Frontend: http://localhost:5173. API health: http://127.0.0.1:3001/api/health. The public screen and health endpoint need no AWS credentials. Real sign-in requires a configured Cognito pool and public app client; copy `.env.example` to `.env` and supply its public identity settings. Both servers read root `.env`. Stop with Ctrl+C.

Once Docker Desktop is running:

```powershell
docker compose up -d
powershell -ExecutionPolicy Bypass -File scripts/init-local-db.ps1
powershell -ExecutionPolicy Bypass -File scripts/seed-local-db.ps1
```

Local seed identities are fake test references, not Cognito logins. No real campus data or secrets are included. Table initialization never connects to a remote endpoint.

## Begin with Codex CLI

Open this folder in your terminal, start `codex`, and give it the first task:

> Read AGENTS.md and PROGRESS.md, then implement the next unfinished slice from the numbered prompts. Preserve existing work, run the relevant checks and update the progress journal.

Then continue through the prompts in order. The shared contracts let frontend, backend and DB work proceed in parallel after foundation review.

## Contents and status

- `apps/web`: React/Vite identity, reporting, drafts, scoped feed, staff queue resolution/history, evidence, threaded discussions, affected status and ownership handover, private service reviews and reviewed resolution library screens connected to real APIs.
- `apps/api`: Hono local server and Lambda entry; identity, authorization, atomic drafts/publication, workflow commands, version-bound evidence processing and scoped reads.
- `packages/contracts`: shared Zod request/response contracts aligned with implemented OpenAPI operations.
- `infra`: deployment implementation guide; no AWS resources provisioned.
- `scripts`: development runner, contract checks and local database setup.
- `SETUP-VERIFICATION.md`: exact checks, installed versions and limitations.

Typechecks, 93 automated tests, production builds and synthetic browser reporting/evidence checks passed. DynamoDB Local integration runs through Java because Docker is unavailable. Real Cognito/S3/GuardDuty acceptance, review evidence/appeals, notifications, Bedrock and AWS deployment remain unverified or unfinished.

The earlier $50/month number is a planning target, not a verified AWS bill. See chapter 8 for the workload model and deployment inputs.

## Database fallback and verification

If Docker is unavailable, start the official Java distribution in a separate terminal:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-local-db.ps1
```

Then initialize and seed with the scripts above and run `npm.cmd run test:integration`.
The database is synthetic and in memory; recreate it after restarting. No cloud credentials are used.
Run `npm.cmd run check` for contracts, all type checks, unit/security tests and production builds.
Run `npm.cmd run format` to format application code.

For isolated browser verification with synthetic identities and disposable local tables, run `npm.cmd run test:browser` and open http://127.0.0.1:3002. This is a test rig, not a production login mode.
