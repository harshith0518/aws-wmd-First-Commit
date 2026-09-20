# M1 identity and data foundation

Read AGENTS.md, docs/00-remarks-and-decisions.md, docs/03-identity-and-permissions.md, docs/04-data-model.md, specs/openapi.json and the implementation sequence in chapter 9.

Implement environment validation, shared public schemas, DynamoDB repository keys, Cognito access-token verification and current membership authorization. Add campus selection, callback and pending membership screens. Keep profile/role authority server-side. Validate local DB conditionals and cross-campus/revoked-member denial. Do not implement all business modules yet.

Keep the implementation compact and preserve existing work. Update relevant contracts and docs together when resolving a mismatch. Run npm.cmd run check and meaningful module tests. End with implemented behavior, tests run, a reviewable diff and any remaining blockers.
