# Mock Pi test runtime

These helpers provide a small reusable fake Pi runtime for extension tests.

Files:
- `mock-pi-runtime.ts`

## What this means

Instead of running the real Pi app in tests, we register the real extension into a mock runtime object and call the registered handlers directly.

This keeps tests fast and deterministic while still exercising real extension wiring.

## Main helpers

### `createMockPi()`
A mock Pi test runtime that imitates the parts of the `ExtensionAPI` used by `pi-agent`.

It supports:
- `registerTool(...)`
- `registerCommand(...)`
- `on(...)`
- `sendMessage(...)`
- `sendUserMessage(...)`
- `setActiveTools(...)`
- `getActiveTools(...)`

It also records what happened so tests can inspect:
- registered tools
- registered commands
- registered event handlers
- sent messages

Convenience helpers:
- `getTool(name)`
- `getCommand(name)`
- `getHandlers(event)`
- `emit(event, ...)`

### `createMockCtx()`
A mock extension context used when invoking commands, tools, and event handlers.

It currently includes:
- `hasUI`
- `cwd`
- `ui.notify(...)`
- `ui.setStatus(...)`
- `ui.input(...)`
- `ui.custom(...)`

It also records UI interactions for assertions.

## Typical pattern

```ts
const mock = createMockPi();
const ctx = createMockCtx();

registerExtension(mock.pi as any);

const command = mock.getCommand('team');
await command.handler('', ctx);

expect(mock.sentMessages).toHaveLength(1);
```

## Why this exists

This follows the same lightweight test style used in other Pi extension repos:
- register the real extension
- use a mock runtime instead of a full app session
- trigger handlers directly
- assert on recorded side effects
