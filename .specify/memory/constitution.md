<!--
Sync Impact Report
- Version change: N/A → 1.0.0
- Modified principles: (initial adoption)
- Added sections: Core Principles, Safety & Constraints, Workflow & Quality, Governance
- Removed sections: None (template instantiation)
- Templates:
  - ✅ .specify/templates/plan-template.md (Constitution Check aligned)
  - ✅ .specify/templates/spec-template.md (already aligned, no change)
  - ✅ .specify/templates/tasks-template.md (testing discipline clarified)
  - ✅ .specify/templates/agent-file-template.md (no constitution-specific changes required)
  - ✅ .specify/templates/checklist-template.md (no constitution-specific changes required)
  - ⚠ .specify/templates/commands/* (directory does not exist in this repo)
- Deferred TODOs: None
-->

# AS400 Coding Helper Constitution

## Core Principles

### Principle 1 — Safety-First for IBM i / AS400

- Any feature that issues commands to an IBM i / AS400 system MUST be
  designed to be safe by default: lowest-privilege access, non-destructive
  operations by default, and explicit rollback or recovery steps.
- Production-impacting work MUST first be exercised against a non-production
  or isolated environment using the same steps described in the plan and
  tasks.
- Every change that can modify data or system configuration MUST document
  safety gates (backups, approvals, and monitoring) in the feature plan and
  tasks.

**Rationale:** The project exists to accelerate IBM i development without
compromising the stability or integrity of AS400 systems. Safety gates and
rollback paths make risk visible and auditable.

### Principle 2 — Spec-First, User-Focused Features

- No implementation work MAY start without a feature spec created from
  `.specify/templates/spec-template.md` and committed as
  `specs/[###-feature-name]/spec.md`.
- Each spec MUST define prioritized, independently testable user stories
  that can be delivered and demonstrated as standalone slices of value.
- Acceptance scenarios in the spec MUST be concrete enough that they can be
  turned into manual or automated tests without reinterpretation.

**Rationale:** Spec-first, user-focused work keeps the project anchored in
real user value and enables incremental delivery that can be validated at
each step.

### Principle 3 — Plan-Driven Implementation & Parallelism

- Every feature MUST have an implementation plan generated from
  `.specify/templates/plan-template.md` via `/speckit.plan` before tasks are
  created or code is changed.
- Plans MUST identify foundational work that blocks all user stories and
  isolate it into an explicit "Foundational" phase.
- Plans MUST highlight parallelization opportunities (tasks or stories
  marked as parallelizable) to enable safe concurrency without file
  conflicts.

**Rationale:** A plan that reflects dependencies and parallelism makes the
work predictable, reduces merge conflicts, and provides a clear review
surface for safety and scope.

### Principle 4 — Explicit Testing Discipline

- Tests are OPTIONAL globally but MUST be treated as first-class citizens
  whenever a spec or stakeholder explicitly requests them.
- When tests are requested, each user story MUST include corresponding test
  tasks in `tasks.md` that are executed before implementation tasks (write /
  ensure tests fail / then implement).
- For features that materially affect IBM i / AS400 behavior, at least one
  verification step (manual or automated) MUST be captured per user story,
  even if formal automated tests are not requested.

**Rationale:** Not every feature justifies full automation, but whenever
testing is requested or risk is high, test work must be deliberate, visible,
and ordered ahead of implementation.

### Principle 5 — Traceability Across Spec → Plan → Tasks

- Every user story in `spec.md` MUST be traceable into the implementation
  plan (by story ID or name) and then into `tasks.md`.
- Tasks MUST reference concrete file paths and, where applicable, the IBM i
  commands or APIs they affect.
- Project-level guidance (for example, generated agent files and checklists)
  MUST be kept in sync with the currently active plans and tasks so that
  runtime contributors can see the latest design and risk context.

**Rationale:** Traceability makes it possible to answer "where is this
requirement implemented?" and "what does this change impact?" without
guesswork.

## Safety & Constraints

- Features that interact with IBM i / AS400 systems MUST document:
  - Target environments (development, staging, production).
  - Required authorities and profiles.
  - Rollback strategy and expected recovery time.
- Non-functional constraints (performance, security, availability) relevant
  to IBM i workloads MUST be captured in the feature spec and reflected in
  the plan and tasks where they influence design or scope.

## Workflow & Quality

- Default workflow for a new feature:
  1. Create `spec.md` from the spec template (Principle 2).
  2. Generate `plan.md` from the plan template via `/speckit.plan` and
     complete the Constitution Check (Principle 3).
  3. Generate `tasks.md` via `/speckit.tasks`, ensuring tasks are grouped by
     user story and reflect any requested tests (Principle 4).
  4. Execute tasks in dependency order, respecting foundational gates and
     safety constraints (Principle 1).
- Code review MUST verify:
  - That spec, plan, and tasks exist and are consistent.
  - That IBM i / AS400 impacting work has documented safety gates.
  - That any requested tests are defined and executed in the expected order.

## Governance

- This Constitution supersedes ad-hoc practices for how work is planned and
  executed in this repository.
- Amendments:
  - MUST be made via pull request that updates this file and includes an
    updated Sync Impact Report at the top.
  - MUST explain whether the change is a MAJOR, MINOR, or PATCH update to
    the Constitution and why.
  - MUST update any affected templates in `.specify/templates/` or add
    explicit TODOs in the Sync Impact Report if a follow-up is required.
- Versioning:
  - `CONSTITUTION_VERSION` follows semantic versioning (`MAJOR.MINOR.PATCH`).
  - MAJOR: Backward-incompatible changes to principles or governance (for
    example, changing safety requirements or removing a principle).
  - MINOR: Adding a new principle or materially expanding existing guidance.
  - PATCH: Clarifications, wording changes, and non-semantic refinements.
- Compliance:
  - The "Constitution Check" section in `plan.md` MUST be populated for each
    feature and reviewed in every implementation plan review.
  - Checklists generated from `checklist-template.md` SHOULD reference
    relevant principles when they are used to guide high-risk work.

**Version**: 1.0.0 | **Ratified**: 2025-11-15 | **Last Amended**: 2025-11-15

