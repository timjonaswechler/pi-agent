# Unified Multi-Agent Orchestration for Pi

## Summary

Build a complete **multi-agent orchestration system for Pi** that allows a user to delegate work to either a **single agent** or a **team of agents**, while continuing to work in the same Pi session.

This issue is the **umbrella issue** for the product direction, architecture, current state, command/tool definitions, and implementation plan.

It should describe both:

- the **goal and vision** we understand today
- the **next steps** we need to take on top of the current implementation state

---

## Vision

The long-term goal is to make Pi feel less like a single assistant and more like a small engineering team.

A user should be able to:

- delegate a focused task to one specialist agent
- activate a manager-led team for broader tasks
- let the manager coordinate multiple subagents
- allow subagents to ask questions when blocked
- involve the human only when clarification or approval is needed
- observe what is currently running, blocked, completed, or failed

Example experiences we want:

- “take care of issue #42”
- “investigate why auth tests are flaky”
- “split this feature into research, implementation, and review”
- “refactor the auth module and report back”

The final experience should feel like delegating to a small team inside Pi.

---

## Product Goal

`pi-agent` should become a reliable orchestration layer for Pi with:

- single-agent delegation
- manager-led team mode
- manager ↔ subagent communication
- user escalation only when necessary
- active process/session tracking
- clear command and tool boundaries
- a path toward dashboards, memory, and reusable orchestration primitives

---

## Desired User Experience

### 1. Single-agent delegation
A user can run:

```text
/agent researcher investigate why test/auth.spec.ts is flaky
```

Expected outcome:
- Pi resolves the agent profile
- spawns a subagent
- the subagent works independently
- the subagent can ask questions when appropriate
- the final result is returned cleanly

### 2. Team mode activation
A user can run:

```text
/team engineering
```

Expected outcome:
- Pi resolves the team config
- activates a manager/leader profile
- the manager receives future tasks in the current session
- the manager decides whether to answer directly or delegate to subagents
- the manager escalates to the human only when necessary

### 3. Live visibility
While work is running, the user should eventually be able to see:
- active agents
- task summaries
- waiting/blocker states
- completed sessions
- failures/timeouts

---

## Architecture Direction

```text
CLI / TUI Layer
  ├─ commands: /agent, /team, /list, /kill
  ├─ team-mode state
  └─ dashboard / task visibility

Manager Agent
  ├─ receives tasks from user
  ├─ decides whether to answer or delegate
  ├─ spawns subagents
  ├─ answers or escalates questions
  └─ aggregates results

Process Manager
  ├─ spawns Pi subprocesses
  ├─ passes prompts/context
  ├─ tracks process lifetime
  ├─ handles output/final result extraction
  └─ supports timeout/kill/cleanup

Session Bridge
  ├─ stores pending manager questions
  ├─ stores answers
  └─ unblocks waiting subagents

Team + Agent Resolution
  ├─ teams.yaml loading
  ├─ leader prompt resolution
  ├─ agent profile resolution
  └─ placeholder substitution
```

---

## Communication Flows

### Flow A — User → Subagent

```text
User ──/agent──→ Subagent
                   ↓
           may ask user directly
                   ↓
              returns result
```

### Flow B — User → Manager → Subagents

```text
User ──/team──→ Manager
                   ↓
            run_subagents
                   ↓
        Subagent A / B / C
                   ↓
        ask_manager_question
                   ↓
      Manager answers or escalates
                   ↓
              work continues
```

### Escalation detail

```text
Subagent
  └─ ask_manager_question
        └─ Manager inspects pending questions
              ├─ answers directly
              └─ or asks the human via ask_user_question
```

---

## Current State

### Working or partially working
- subagent spawning exists
- manager/subagent question flow exists
- pending question lookup exists
- manager answer flow exists
- `/agent`, `/team`, `/list`, `/kill` exist
- placeholder substitution for leader prompts exists
- context filtering exists in some form
- ask-user-question integration exists for human escalation

### Known broken items
- `/team` injects the wrong message shape
- `@file` system prompt loading does not read file content correctly

### Implemented but not yet fully verified
- final output extraction from spawned agents
- question polling/unblocking behavior
- placeholder substitution in leader prompts
- multi-subagent aggregation behavior

### Not started or still unclear
- robust YAML parsing with `js-yaml`
- dashboard / `pi-tasks` integration
- manager memory
- subagent feedback/progress channel
- final search path rules for team and agent resolution
- `/reload` behavior for active subprocesses

### Cleanup still needed
- remove dead or obsolete modules
- remove tests tied to outdated architecture
- align naming and module layout with the real implementation

---

## Command Specification

The command surface should be explicit so the implementation does not drift.

### `/agent`
Spawn a single subagent directly from the current session.

**Syntax**
```text
/agent <agent-name> <task...>
```

**Behavior**
- resolve agent profile
- load prompt/persona
- spawn subagent subprocess
- pass task to subagent
- return acknowledgment and final result

