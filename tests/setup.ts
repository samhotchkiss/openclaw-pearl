/**
 * Basic Test Setup - Global configuration for all tests
 */

import { vi } from 'vitest';

// Global fallback for external services that unit tests shouldn't call
if (!vi.isMockFunction(global.fetch)) {
  global.fetch = vi.fn().mockRejectedValue(new Error('Tests should not make real HTTP requests'));
}

// Suppress console logs in tests unless explicitly needed
console.log = vi.fn();
console.warn = vi.fn();
console.error = vi.fn();