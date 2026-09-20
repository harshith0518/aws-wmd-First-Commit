# M7 activities and marketplace

Read AGENTS.md, docs/00-remarks-and-decisions.md, docs/02-pages-and-interactions.md, docs/04-data-model.md, docs/06-workflows-and-consistency.md, specs/openapi.json and the implementation sequence in chapter 9.

Implement Activities first with accepted organizer seat, atomic admissions, private event teams, up to three coordinators, tasks and lead handover. Then implement Marketplace/lost-and-found and participant-only inquiries, block/report and expiry. Test last-seat races, removed-member access and private evidence.

Keep the implementation compact and preserve existing work. Update relevant contracts and docs together when resolving a mismatch. Run npm.cmd run check and meaningful module tests. End with implemented behavior, tests run, a reviewable diff and any remaining blockers.
