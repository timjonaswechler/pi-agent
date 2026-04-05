// TUI Widgets for pi-agent

import type ExtensionAPI from '@mariozechner/pi-coding-agent';
import { Text, Box, Container } from '@mariozechner/pi-tui';

interface SubagentStatus {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'waiting' | 'done' | 'error';
  lastQuestion?: string;
  elapsed: number;
}

// Active subagent widgets
const activeWidgets = new Map<string, SubagentStatus>();

let extensionApi: ExtensionAPI | null = null;

export function updateSubagentStatus(sessionId: string, status: SubagentStatus): void {
  activeWidgets.set(sessionId, status);
  
  // If widget is registered, trigger a render update
  if (extensionApi) {
    extensionApi.emit('widget:update', { sessionId, status });
  }
}

export function removeSubagentWidget(sessionId: string): void {
  activeWidgets.delete(sessionId);
}

export function getActiveSubagents(): SubagentStatus[] {
  return Array.from(activeWidgets.values());
}

export function renderSubagentCard(status: SubagentStatus): string {
  const statusColor = {
    idle: '\x1b[90m',
    running: '\x1b[32m', // green
    waiting: '\x1b[33m', // yellow
    done: '\x1b[36m', // cyan
    error: '\x1b[31m', // red
  }[status.status];

  const elapsed = formatElapsed(status.elapsed);
  const lastQ = status.lastQuestion ? truncate(status.lastQuestion, 40) : '';

  return `${statusColor}●${status.name}\x1b[0m ${elapsed}${lastQ ? ` | ${lastQ}` : ''}`;
}

export function renderPollingStatus(): string {
  const active = getActiveSubagents();
  if (active.length === 0) return '';

  const cards = active.map(renderSubagentCard).join('  ');
  return `\n🔄 Polling ${active.length} subagent(s): ${cards}\n`;
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}

export function registerWidget(api: ExtensionAPI): void {
  extensionApi = api;

  // Register handler for widget update events
  api.onEvent('widget:update', () => {
    // Trigger UI update
  });

  // Show startup notification
  api.onEvent('session_start', async (_event, ctx) => {
    if (ctx?.hasUI) {
      ctx.ui.notify('pi-agent extension loaded', 'info');
    }
  });
}