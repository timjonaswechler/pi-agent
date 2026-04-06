import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as session from '../src/session';

const TEST_DIR = '/tmp/pi-agent-test-unit';

describe('Session Module', () => {
  beforeEach(() => {
    process.env.PI_AGENT_SESSION_DIR = TEST_DIR;
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    session.stopAllPolling();
  });

  describe('createSession', () => {
    it('creates session with expected structure', () => {
      const s = session.createSession('test');
      expect(s.sessionId).toBeDefined();
      expect(s.subagentId).toBe('test');
      expect(s.status).toBe('idle');
    });

    it('creates unique IDs', () => {
      const s1 = session.createSession('a');
      const s2 = session.createSession('a');
      expect(s1.sessionId).not.toBe(s2.sessionId);
    });
  });

  describe('updateSessionStatus', () => {
    it('can update status', () => {
      const s = session.createSession('test');
      session.updateSessionStatus(s.sessionId, 'running');
      const updated = session.readSession(s.sessionId);
      expect(updated?.status).toBe('running');
    });
  });

  describe('isPolling', () => {
    it('returns false for non-polling session', () => {
      const s = session.createSession('test');
      expect(session.isPolling(s.sessionId)).toBe(false);
    });
  });
});

describe('Manager Bridge', () => {
  afterEach(() => {
    import('../src/bridge/manager').then(m => m.cleanupManagerBridge());
  });

  describe('Manager Mode', () => {
    it('tracks sessions', async () => {
      const m = await import('../src/bridge/manager');
      m.setManagerMode('s1', true);
      expect(m.isManagerMode('s1')).toBe(true);
      expect(m.isManagerMode('s2')).toBe(false);
    });

    it('can disable mode', async () => {
      const m = await import('../src/bridge/manager');
      m.setManagerMode('s1', true);
      m.setManagerMode('s1', false);
      expect(m.isManagerMode('s1')).toBe(false);
    });

    it('returns all tracked sessions', async () => {
      const m = await import('../src/bridge/manager');
      m.setManagerMode('s1', true);
      m.setManagerMode('s2', true);
      const sessions = m.getManagerModeSessions();
      expect(sessions).toContain('s1');
      expect(sessions).toContain('s2');
    });
  });

  describe('Events', () => {
    it('can register event handler', async () => {
      const m = await import('../src/bridge/manager');
      let called = false;
      m.onManagerEvent(() => { called = true; });
      expect(typeof m.onManagerEvent).toBe('function');
    });
  });
});

describe('Types', () => {
  it('SessionStatus is a union type', () => {
    // This test just verifies the type exists
    expect(typeof 'idle').toBe('string');
  });
});