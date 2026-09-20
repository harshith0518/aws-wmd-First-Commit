# 10 Sources and requirement traceability

## 10A Source documents and research

The source DOCX files are retained in docs/source. The remarks decision log maps the three additions in the open review draft to specific features. Research below supports technical constraints and process choices; the implementation limits, milestones and architecture are CampusFix design decisions.

- AWS HTTP API JWT authorization: scopes distinguish API access, with issuer, audience/client and time validation. https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html
- Cognito resource servers and scopes: configure the application API scope and OAuth authorization flow. https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-define-resource-servers.html
- DynamoDB Query: indexed access, pagination and post-read filtering behavior. https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html
- DynamoDB transactions: conditional atomic operations and transaction limits. https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html
- DynamoDB TTL: expiration cleanup is asynchronous. https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html
- S3 presigned URLs: bearer access and expiration behavior. https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html
- GuardDuty Malware Protection for S3: managed scan verdicts through EventBridge support the proposed quarantine flow; skipped or failed scans are not clean. https://docs.aws.amazon.com/guardduty/latest/ug/gdu-malware-protection-s3.html and https://docs.aws.amazon.com/guardduty/latest/ug/monitor-with-eventbridge-s3-malware-protection.html
- S3 event notifications and Lambda SQS: design duplicate-safe consumers. https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html and https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html
- Bedrock model geography: verify the chosen model's in-region or cross-region inference route independently of database region. https://docs.aws.amazon.com/bedrock/latest/userguide/models-region-compatibility.html
- Lambda runtimes: Node 24 is a supported managed runtime; avoid preview runtimes for this product. https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html
- Aurora alternatives: auto-pause and DSQL pricing are relevant when reconsidering SQL; DynamoDB remains this version's selected database. https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html and https://aws.amazon.com/rds/aurora/dsql/pricing/
- Price verification before deployment: https://aws.amazon.com/dynamodb/pricing/ and https://aws.amazon.com/bedrock/pricing/ and https://aws.amazon.com/cognito/pricing/ and https://aws.amazon.com/s3/pricing/
- Budget timing: alerts do not create an instantaneous hard spending limit. https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html
- Hono local and Lambda adapters: one application can use separate runtime entry points. https://hono.dev/docs/getting-started/nodejs and https://hono.dev/docs/getting-started/aws-lambda
- Vite setup and supported Node versions: https://vite.dev/guide/
- Codex project instructions: AGENTS.md supplies repository guidance; use the included milestone prompts as task inputs. https://learn.chatgpt.com/docs/agent-configuration/agents-md
- University of Cambridge student complaints: staged case handling, conflicts and independent review inform the proposed process. CampusFix does not adopt another institution's legal authority or deadlines. https://www.studentcomplaints.admin.cam.ac.uk/student-complaints
- University of Michigan Ombuds principles: impartiality and independence inform reviewer separation; the app is not an ombuds office. https://ombuds.umich.edu/article/our-principles-and-standards
- First Commit rules: verify final submission details on the live event site. https://www.wemakedevs.org/aws/first-commit/rules
- Technical and process research was checked on 19 and 20 September 2026. Account availability, prices and event deadlines still need a deployment/submission-time check.

## 10B Requirement coverage map

- Review 1A and 1B purpose/roles: chapters 1 and 3; pages A01-A04 and G02; identity, membership and configuration contracts.
- Review 2A categories plus custom-body remark: chapters 3 and 4; page G01; typed categories/units/groups endpoints and configured ownership.
- Review 2B visibility: chapter 3 and query rules in 4; audience controls on every compose/detail page; cross-scope tests in 9.
- Review 3A and 3B issues/deadlines plus poor-response remark: chapters 5 and 6; W02-W05 and G05; issue commands, service reviews and independent appeals.
- Review 4A Questions: chapters 4-6; page C01; question/reply/accepted-answer/conversion contracts.
- Review 4B Activities plus event-team remark: chapters 4-6; pages C02 and C05; participation, coordinator, team task and leadership contracts.
- Review 4C marketplace/lost-and-found: chapters 4-6; C03 and C04; listing lifecycle, private inquiry, block and report contracts.
- Review 4D navigation/alerts: chapter 2 shared shell and W01/W06; notification/preference contracts and worker design in 8.
- Review 5 data/files/history: chapters 4, 6 and 7; typed entities, attachment operations, retention jobs and audit/export contracts.
- Review 6 AI: chapter 7 and W07; knowledge and AI contracts with sources, source freshness, quota and fallback tests.
- Review 7 risk/credibility: chapters 3, 6, 7 and 9; independent review, access controls, honest metrics and recovery evidence.
- Review 8 AWS/cost: chapter 8; deployment boundaries, workload formulas, quotas and account-specific pricing inputs.
- Review 9 release/design: chapter 9; eight implementation prompts, starter checks and deployment acceptance matrix.
