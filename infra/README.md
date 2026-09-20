# AWS demo infrastructure

Use [the deployment guide](../AWS-DEPLOY.md). `stack.ts` implements the AWS release; `app.ts` fixes the stack to `CampusFixDemo` in Mumbai. No resources are created by `npm run check`, tests or offline synthesis.

- Private S3 and CloudFront OAC, HTTPS/security headers, navigation-only SPA rewriting and correct asset/index caching.
- Cognito Lite/classic hosted UI, email login, public PKCE client, exact callbacks, no open signup. MFA optional for this synthetic demo; required pilot setup is pending.
- JWT/scoped API Gateway routes and independent JWT/canonical authorization in the Hono Lambda. Exact frontend CORS, 20 rps / burst 40.
- Three on-demand retained/deletion-protected DynamoDB tables with the agreed GSIs; Jobs TTL. No Scan grant.
- Node 24 x64 Lambda artifacts with Linux Sharp; a separate scheduled transfer-expiry entry. No VPC or provisioned concurrency. Reserved concurrency is omitted so a low-quota fresh account can deploy; throttle/load tuning remains pending.
- Generated Secrets Manager cursor key, seven-day function logs and error alarms. No alarm delivery destination yet.
- Uploads, Bedrock and sensitive-case intake disabled; no GuardDuty/S3 file resources, SES, SQS or notification consumers are provisioned.

This combines the four logical boundaries in chapter 8 into one demo stack. The web distribution is created before the Cognito callback/client; the frontend uses the API's separate HTTPS origin. Tests detect dependency cycles. Production requires separate environments, PITR/restore verification, identity/MFA operations and the missing workers/features.

Offline checks (PowerShell example; placeholder account is for synthesis only):

```powershell
npm.cmd run aws:package
$env:CDK_DEFAULT_ACCOUNT='111111111111'
$env:CDK_DEFAULT_REGION='ap-south-1'
npm.cmd run aws:synth
npm.cmd run infra:check
```

`aws:deploy` always obtains the real account from STS and overrides that placeholder. CloudShell performs an additional native Linux cold-start import before deployment. Local Windows verification does not claim Linux execution or live AWS acceptance.
