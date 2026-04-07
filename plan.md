# Pi-Agent Extension Plan

## Overview

pi-agent enables team-based agent orchestration with subagent spawning, management, and communication bridges.

## Project Structure

```
pi-agent/
├── src/
│   ├── core/                    # MVP - Stable base
│   │   ├── index.ts           # Main entry point
│   │   ├── types.ts           # Shared TypeScript types
│   │   ├── teams/             # Team loading, YAML parsing
│   │   ├── spawn/             # Subagent spawning
│   │   └── bridge/            # Manager ↔ Subagent bridge
│   │
│   ├── features/               # Modular add-on features
│   │   ├── memory/            # [Future] Persistent project memory
│   │   ├── tasks/            # [Future] Task/Backlog management
│   │   ├── awareness/         # [Future] Team dashboard
│   │   └── proactive/        # [Future] Proactive suggestions
│   │
│   └── shared/                 # Utilities for all features
│       ├── paths.ts           # Path resolution
│       └── config.ts          # Configuration loading
│
├── teams/                       # Built-in Team Definitions
│   ├── teams.yaml
│   └── leaders/
│       └── team-leader.md
│
├── test/
└── package.json
```

## Core Features (MVP)

### Teams System
- [x] Load teams from YAML files
- [x] Support hierarchical YAML format
- [x] Multiple search paths (built-in → global → local)
- [x] Placeholder system: {TEAM_NAME}, {MEMBERS_LIST}, {MEMBER_NAMES}

### Team Search Paths (Priority: low → high)
1. Built-in: {extension}/teams/
2. Global: ~/.pi/teams/
3. Local: {project}/.pi/teams/

### Agent Search Paths (Priority: low → high)
1. Built-in leaders: {extension}/teams/leaders/
2. Global leaders: ~/.pi/teams/leaders/
3. Local leaders: {project}/.pi/teams/leaders/
4. Global agents: ~/.pi/agents/
5. Local agents: {project}/.pi/agents/

### Spawning
- [x] Spawn subagents with run_subagents tool
- [x] Support named agent profiles
- [x] Extract system prompts from .md files
- [x] Support nested agent paths

### Bridges
- [x] ask_manager_question - Subagent asks manager
- [x] answer_manager_question - Manager answers directly
- [x] get_pending_manager_questions - List pending questions
- [x] On-demand polling for session file changes

### Context Management
- [x] Context filtering
- [x] Team context injection on /team activation

### Commands
- [x] /agent <name> <task> - Spawn a subagent
- [x] /team <name> - Activate Team Mode
- [x] /list - List active subagents
- [x] /kill <session-id> - Kill a subagent

## Future Features

### Memory (Priority: High)
Persistent project memory across sessions.

| What real managers have | What we need |
|-------------------------|--------------|
| Persistent memory | Project context stored in files |
| Ownership of tasks | Task ownership in project memory |
| Team dashboard | Visual task board widget |
| Team awareness | Real-time subagent status dashboard |

### Tasks (Priority: High)
Task management with backlog and ownership.

- Task status: todo, in-progress, blocked, done
- Task assignment to team members
- Blocker detection

### Awareness (Priority: Medium)
Team dashboard showing what everyone is doing.

- Real-time widget showing active subagents
- Status indicators: running, waiting, complete, blocked
- Elapsed time tracking

### Proactive (Priority: Low)
Proactive suggestions based on context.

- Analyze code patterns
- Suggest refactoring opportunities
- Flag potential issues

## Communication Flows

### Flow A: User starts Subagent directly
User → Subagent (mode: user) → ask_user_question → User answers → Subagent continues

### Flow B: Manager starts Subagent
Manager → Subagent (mode: manager) → ask_manager_question → Manager decides:
- answer_manager_question → Subagent continues
- Forward to user → User answers → Subagent continues

## Roadmap

### Phase 1: Core (DONE)
- [x] Teams system with YAML loading
- [x] Placeholder system in prompts
- [x] Subagent spawning
- [x] Manager ↔ Subagent bridge
- [x] Basic commands
- [x] Context filtering

### Phase 2: Memory (Next)
- [ ] Project memory storage
- [ ] Session summary generation
- [ ] Context injection from past sessions

### Phase 3: Tasks
- [ ] Task creation and management
- [ ] Backlog visualization
- [ ] Task assignment

### Phase 4: Awareness
- [ ] Real-time team dashboard
- [ ] Active subagent status widget

### Phase 5: Proactive
- [ ] Context analysis
- [ ] Suggestion engine

## Design Principles

1. Modular - Each feature is self-contained in features/
2. Shared utilities - Common code in shared/
3. File-based - State persisted in filesystem
4. Extensible - Easy to add new features
5. No dependency bloat - Use existing extensions where possible

## References

- pi-subagents - Reference implementation
- pi-askuserquestion - User question widget
