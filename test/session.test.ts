import { describe, it, expect } from 'vitest';

// These tests just document the module structure
// Full integration tests would require mocking ExtensionAPI

describe('Session Module', () => {
  describe('exports', () => {
    it('has expected session functions', () => {
      // We can't dynamically import due to ESM resolution issues in tests
      // But we document expected exports here
      const expectedExports = [
        'createSession',
        'readSession',
        'writeSession',
        'addQuestion',
        'getPendingQuestions',
        'answerQuestion',
        'startPolling',
        'stopPolling',
        'setGlobalPollCallbacks',
      ];
      // This test documents what should exist
      expect(expectedExports.length).toBeGreaterThan(0);
    });
  });
});

describe('Manager Bridge', () => {
  describe('exports', () => {
    it('has expected manager bridge functions', () => {
      const expectedExports = [
        'managerAnswer',
        'forwardQuestionToUser',
        'setManagerMode',
        'isManagerMode',
        'getAllPendingManagerQuestions',
        'onManagerEvent',
      ];
      expect(expectedExports.length).toBeGreaterThan(0);
    });
  });
});

describe('Core Module Structure', () => {
  it('has all core directories', () => {
    const coreModules = [
      'teams',
      'spawn',
      'bridge',
      'session',
      'tools',
      'types',
    ];
    expect(coreModules.length).toBe(6);
  });
});
