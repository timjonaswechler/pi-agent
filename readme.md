# pi-agent

`pi-agent` is a Pi extension for **multi-agent orchestration**.

It lets a developer delegate work to either a **single team member** or a **team of agents** inside Pi, while staying in control of the session and only stepping in when clarification or approval is needed.

## Vision

The long-term goal is to make Pi feel less like a single assistant and more like a small engineering team.

A user should be able to:

- ask one specialist team member to handle a focused task
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

- subagent spawning
- team mode activation
- parent ↔ subagent coordination
- human escalation when necessary
- active session tracking
- a path toward dashboards, memory, and reusable orchestration primitives

## Current Capabilities

The project now has a real working foundation.

### Commands

- `/agent` — open team member selection and arm the next message as the task
- `/agent <name>` — arm that team member for the next message
- `/agent <name> <task...>` — spawn immediately
- `/agent cancel` — cancel pending delegation
- `/team <name>` — activate a team manager for the current session
- `/list` — list active subagents
- `/kill <session-id>` — kill a running subagent

### Tools

- `run_subagents` — manager spawns multiple subagents in parallel
- `ask_manager_question` — subagent asks the parent orchestration session a blocking question
- `get_pending_questions` — manager/parent lists unanswered subagent questions
- `answer_manager_question` — manager answers a pending subagent question
- `ask_user_question` — manager escalates a question to the human when needed

## Current Communication Model

There are two main modes:

### 1. User → Solo subagent
The user directly spawns a single team member.

```text
User ──/agent──→ Subagent
                   ↓
         ask parent orchestration session
                   ↓
          parent asks user if needed
                   ↓
              returns result
```

### 2. User → Manager → Team subagents
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

## Clarification Behavior

pi-agent currently supports one clear clarification model.

### Solo path (`/agent`)
- A spawned solo subagent does **not** ask the end user directly in json/background subprocess mode.
- If it is blocked, it uses `ask_manager_question`.
- In an interactive parent session, pi-agent surfaces that question to the user, collects the answer, and forwards it back to the subagent.

### Team path (`/team`)
- Team subagents do **not** talk to the user directly.
- If a team subagent is blocked, it uses `ask_manager_question`.
- pi-agent surfaces that blocked question to the active manager in the main session.
- The manager can then either:
  - answer directly with `answer_manager_question`, or
  - escalate to the user with `ask_user_question`, then forward the resolved answer with `answer_manager_question`.

### Tool roles
- `ask_manager_question` = subagent → manager
- `answer_manager_question` = manager → subagent
- `ask_user_question` = manager/interactive parent session → user

### Practical rule
- In solo mode, the parent session handles user clarification directly.
- In team mode, only the manager should ask the user questions.
- Specialist/team subagents should always escalate through the manager instead of opening a direct user conversation.

## Current State

### Working / recently fixed

- `/team` injects hidden team context for the next turn without triggering an immediate answer
- `/agent` supports pending next-message delegation and `/agent cancel`
- `/list` works for active sessions
- YAML loading now uses `js-yaml`
- dead bridge/member/leader code has been removed
- spawned child sessions now parse agent frontmatter `tools`
- required orchestration tools are merged into the effective child toolset
- child sessions enforce active tools via `setActiveTools(...)`
- member profiles are resolved from `teams/members`
- automatic solo-subagent question piping exists in the parent session
- a deterministic clarification test agent exists for M2 verification

### Still in progress / not fully verified

- manager-side handling for `team` subagent questions
- broader real-world consistency of clarification behavior for non-test agents
- final output extraction confidence across more scenarios
- multi-subagent aggregation confidence
- `/kill` needs slower/manual verification to test comfortably

### Follow-up UX work

- solo clarification currently uses a plain input prompt in the parent session
- a better `ask_user_question`-style UX for solo-subagent clarification is planned later
- this is tracked separately in issue #13

## Team Member and Team Paths

### Team definitions
- built-in: `teams/teams.yaml`
- global: `~/.pi/teams/teams.yaml`
- local: `.pi/teams/teams.yaml`

### Team leaders
- built-in: `teams/leaders/`
- global: `~/.pi/teams/leaders/`
- local: `.pi/teams/leaders/`

### Team members
- built-in: `teams/members/`
- global: `~/.pi/teams/members/`
- local: `.pi/teams/members/`

## Architecture Direction

At a high level, the extension is moving toward this structure:

```text
CLI / TUI
  ├─ commands: /agent, /team, /list, /kill
  ├─ active-status / task-board UI
  ↓
Parent / manager session
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
Team + member resolution
  ├─ teams.yaml
  ├─ leader prompt resolution
  └─ member profile lookup
```

## Documentation Structure

This repo is structured around a few clear planning documents:

- `README.md` / `readme.md` — vision, current capabilities, and architecture summary
- `ISSUE-DRAFT.md` — the full umbrella issue body for GitHub issue #12
- `ROADMAP.md` — milestone plan with checklists and acceptance criteria

## What happens next

The implementation should proceed in phases:

1. stabilize the current core
2. verify the complete manager/subagent loop
3. harden team and member resolution
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
