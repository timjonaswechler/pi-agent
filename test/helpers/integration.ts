import { spawnSync } from 'child_process';
import { describe } from 'vitest';

// Helpers for real pi subprocess integration tests.
// These tests are opt-in and only run when PI_INTEGRATION=1 and the pi CLI is available.

export function hasPiCli(): boolean {
  const result = spawnSync('pi', ['--help'], { encoding: 'utf-8' });
  return !result.error;
}

export async function waitFor<T>(fn: () => T | null | undefined, timeoutMs = 10000, intervalMs = 100): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}

export const describeIntegration = process.env.PI_INTEGRATION === '1' && hasPiCli()
  ? describe
  : describe.skip;
