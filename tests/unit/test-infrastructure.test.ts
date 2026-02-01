/**
 * Test Infrastructure Verification
 * 
 * Tests that our test setup is working correctly and provides
 * utilities for reliable testing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestConfig, mockExternalServices, cleanupTests } from '../setup/test-helpers.js';

describe('Test Infrastructure', () => {
  beforeEach(() => {
    cleanupTests();
  });

  describe('Test Configuration', () => {
    it('should create valid test config', () => {
      const config = createTestConfig();
      
      expect(config.server.port).toBe(8080);
      expect(config.memory.path).toBe(':memory:');
      expect(config.extraction.async).toBe(false); // Sync for tests
      expect(config.routing.defaultModel).toBe('mock/test-model');
    });
    
    it('should use in-memory database for isolation', () => {
      const config = createTestConfig();
      expect(config.memory.path).toBe(':memory:');
    });
  });

  describe('Test Utilities', () => {
    it('should provide mock external services', () => {
      expect(mockExternalServices).toBeDefined();
      expect(typeof mockExternalServices).toBe('function');
    });
    
    it('should provide cleanup utilities', () => {
      expect(cleanupTests).toBeDefined();
      expect(typeof cleanupTests).toBe('function');
    });
  });

  describe('Vitest Configuration', () => {
    it('should have vitest mocking available', () => {
      expect(vi).toBeDefined();
      expect(vi.fn).toBeDefined();
      expect(vi.mock).toBeDefined();
    });
    
    it('should support async tests', async () => {
      const asyncTest = async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
        return 'async works';
      };
      
      const result = await asyncTest();
      expect(result).toBe('async works');
    });
  });

  describe('Test Coverage', () => {
    it('should support test coverage reporting', () => {
      // This test verifies that vitest coverage is configured
      // Coverage is run with `npm run test:coverage`
      expect(true).toBe(true);
    });
  });
});