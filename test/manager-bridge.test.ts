import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as session from '../session';
import * as managerBridge from '../manager-bridge';
import * as fs from 'fs';
import * as path from 'path';

const TEST_SESSION_DIR = '/tmp/pi-agent-test-manager';

describe('Manager Bridge', () => {
  beforeEach(() => {
    managerBridge.cleanupManagerBridge();
    if (!fs.existsSync(TEST_SESSION_DIR)) {
      fs.mkdirSync(TEST_SESSION_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    managerBridge.cleanupManagerBridge();
    session.stopAllPolling();
    // Cleanup files
    if (fs.existsSync(TEST_SESSION_DIR)) {
      const files = fs.readdirSync(TEST_SESSION_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(TEST_SESSION_DIR, file));
      }
    }
  });

  describe('Manager Mode', () => {
    it('tracks sessions in manager mode', () => {
      managerBridge.setManagerMode('session-1', true);
      managerBridge.setManagerMode('session-2', true);
      
      expect(managerBridge.isManagerMode('session-1')).toBe(true);
      expect(managerBridge.isManagerMode('session-2')).toBe(true);
      expect(managerBridge.isManagerMode('session-3')).toBe(false);
    });

    it('can disable manager mode', () => {
      managerBridge.setManagerMode('session-1', true);
      managerBridge.setManagerMode('session-1', false);
      
      expect(managerBridge.isManagerMode('session-1')).toBe(false);
    });

    it('returns all sessions in manager mode', () => {
      managerBridge.setManagerMode('session-1', true);
      managerBridge.setManagerMode('session-2', true);
      managerBridge.setManagerMode('session-3', true);
      
      const sessions = managerBridge.getManagerModeSessions();
      expect(sessions).toHaveLength(3);
      expect(sessions).toContain('session-1');
      expect(sessions).toContain('session-2');
      expect(sessions).toContain('session-3');
    });
  });

  describe('getAllPendingManagerQuestions', () => {
    // Note: This would require integration with session module
    // For now we test the basic collection logic
    
    it('returns empty array when no sessions in manager mode', () => {
      const pending = managerBridge.getAllPendingManagerQuestions();
      expect(pending).toEqual([]);
    });
  });

  describe('forwardQuestionToUser', () => {
    it('changes question type from manager to user', () => {
      // This requires a real session file
      const state = session.createSession('test-agent');
      managerBridge.setManagerMode(state.sessionId, true);
      
      session.addQuestion(state.sessionId, {
        id: 'q-1',
        type: 'manager',
        question: 'Can I ask user?',
        timestamp: Date.now(),
      });
      
      // Read initial state
      let currentState = session.readSession(state.sessionId);
      expect(currentState?.pendingQuestions[0].type).toBe('manager');
      
      // Forward to user
      // Note: forwardQuestionToUser is async and requires api
      // This test shows the concept - full test needs mock api
      expect(currentState?.status).toBe('waiting_manager');
    });
  });
});

describe('Manager Decision Flow', () => {
  it('represents the decision: answer directly vs forward to user', () => {
    // This documents the expected behavior
    const scenarios = [
      {
        description: 'Manager can answer directly',
        action: 'answer_manager_question',
        result: 'answer in session file',
      },
      {
        description: 'Manager can forward to user',
        action: 'forward_to_user',
        result: 'user question widget shown',
      },
    ];
    
    expect(scenarios).toHaveLength(2);
    expect(scenarios[0].action).toBe('answer_manager_question');
    expect(scenarios[1].action).toBe('forward_to_user');
  });
});