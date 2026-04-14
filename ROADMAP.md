# pi-agent Roadmap

This document turns the vision for `pi-agent` into an execution plan.

It is intentionally more implementation-focused than the README and more checklist-driven than the umbrella issue.

---

## Milestone 0 — Planning and Structure

_Status: core docs are now in place. GitHub project / child issue splitting can continue incrementally._

Goal: make the project documentation and planning structure clear before implementation continues.

### Checklist
- [x] Rewrite README to describe vision, current capabilities, and architecture direction
- [x] Rewrite issue #12 as the umbrella issue
- [x] Add a roadmap document with milestones and checklists
- [ ] Decide whether to create a GitHub Project board for operational tracking
- [ ] Split umbrella work into smaller linked issues

### Done when
- core documents are aligned
- the repo has one clear source for vision, planning, and execution

---

## Milestone 1 — Stabilize the Core

_Status: mostly complete based on current implementation and manual testing. Remaining gaps are minor verification/polish, while the major unanswered work has moved into Milestone 2._

Goal: make the current extension coherent and shippable in its basic form.

### Bugs / correctness
- [x] Fix `/team` message injection shape
- [x] Fix `@file` system prompt loading
- [x] Verify leader prompt content is actually injected in the current session model
- [x] Verify named agent profile prompt content is actually injected for spawned subagents

### Config / parsing
- [x] Add `js-yaml`
- [x] Replace hand-rolled YAML parsing
- [x] Validate malformed YAML with actionable errors
- [ ] Document the supported `teams.yaml` shape more explicitly

### Cleanup
- [x] Remove dead code modules
- [x] Remove obsolete tests
- [x] Consolidate module layout around the current architecture
- [ ] Align command/tool naming where inconsistent

### Manual validation
- [x] `/team` works in a real session
- [x] `/agent` works in a real session
- [x] `/list` shows active sessions correctly
- [ ] `/kill` terminates a running session correctly under a slower/controlled test
- [x] `/agent` supports pending next-message delegation
- [x] `/agent cancel` cancels pending delegation

### Done when
- commands work reliably
- prompt loading works reliably
- config parsing is robust enough for real team configs
- dead architecture leftovers are removed

---

## Milestone 2 — Verify the Core Orchestration Loop

Goal: validate the actual manager/subagent workflow end to end.

This is now the main focus. The critical question is no longer command wiring, but whether the full question/answer loop behaves correctly across spawned processes.

### Done
- [x] Decide the intended behavior for `/agent`-spawned subagents: they always ask the parent orchestration session first
- [x] Verify which tool path is actually available in a spawned json subagent process
- [x] Confirm that direct `ask_user_question` is not a supported primary path in json subprocess mode
- [x] Add spawn-context metadata (`solo` vs `team`) end to end
- [x] For `solo` subagents, automatically pipe pending questions to the user from the parent session
- [x] For `team` subagents, surface the question to the active manager with direct-answer vs escalation guidance
- [x] Add explicit spawned-subagent clarification guidance to spawned prompts
- [x] Add a reproducible clarification test agent/profile
- [x] Create a reproducible test prompt / agent that forces a subagent to ask a clarification question
- [x] Subagent asks manager a question in the solo path
- [x] Parent session sees pending questions in the solo path
- [x] Parent session answers in the solo path
- [x] Subagent resumes and completes in the solo test flow
- [x] Manager answers directly in the team path (tool/session-level automated coverage)
- [x] Manager spawns a subagent (automated command/tool-layer coverage)

### Completion status
- [x] Document the supported clarification behavior clearly
- [x] Document the supported clarification model in user-facing docs
- [x] Explain solo vs team routing and when manager escalation is expected
- [x] Manager spawns multiple subagents in parallel (automated tool/integration coverage)
- [x] Results are aggregated correctly
- [x] One failed subagent does not corrupt all session state
- [x] Timeout behavior is defined and tested
- [x] Crash behavior is defined and tested
- [x] Add a slower/debug subagent scenario to make `/kill` easy to verify manually

### Notes from current implementation state
- spawn-time tool enforcement now parses agent frontmatter `tools`
- required orchestration tools are merged into the effective child toolset
- child sessions enforce effective tools via `setActiveTools(...)`
- member profiles are now resolved from `teams/members` paths instead of legacy `.pi/agents`
- solo clarification currently uses a plain input prompt in the parent session
- automated coverage now exists for implemented command-layer and question-routing behavior (`/agent`, `/list`, `/kill`, `/team`, solo clarification routing, team clarification surfacing, direct manager answer/unblock)
- subprocess-backed clarification integration coverage is now available behind an opt-in integration test guard (`npm run test:integration`)
- follow-up UX work for reusing/extending `ask_user_question` is tracked in issue #13

