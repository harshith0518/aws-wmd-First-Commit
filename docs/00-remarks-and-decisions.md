# Remarks incorporated into the design

Your open CampusFix Requirements Review contained three added remarks. The copy in docs/source preserves that draft, including its original wording. This decision log explains how each remark changes the implementation.

## Custom categories and college bodies

- Remark: allow a custom category when a college has another body that should handle issues.
- Decision: campus administrators can create, rename, order and archive categories and handling units. The initial fourteen categories are defaults, not a hardcoded enum.
- Each active category needs a default handling unit; each unit needs a verified lead, backup and escalation contact. Students can suggest a missing category through Other, but cannot create an unstaffed official queue.
- A custom category does not automatically create a private group or grant an executive role. Category, audience group and handling unit remain separate records.
- Retain category IDs when renamed. Archive categories with historical records; require migration of open issues before disabling their handling unit.

## Official communication and poor responses

- Remark: make interactions with executives official and constructive, and support a complaint when the response is unsatisfactory.
- Decision: show the campus approval status and verified role of the responder, an expected next update, a visible case timeline and a short conduct policy at compose time. Never claim institutional endorsement before actual college approval.
- Add Request review beside issue responses. Reasons: no response, incomplete fix, inappropriate conduct or retaliation. The student can link a reply, describe the problem and attach permitted evidence.
- This creates a private ServiceReview linked to the original issue. A separate reviewer is assigned; the original responder cannot decide their own review. The original issue remains visible to its existing audience, with a neutral review-pending label that does not expose private allegations.
- Reviewer decisions require a reason and corrective next action when applicable. The student can appeal once to an independent higher reviewer. Staff can give context through an attributed response, without deleting the student's report.
- Use reminders, templates and review ownership to improve communication. Do not use AI to score behavior, punish students, erase criticism or publish staff popularity rankings. Respectful criticism is allowed.
- The service-review workflow is a product procedure. Before a real pilot, the college must map it to its actual grievance process and name independent reviewers; the app does not replace statutory or institutional remedies.

## Event groups with a lead

- Remark: arrange a head or group of students around an event.
- Decision: every activity gets an optional private team space for accepted participants. The organizer is the lead and can appoint up to three coordinators from accepted participants.
- Team space contains updates, a task list, private logistics, shared permitted files and an opt-in display-name roster. It uses asynchronous posts, not a separate chat system.
- Coordinator powers apply to that activity only. They can manage tasks and updates; only the lead can appoint/remove coordinators, change capacity or cancel the activity. Admissions can be delegated explicitly by the lead.
- Leaving removes access to private team details. Completion archives the space read-only; retention follows the activity policy. These temporary teams are not official departments or permanent campus groups.

## Clarifications applied throughout

- The complete product remains in the plan. R1, R2 and R3 are implementation order, not deletion of agreed features.
- Cost figures remain planning assumptions until measured in the chosen AWS account and region. Model access, verified college contacts, production email delivery and real retention policy are deployment inputs, not reasons to delay local coding.
