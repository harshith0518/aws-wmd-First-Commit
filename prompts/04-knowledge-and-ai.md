# M4 reviewed history and optional AI

Read AGENTS.md, docs/00-remarks-and-decisions.md, docs/07-files-ai-and-retention.md, specs/openapi.json and the implementation sequence in chapter 9.

Implement authorized knowledge cards, bounded retrieval, Bedrock adapter, citation validation, source revalidation, quotas and fallback. Keep AI disabled until an approved model/region is configured. Run the 30-case evaluation and privacy/adversarial tests; report measured results rather than asserting success.

Keep the implementation compact and preserve existing work. Update relevant contracts and docs together when resolving a mismatch. Run npm.cmd run check and meaningful module tests. End with implemented behavior, tests run, a reviewable diff and any remaining blockers.
