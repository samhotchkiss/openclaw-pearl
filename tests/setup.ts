/**
 * Basic Test Setup - Global configuration for all tests
 */

import { vi } from 'vitest';

// Global fallback for external services that unit tests shouldn't call
// Allow localhost/test requests, block external APIs
if (!vi.isMockFunction(global.fetch)) {
  const originalFetch = globalThis.fetch;
  global.fetch = vi.fn().mockImplementation((input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    
    // Allow localhost and 127.0.0.1 requests (test servers)
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      return originalFetch(input, init);
    }
    
    // Block external requests
    return Promise.reject(new Error(`Tests should not make external HTTP requests to: ${url}`));
  });
}

// Suppress console logs in tests unless explicitly needed
console.log = vi.fn();
console.warn = vi.fn();
console.error = vi.fn();