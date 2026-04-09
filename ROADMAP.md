# pi-agent Roadmap

This document turns the vision for `pi-agent` into an execution plan.

It is intentionally more implementation-focused than the README and more checklist-driven than the umbrella issue.

---

## Milestone 0 — Planning and Structure

Goal: make the project documentation and planning structure clear before implementation continues.

### Checklist
- [ ] Rewrite README to describe vision, current capabilities, and architecture direction
- [ ] Rewrite issue #12 as the umbrella issue
- [ ] Add a roadmap document with milestones and checklists
- [ ] Decide whether to create a GitHub Project board for operational tracking
- [ ] Split umbrella work into smaller linked issues

### Done when
- core documents are aligned
- the repo has one clear source for vision, planning, and execution

---

## Milestone 1 — Stabilize the Core

Goal: make the current extension coherent and shippable in its basic form.

### Bugs / correctness
- [ ] Fix `/team` message injection shape
- [ ] Fix `@file` system prompt loading
- [ ] Verify leader prompt content is actually injected
- [ ] Verify named agent profile prompt content is actually injected

### Config / parsing
- [ ] Add `js-yaml`
- [ ] Replace hand-rolled YAML parsing
- [ ] Validate malformed YAML with actionable errors
- [ ] Document the supported `teams.yaml` shape

### Cleanup
- [ ] Remove dead code modules
- [ ] Remove obsolete tests
- [ ] Consolidate module layout around the current architecture
- [ ] Align command/tool naming where inconsistent

### Manual validation
- [ ] `/team` works in a real session
- [ ] `/agent` works in a real session
- [ ] `/list` shows active sessions correctly
- [ ] `/kill` terminates a running session correctly

### Done when
- commands work reliably
- prompt loading works reliably
- config parsing is robust enough for real team configs
- dead architecture leftovers are removed

---

## Milestone 2 — Verify the Core Orchestration Loop

Goal: validate the actual manager/subagent workflow end to end.

### Happy path
- [ ] Manager spawns a subagent
- [ ] Subagent completes without questions
- [ ] Final result is returned cleanly

### Question/answer path
- [ ] Subagent asks manager a question
- [ ] Manager sees pending questions
- [ ] Manager answers directly
- [ ] Subagent resumes and completes

### Human escalation path
- [ ] Manager escalates a subagent question to the user
- [ ] User answer is returned to manager
- [ ] Manager forwards answer to subagent
- [ ] Subagent resumes and completes

### Parallel path
- [ ] Manager spawns multiple subagents in parallel
- [ ] Results are aggregated correctly
- [ ] One failed subagent does not corrupt all session state

### Failure handling
- [ ] Timeout behavior is defined and tested
- [ ] Kill behavior is defined and tested
- [ ] Crash behavior is defined and tested

### Done when
- one happy path works reliably
- one escalation path works reliably
- one failure path is handled cleanly

---

## Milestone 3 — Finalize Team and Agent Resolution

Goal: remove ambiguity around configuration and search paths.

### Checklist
- [ ] Define final `teams.yaml` schema
- [ ] Define search path precedence for teams
- [ ] Define search path precedence for leader profiles
- [ ] Define search path precedence for member agent profiles
- [ ] Verify placeholder substitution behavior
- [ ] Add tests for lookup precedence
- [ ] Document resolution behavior in the README

### Done when
- users can predict where teams and profiles are resolved from
- resolution behavior is documented and testable

---

## Milestone 4 — Visibility and Task Dashboard

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
