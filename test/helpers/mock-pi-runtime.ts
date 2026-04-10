import { vi } from 'vitest';

// Reusable mock Pi test runtime for extension tests.
// This is a lightweight stand-in for Pi's real ExtensionAPI.
// Tests register the real extension into this object, then inspect
// commands/tools/handlers and trigger them directly.

type Handler = (...args: any[]) => any;

export function createMockPi() {
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const handlers = new Map<string, Handler[]>();
  const sentMessages: Array<{ message: any; options: any }> = [];
  const sentUserMessages: Array<{ message: any; options: any }> = [];
  let activeTools: string[] = [];

  const pi = {
    registerTool(def: any) {
      tools.set(def.name, def);
    },
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
    on(event: string, handler: Handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    },
    sendMessage(message: any, options?: any) {
      sentMessages.push({ message, options });
    },
    sendUserMessage(message: any, options?: any) {
      sentUserMessages.push({ message, options });
    },
    setActiveTools(toolsToSet: string[]) {
      activeTools = [...toolsToSet];
    },
    getActiveTools() {
      return [...activeTools];
    },
  };

  return {
    pi,
    tools,
    commands,
    handlers,
    sentMessages,
    sentUserMessages,
    getTool(name: string) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool ${name} not registered`);
      return tool;
    },
    getCommand(name: string) {
      const command = commands.get(name);
      if (!command) throw new Error(`Command ${name} not registered`);
      return command;
    },
    getHandlers(event: string) {
      return handlers.get(event) ?? [];
    },
    async emit(event: string, ...args: any[]) {
      const results = [];
      for (const handler of handlers.get(event) ?? []) {
        results.push(await handler(...args));
      }
      return results;
    },
    getActiveTools() {
      return [...activeTools];
    },
  };
}

// Reusable mock extension context for commands, tools, and event handlers.
// Only includes the UI/context surface currently used by pi-agent tests.
export function createMockCtx(overrides: Record<string, any> = {}) {
  const notifications: Array<{ message: string; level: string }> = [];
  const statuses: Array<{ key: string; value: string | undefined }> = [];
  const inputs: Array<{ prompt: string; placeholder?: string }> = [];

  const ctx = {
    hasUI: true,
    cwd: '/tmp',
    ui: {
      notify: vi.fn((message: string, level: string) => {
        notifications.push({ message, level });
      }),
      setStatus: vi.fn((key: string, value: string | undefined) => {
        statuses.push({ key, value });
      }),
      input: vi.fn(async (prompt: string, placeholder?: string) => {
        inputs.push({ prompt, placeholder });
        return 'mocked input';
      }),
      custom: vi.fn(async () => null),
    },
    notifications,
    statuses,
    inputs,
    ...overrides,
  };

  return ctx;
}
