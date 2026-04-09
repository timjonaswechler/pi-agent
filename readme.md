# pi-agent

`pi-agent` is a Pi extension for **multi-agent orchestration**.

It aims to let a developer delegate work to a **single agent** or a **team of agents** inside Pi, while staying in control of the session and only stepping in when clarification or approval is needed.

## Vision

The long-term goal is to make Pi feel less like a single assistant and more like a small engineering team.

A user should be able to:

- ask one specialist agent to handle a focused task
- activate a team manager that can delegate work to several subagents
- let the manager coordinate questions, blockers, and results
- stay in the loop only as the final escalation point
- see what is running, blocked, completed, or failed

Example experiences we want:

- “take care of issue #42”
- “investigate why auth tests are flaky”
- “split this feature into research, implementation, and review”
- “refactor the auth module and tell me what changed”

## Product Goal

`pi-agent` should provide a reliable orchestration layer for Pi with:

- agent spawning
- team mode activation
- manager ↔ subagent coordination
- human escalation when necessary
- active session tracking
- a path toward dashboards, memory, and reusable orchestration primitives

## Current Capabilities

The project already has a meaningful foundation.

### Commands

- `/agent <name> <task...>` — spawn a single subagent
- `/team <name>` — activate a team manager for the current session
- `/list` — list active subagents
- `/kill <session-id>` — kill a running subagent

### Tools

- `run_subagents` — manager spawns multiple subagents in parallel
- `ask_manager_question` — subagent asks its manager a blocking question
- `get_pending_questions` — manager lists unanswered subagent questions
- `answer_manager_question` — manager answers a pending subagent question
- `ask_user_question` — manager escalates a question to the human when needed

### Communication model

There are two main modes:

#### 1. User → Subagent
The user directly spawns a single agent.

```text
User ──/agent──→ Subagent
                   ↓
           may ask user directly
                   ↓
              returns result
```

#### 2. User → Manager → Subagents
The user activates a team. The manager decides how to delegate work.

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

## Current State

### Working

- subagent spawning exists
- manager/subagent question flow exists
- manager answer flow exists
- pending question lookup exists
- `/agent`, `/team`, `/list`, `/kill` exist
- placeholder substitution for team leader prompts exists
- context filtering exists in some form

### Known issues

- `/team` currently injects the wrong message shape
- system prompt file loading via `@file` is not working correctly
- YAML loading should move to `js-yaml`
- some old modules/tests need cleanup or removal

## Architecture Direction

At a high level, the extension is moving toward this structure:

```text
CLI / TUI
  ├─ commands: /agent, /team, /list, /kill
  ├─ active-status / task-board UI
  ↓
Manager agent
  ├─ receives user tasks
  ├─ delegates to subagents
  ├─ answers or escalates questions
  └─ aggregates results
  ↓
Process manager
  ├─ spawns Pi subprocesses
  ├─ tracks status and lifetime
  └─ handles output, timeout, kill
  ↓
Session bridge
  ├─ stores pending questions/answers
  └─ unblocks waiting subagents
  ↓
Team + agent resolution
  ├─ teams.yaml
  ├─ leader prompt resolution
  └─ agent profile lookup
```

## Documentation Structure

This repo should be structured around a few clear planning documents:

- `README.md` / `readme.md` — vision, current capabilities, and architecture summary
- `ISSUE-DRAFT.md` — the full umbrella issue body for GitHub issue #12
- `ROADMAP.md` — milestone plan with checklists and acceptance criteria

## What happens next

The implementation should proceed in phases:

1. stabilize the current core
2. verify the complete manager/subagent loop
3. harden team and agent resolution
4. add visibility/dashboard support
5. add manager memory
6. add subagent feedback/progress updates
7. extract reusable orchestration primitives

See:

- `ISSUE-DRAFT.md` for the umbrella issue
- `ROADMAP.md` for the execution plan

## Usage

```bash
pi -e extensions/pi-agent/src/index.ts
```

## Session Files

Session state is stored under:

```text
~/.pi/pi-agent/sessions/
```

For testing, the session directory can be overridden with:

```text
PI_AGENT_SESSION_DIR
```
