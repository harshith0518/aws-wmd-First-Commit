# CampusFix for AWS First Commit

CampusFix makes college service issues traceable from student report to accountable resolution, with private independent reviews and a permission-aware resolution library.

**Working hackathon core:** private drafts, campus/hostel/department visibility, responsible teams, service deadlines, staff queue, replies and private notes, affected status, ownership handover, all fourteen issue commands, reporter-confirmed closure/reopening, independent service reviews and reviewed resolution search.

**AWS deployment:** follow [AWS-DEPLOY.md](AWS-DEPLOY.md) in AWS CloudShell. The CDK stack and deploy/seed/smoke scripts are implemented; a live URL must be verified after deployment in your account. [SUBMISSION.md](SUBMISSION.md) contains the demo walkthrough and honest release boundary.

The full LLD also includes campus administration, notifications and community features that are not complete. Uploads work in local verification but are disabled in this AWS release until the real scan pipeline is accepted. Bedrock/AI is optional and disabled.

```mermaid
flowchart LR
  Browser --> CF[CloudFront + private S3]
  Browser --> Cognito[Cognito code + PKCE]
  Browser --> Gateway[HTTP API + JWT]
  Gateway --> Lambda[Hono Lambda]
  Lambda --> DB[Core / Discovery / Jobs DynamoDB]
  Schedule[EventBridge] --> Worker[Transfer expiry Lambda]
  Worker --> DB
```

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
- `infra`: CDK AWS demo stack, scoped IAM and infrastructure/security tests.
- `scripts`: local development, contract checks, AWS packaging/deploy/publish/seed/smoke commands.
- `SETUP-VERIFICATION.md`: exact checks, installed versions and limitations.

See `SETUP-VERIFICATION.md` for exact check counts and cloud acceptance limits. DynamoDB Local integration uses Java because Docker is unavailable; it never points at AWS.

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
