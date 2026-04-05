// TUI Widgets for interactive-team

import type ExtensionAPI from '@mariozechner/pi-coding-agent';
import { Text, Box } from '@mariozechner/pi-tui';

interface SubagentStatus {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'waiting' | 'done' | 'error';
  lastQuestion?: string;
  elapsed: number;
}

// Active subagent widgets
const activeWidgets = new Map<string, SubagentStatus>();

export function updateSubagentStatus(
  sessionId: string,
  status: SubagentStatus
): void {
  activeWidgets.set(sessionId, status);
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
  // Register a footer/header widget showing active subagents
  api.onEvent('render', () => {
    const subagents = getActiveSubagents();
    if (subagents.length === 0) return;

    const cards = subagents.map(renderSubagentCard).join('  ');
    // This would render in the TUI - actual implementation depends on Pi's widget API
  });
}