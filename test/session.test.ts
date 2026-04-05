import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as session from '../session';

// Test session directory (set in setup.ts)
const TEST_SESSION_DIR = '/tmp/pi-agent-test-sessions';

describe('Session Management', () => {
  describe('createSession', () => {
    it('creates a new session with correct structure', () => {
      const state = session.createSession('test-agent');
      
      expect(state.sessionId).toBeDefined();
      expect(state.sessionId).toMatch(/^subagent-/);
      expect(state.subagentId).toBe('test-agent');
      expect(state.status).toBe('idle');
      expect(state.pendingQuestions).toEqual([]);
      expect(state.lastActivity).toBeDefined();
    });

    it('creates unique session IDs', () => {
      const state1 = session.createSession('agent');
      const state2 = session.createSession('agent');
      
      expect(state1.sessionId).not.toBe(state2.sessionId);
    });
  });

  describe('readSession / writeSession', () => {
    it('persists and reads session correctly', () => {
      const state = session.createSession('test-agent');
      const filePath = path.join(TEST_SESSION_DIR, `${state.sessionId}.json`);
      
      // Session file should exist
      expect(fs.existsSync(filePath)).toBe(true);
      
      // Read should return same data
      const readState = session.readSession(state.sessionId);
      expect(readState).not.toBeNull();
      expect(readState?.subagentId).toBe('test-agent');
      expect(readState?.status).toBe('idle');
    });
  });

  describe('addQuestion', () => {
    it('adds a question to session', () => {
      const state = session.createSession('test-agent');
      
      session.addQuestion(state.sessionId, {
        id: 'q-1',
        type: 'manager',
        question: 'What should I do next?',
        timestamp: Date.now(),
      });
      
      const updated = session.readSession(state.sessionId);
      expect(updated?.pendingQuestions).toHaveLength(1);
      expect(updated?.pendingQuestions[0].question).toBe('What should I do next?');
    });

    it('sets status to waiting_manager for manager questions', () => {
      const state = session.createSession('test-agent');
      
      session.addQuestion(state.sessionId, {
        id: 'q-1',
        type: 'manager',
        question: 'Help?',
        timestamp: Date.now(),
      });
      
      const updated = session.readSession(state.sessionId);
      expect(updated?.status).toBe('waiting_manager');
    });

    it('sets status to waiting_user for user questions', () => {
      const state = session.createSession('test-agent');
      
      session.addQuestion(state.sessionId, {
        id: 'q-1',
        type: 'user',
        question: 'Confirm?',
        timestamp: Date.now(),
      });
      
      const updated = session.readSession(state.sessionId);
      expect(updated?.status).toBe('waiting_user');
    });
  });

  describe('answerQuestion', () => {
    it('adds answer to question', () => {
      const state = session.createSession('test-agent');
      
      session.addQuestion(state.sessionId, {
        id: 'q-1',
        type: 'manager',
        question: 'Help?',
        timestamp: Date.now(),
      });
      
      session.answerQuestion(state.sessionId, 'q-1', 'Do this');
      
      const updated = session.readSession(state.sessionId);
      expect(updated?.pendingQuestions[0].answer).toBe('Do this');
      expect(updated?.pendingQuestions[0].answeredAt).toBeDefined();
    });

    it('resets status when all questions answered', () => {
      const state = session.createSession('test-agent');
      
      session.addQuestion(state.sessionId, {
        id: 'q-1',
        type: 'manager',
        question: 'Help?',
        timestamp: Date.now(),
      });
      
      expect(session.readSession(state.sessionId)?.status).toBe('waiting_manager');
      
      session.answerQuestion(state.sessionId, 'q-1', 'Answer');
      
      const updated = session.readSession(state.sessionId);
      expect(updated?.status).toBe('running');
    });
  });

  describe('getPendingQuestions', () => {
    it('returns only unanswered questions', () => {
      const state = session.createSession('test-agent');
      
      session.addQuestion(state.sessionId, {
        id: 'q-1',
        type: 'manager',
        question: 'Q1?',
        timestamp: Date.now(),
      });
      
      session.addQuestion(state.sessionId, {
        id: 'q-2',
        type: 'manager',
        question: 'Q2?',
        timestamp: Date.now(),
      });
      
      session.answerQuestion(state.sessionId, 'q-1', 'A1');
      
      const pending = session.getPendingQuestions(state.sessionId);
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('q-2');
    });
  });
});

describe('Polling', () => {
  it('starts polling when question is added', () => {
    const state = session.createSession('test-agent');
    
    session.addQuestion(state.sessionId, {
      id: 'q-1',
      type: 'manager',
      question: 'Test?',
      timestamp: Date.now(),
    });
    
    expect(session.isPolling(state.sessionId)).toBe(true);
  });

  it('stops polling when all questions answered', () => {
    const state = session.createSession('test-agent');
    
    session.addQuestion(state.sessionId, {
      id: 'q-1',
      type: 'manager',
      question: 'Test?',
      timestamp: Date.now(),
    });
    
    expect(session.isPolling(state.sessionId)).toBe(true);
    
    session.answerQuestion(state.sessionId, 'q-1', 'Answer');
    
    // Give it a moment
    expect(session.isPolling(state.sessionId)).toBe(false);
  });
});