### Done when
- one happy path works reliably
- one escalation path works reliably
- one failure path is handled cleanly

---

## Milestone 3 — Finalize Team and Agent Resolution

Goal: remove ambiguity around configuration and search paths, and harden the runtime semantics around orchestration edge cases.

### Checklist
- [ ] Define final `teams.yaml` schema
- [ ] Define search path precedence for teams
- [ ] Define search path precedence for leader profiles
- [ ] Define search path precedence for member agent profiles
- [ ] Verify placeholder substitution behavior
- [ ] Add tests for lookup precedence
- [ ] Document resolution behavior in the README

### Post-M2 hardening
- [ ] Distinguish manual kill vs timeout clearly in result semantics and user-facing messages
- [ ] Add a more explicit non-zero child-exit crash test beyond the current process/spawn error coverage
- [ ] Optionally add a full `/kill` command-to-live-process integration test

### Done when
- users can predict where teams and profiles are resolved from
- resolution behavior is documented and testable

---

## Milestone 4 — Visibility and Task Dashboard

Notes captured from manual testing:
- `kill` is hard to use ergonomically because fast agents often finish before the user can copy/type a session id
- long term, `/list` and `/kill` should likely become a combined interactive agent-management UI with selection-based actions such as inspect vs kill

Goal: make delegated work visible while it is running.

### Checklist
- [ ] Decide whether to integrate with `pi-tasks` directly or build a local first version
- [ ] Define the status model: running, waiting-manager, waiting-user, done, failed, killed, timed-out
- [ ] Show active sessions with task summaries
- [ ] Show waiting/blocker states
- [ ] Show completed and failed sessions
- [ ] Define task creation/update ownership
- [ ] Add a dashboard or widget

### Done when
- the user can see what delegated agents are doing in real time

---

## Milestone 5 — Manager Memory

Goal: preserve useful project context across team sessions.

### Checklist
- [ ] Define memory file format
- [ ] Store session summaries
- [ ] Load relevant memory on `/team`
- [ ] Decide retention/pruning behavior
- [ ] Decide whether memory is automatic or opt-in

### Done when
- the manager can recover meaningful context across sessions

---

## Milestone 6 — Feedback Channel

Goal: let subagents report progress before they finish.

### Checklist
- [ ] Define a progress/blocker update schema
- [ ] Let subagents emit intermediate updates
- [ ] Surface blockers to the manager
- [ ] Surface progress in dashboard/task UI
- [ ] Decide whether updates are persisted

### Done when
- subagents can report progress, blockers, and partial findings before final completion

---

## Milestone 7 — Reusable Runtime

Goal: make orchestration primitives reusable by other Pi extensions.

### Checklist
- [ ] Extract process management utilities
- [ ] Extract session bridge utilities
- [ ] Extract config resolution utilities
- [ ] Define stable internal APIs
- [ ] Document what is reusable vs pi-agent-specific

### Done when
- orchestration logic can be reused without copy-paste

---

## Open Decisions

Additional notes captured from current testing:
- [ ] Should `/list` and `/kill` eventually be replaced by a single interactive agent-management command?
- [x] Spawned subagents in json/background mode should not ask the user directly; clarification should go through the parent orchestration path

These should be revisited as milestone work advances.

- [ ] Should subagents be allowed to spawn sub-subagents?
- [ ] Is orchestration depth limited to one level initially?
- [ ] Are session files ephemeral or persisted for debugging?
- [ ] Should users see raw subagent logs by default?
- [ ] Should `pi-tasks` be a dependency, optional integration, or only inspiration?
- [ ] What should happen to active agents across `/reload`?
- [ ] Should `run_subagents` support incremental progress updates?

---

## Suggested GitHub Structure

### Issues
- keep issue #12 as the umbrella issue
- create smaller child issues for milestone work
- link child issues back to #12

### Project board
Recommended columns:
- Backlog
- Ready
- In Progress
- Blocked
- Done

### Document roles
- `README.md` / `readme.md`: vision + current status
- `ISSUE-DRAFT.md`: umbrella issue body
- `ROADMAP.md`: execution checklist
- issue #13: follow-up UX work for solo-subagent question UI
