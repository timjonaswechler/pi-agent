# Pi Agent Extension

Extension für Pi, die Agent-Spawning und Team-Orchestrierung mit interaktivem Bridge-System ermöglicht.

## Features

- **Agent Spawning**: Manuelles Starten von spezialisierten Subagents
- **Scenario 1**: User ↔ Subagent (direkte Kommunikation)
- **Scenario 2**: Manager ↔ Subagent (Manager als zentraler Ansprechpartner)
- **Session-basierte Kommunikation** — Main Pi Context bleibt sauber
- **TUI Widgets** für Status-Anzeige

## Architektur

```
pi-agent/
├── index.ts              # Main entry point
├── types.ts              # Type definitions
├── session.ts            # Session file read/write
├── spawn.ts              # Subagent spawning
├── user-bridge.ts        # User ↔ Subagent bridge
├── manager-bridge.ts     # Manager ↔ Subagent bridge
├── widget.ts             # TUI widgets
├── commands.ts           # Slash commands
└── ask-manager.ts        # ask_manager_question implementation
```

## Kommunikations-Flow

### Scenario 1: User → Subagent (direkt)

```
User spawnt Subagent
    ↓
ask_user_question → Widget → User antwortet
    ↓
Antwort in Subagent Session File
    ↓
Subagent macht weiter
```

### Scenario 2: Manager → Subagent

```
Manager spawnt Subagent
    ↓
Subagent braucht Hilfe → ask_manager_question
    ↓
Anfrage in Subagent Session File
    ↓
Manager liest → ANTWORTET selbst
    ↓
Antwort in Session File
    ↓
Subagent macht weiter
```

→ Manager bleibt zentraler Ansprechpartner — Subagent fragt nie direkt User wenn Manager aktiv

## TODOs

- [ ] Session file polling für pending questions
- [ ] Widget für aktive Subagent-Fragen
- [ ] Manager auto-answer routing
- [ ] Session file JSON structure definieren
- [ ] Subagent detect new answers