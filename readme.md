# Pi Agent

Unified subagent orchestration for Pi.

## Features

- **Commands**: `/agent`, `/team`, `/list`, `/kill`
- **Tools**: `run_subagents`, `ask_manager_question`, `answer_manager_question`, `ask_user_question`, `get_pending_manager_questions`
- **Bridge**: Uses existing `ask_user_question` extension for user interaction

## Architecture

```
src/
├── index.ts              # Main entry
├── types.ts              # Unified types
├── session/index.ts      # Session management + on-demand polling
├── spawn/index.ts        # Subagent spawning
├── bridge/
│   └── manager.ts        # Manager ↔ Subagent bridge
├── commands/index.ts     # Slash commands
└── tools/index.ts        # Tools
```

## Communication Flows

### Flow A: User starts Subagent directly

```
User ──spawns──→ Subagent (mode: user)
                 ↓
        Subagent calls ask_user_question
                 ↓
        ask_user_question extension shows widget
                 ↓
              User answers
                 ↓
        Answer in Session File
                 ↓
        Subagent polling → continues
```

### Flow B: Manager starts Subagent

```
Manager ──spawns──→ Subagent (mode: manager)
                      ↓
              Subagent calls ask_manager_question
                      ↓
              Question in Session File
                      ↓
              Manager sees via get_pending_manager_questions
                      ↓
         ┌────────────────┴────────────────┐
         ↓                                 ↓
   Manager CAN answer              Manager needs user input
         ↓                                 ↓
   answer_manager_question        Manager calls ask_user_question
         ↓                                 ↓
   Answer in Session File          User answers
         ↓                                 ↓
   Subagent polling               Manager writes to Session File
         ↓                                 ↓
      continues                          ↓
                                    Subagent polling → continues
```

## Key Rules

| Situation | Who calls ask_user_question? |
|-----------|-------------------------------|
| User starts Subagent | **Subagent directly** |
| Manager starts Subagent, Manager decides user input needed | **Manager** (not Subagent!) |
| Manager starts Subagent, Manager can answer | **Manager** uses `answer_manager_question` |

## Usage

```bash
pi -e extensions/pi-agent/src/index.ts
```

## Commands

- `/agent <name> <task>` - Spawn a sub-agent
- `/team <name>` - Activate Team Mode
- `/list` - Show active sub-agents
- `/kill <session-id>` - Kill a sub-agent

## Tools

- `run_subagents` - Run multiple tasks in parallel
- `ask_manager_question` - Subagent asks manager
- `answer_manager_question` - Manager answers
- `ask_user_question` - Manager asks user (when forwarding)
- `get_pending_manager_questions` - List pending questions

## Session Files

Session state stored in: `~/.pi/pi-agent/sessions/`

Environment variable: `PI_AGENT_SESSION_DIR` for testing