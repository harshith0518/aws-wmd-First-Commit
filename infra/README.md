# Infrastructure implementation boundary

No cloud resources have been created. The API bundle exports `handler` from `apps/api/dist/lambda.mjs`; it implements only liveness routes. It is not a deployment package or a readiness check for AWS dependencies.

Implement infrastructure from the low-level design in `docs/` and specifications in `specs/`. The intended services are static web hosting, HTTP API, Lambda, Cognito, DynamoDB, private S3, and optional Bedrock. Define infrastructure as code before deployment, validate its changes, and provision separate development and production resources.

Before adding campus-content routes, implement server-side identity verification, active campus membership checks, per-record authorization, and input validation. Never use the anonymous health endpoint as an authentication pattern for product routes.

Deployment commands will be added when real infrastructure exists and can be validated. `npm run build` currently builds frontend assets and the health-only Lambda entry point without provisioning or contacting AWS.

## Local database

`docker compose up -d dynamodb` starts the AWS DynamoDB Local 3.3.1 image on `http://127.0.0.1:8000`. It uses in-memory storage: stopping the container loses all local test data. This is intentional; create the table and synthetic fixtures from the specifications when implementing persistence. The current health-only API does not connect to DynamoDB.

Docker Desktop must be running with Linux containers. The Docker daemon was unavailable during starter verification, so this container has not been started or tested. The image tag was checked against [AWS's Docker Hub listing](https://hub.docker.com/r/amazon/dynamodb-local/tags) on 19 September 2026. See [DynamoDB Local usage notes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.UsageNotes.html) for differences from the AWS service.
