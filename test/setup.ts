// Test setup - runs before all tests
// Must set env BEFORE importing any modules

process.env.PI_AGENT_SESSION_DIR = '/tmp/pi-agent-test-sessions';

import { beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const TEST_SESSION_DIR = process.env.PI_AGENT_SESSION_DIR;

// Cleanup before all tests
beforeEach(() => {
  if (!fs.existsSync(TEST_SESSION_DIR)) {
    fs.mkdirSync(TEST_SESSION_DIR, { recursive: true });
  }
  // Clear any existing test files
  const files = fs.readdirSync(TEST_SESSION_DIR);
  for (const file of files) {
    fs.unlinkSync(path.join(TEST_SESSION_DIR, file));
  }
});

afterEach(() => {
  // Cleanup after each test
  if (fs.existsSync(TEST_SESSION_DIR)) {
    const files = fs.readdirSync(TEST_SESSION_DIR);
    for (const file of files) {
      fs.unlinkSync(path.join(TEST_SESSION_DIR, file));
    }
  }
});