**Failure cases**
- unknown agent profile
- invalid prompt file
- spawn failure
- timeout
- subprocess crash

### `/team`
Activate team mode using a named team definition.

**Syntax**
```text
/team <team-name>
```

**Behavior**
- resolve team config
- resolve manager/leader profile
- inject leader prompt into current session
- activate team mode for future user tasks

**Failure cases**
- missing team
- invalid YAML
- missing leader profile
- invalid message injection shape

### `/list`
List active spawned sessions.

**Behavior**
- show session id
- show agent name
- show task summary
- show status
- show started time if available

**Status examples**
- running
- waiting-manager
- waiting-user
- completed
- failed
- killed
- timed-out

### `/kill`
Kill a running subagent session.

**Syntax**
```text
/kill <session-id>
```

**Behavior**
- terminate subprocess if still active
- mark session as killed
- clean up tracking state

---

## Tool Specification

The internal tool surface should also be explicit.

### `run_subagents`
Spawn one or more subagents concurrently.

**Intended caller**
- manager agents

**Input**
```ts
{
  tasks: Array<{
    description: string
    agent?: string
  }>,
  timeoutSeconds?: number
}
```

**Expected behavior**
- spawn all tasks in parallel
- wait for all results
- aggregate outputs

### `ask_manager_question`
Subagent asks manager a blocking question.

**Intended caller**
- subagents only

**Input**
```ts
{
  question: string,
  context?: string
}
```

**Expected behavior**
- create a pending question record
- block until answer is available
- return the answer

### `get_pending_questions`
Manager lists unanswered subagent questions.

**Intended caller**
- manager only

**Expected behavior**
- return all currently pending unanswered questions

### `answer_manager_question`
Manager answers a pending subagent question.

**Intended caller**
- manager only

**Input**
```ts
{
  sessionId: string,
  questionId: string,
  answer: string
}
```

**Expected behavior**
- store answer
- unblock waiting subagent

### `ask_user_question`
Manager escalates to the human if it cannot answer confidently.

**Rule**
- manager-started subagents should ask the manager first
- the manager decides whether to escalate to the user

---

## Role and Permission Rules

To keep orchestration behavior consistent:

### User-started subagent
- may ask the user directly when appropriate

### Manager-started subagent
- should ask the manager first
- should not bypass the manager by default

### Manager
- may answer directly
- may escalate to the user
- may spawn multiple subagents
- owns delegation decisions

---

## Roadmap Summary

This issue is the umbrella. The execution checklist should live in `ROADMAP.md`.

### Phase 1 — Stabilize the core
- fix `/team` injection shape
- fix `@file` prompt loading
- add `js-yaml`
- remove dead code
- verify commands work in real sessions

### Phase 2 — Verify the orchestration loop
- manager spawns subagent
- subagent asks manager question
- manager answers or escalates
- subagent resumes
- final result returns correctly

### Phase 3 — Finalize team and agent resolution
- define final config schema
- define search path precedence
- document lookup behavior

### Phase 4 — Add visibility/dashboard support
- define status model
- show active sessions and blockers
- decide on `pi-tasks` integration

### Phase 5 — Add manager memory
- persist useful context across team sessions

### Phase 6 — Add subagent feedback channel
- allow progress/blocker updates before final completion

### Phase 7 — Extract reusable orchestration runtime
- make process/session/config primitives reusable by other Pi extensions

---

## Open Questions

These still need explicit decisions:

1. Should subagents be allowed to spawn sub-subagents?
2. Is orchestration depth limited to one level initially?
3. Are session files ephemeral or persisted for debugging?
4. Should users see raw subagent logs by default?
5. Should `pi-tasks` be a direct dependency, optional integration, or only inspiration?
6. What should happen to active agents across `/reload`?
7. Should `run_subagents` eventually support incremental progress updates?

---

## Repo Documentation Structure

To keep planning understandable:

- `README.md` / `readme.md` should describe the product vision, current capabilities, and architecture direction
- `ISSUE-DRAFT.md` should hold the umbrella issue body for GitHub issue #12
- `ROADMAP.md` should hold milestone checklists and acceptance criteria

A GitHub Project board would also be useful once this umbrella issue is split into concrete child issues.

---

## Success Criteria

This effort is successful when we can reliably demonstrate:

1. user activates a team with `/team`
2. user gives a real task
3. manager spawns one or more subagents
4. a subagent asks a clarification question
5. manager answers directly or escalates to the human
6. subagent resumes successfully
7. manager aggregates and returns the result
8. the user can inspect active or completed delegated work

If that works reliably, the core goal has been achieved.

---

## Labels

- `feature`
- `enhancement`
- `documentation`

---

## Related Work

This issue should remain the master issue for:
- subagent spawning
- team mode
- manager/subagent communication
- user escalation
- process/session tracking
- visibility/dashboard work
- future memory/feedback/runtime extraction
