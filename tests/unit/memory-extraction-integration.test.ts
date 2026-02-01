/**
 * Memory Extraction Integration Tests
 * 
 * Tests that memory extraction actually calls Ollama and extracts memories,
 * not just logs "Would call" like the current stub implementation.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MemoryExtractor, type LLMProviderConfig, OllamaProvider } from '../../src/memory/extractor.js';
import { createTestConfig } from '../setup/test-helpers.js';

describe('Memory Extraction Integration', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    // Mock fetch for Ollama API calls
    originalFetch = global.fetch;
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('DefaultLLMProvider Issue', () => {
    it('FAILING: should actually call Ollama instead of just logging', async () => {
      // This test demonstrates the current bug
      const config: LLMProviderConfig = {
        provider: 'ollama',
        model: 'llama3.2:3b',
        baseUrl: 'http://localhost:11434',
        minConfidence: 0.7,
      };

      // Mock successful Ollama response
      const mockResponse = {
        response: JSON.stringify({
          memories: [{
            type: 'preference',
            content: 'User prefers morning meetings',
            tags: ['meetings', 'time'],
            confidence: 0.9
          }]
        })
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const extractor = new MemoryExtractor(config);
      const result = await extractor.extract('I prefer morning meetings');

      // This should pass when the bug is fixed
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/generate',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('llama3.2:3b'),
        })
      );

      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].content).toBe('User prefers morning meetings');
    });
  });

  describe('OllamaProvider Direct Usage', () => {
    it('should work when OllamaProvider is used directly', async () => {
      const mockResponse = {
        response: JSON.stringify({
          memories: [{
            type: 'fact',
            content: 'User lives in Denver',
            tags: ['location'],
            confidence: 0.8
          }]
        })
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const provider = new OllamaProvider('http://localhost:11434', 'llama3.2:3b');
      const result = await provider.extract('I live in Denver');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/generate',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('llama3.2:3b'),
        })
      );

      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].content).toBe('User lives in Denver');
    });
  });

  describe('Memory Classification Tests', () => {
    it('should extract facts from user statements', async () => {
      const mockResponse = {
        response: JSON.stringify({
          memories: [{
            type: 'fact',
            content: 'User is allergic to peanuts',
            tags: ['health', 'allergy'],
            confidence: 0.95
          }]
        })
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const config: LLMProviderConfig = {
        provider: 'ollama',
        model: 'llama3.2:3b',
        baseUrl: 'http://localhost:11434',
      };

      const extractor = new MemoryExtractor(config);
      const result = await extractor.extract('I am allergic to peanuts');

      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].type).toBe('fact');
      expect(result.memories[0].tags).toContain('health');
    });

    it('should extract preferences', async () => {
      const mockResponse = {
        response: JSON.stringify({
          memories: [{
            type: 'preference',
            content: 'User hates long emails and prefers brief communication',
            tags: ['communication', 'style'],
            confidence: 0.85
          }]
        })
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const config: LLMProviderConfig = {
        provider: 'ollama',
        model: 'llama3.2:3b',
        baseUrl: 'http://localhost:11434',
      };

      const extractor = new MemoryExtractor(config);
      const result = await extractor.extract('I hate long emails, keep it brief');

      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].type).toBe('preference');
    });

    it('should skip trivial messages', async () => {
      const config: LLMProviderConfig = {
        provider: 'ollama',
        model: 'llama3.2:3b',
        baseUrl: 'http://localhost:11434',
      };

      const extractor = new MemoryExtractor(config);
      
      // Test trivial messages that shouldn't call the API
      const trivialMessages = ['ok', 'thanks', 'hi', 'yes', 'cool'];
      
      for (const message of trivialMessages) {
        const result = await extractor.extract(message);
        expect(result.memories).toHaveLength(0);
      }

      // Fetch should not have been called for trivial messages
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle Ollama API errors gracefully', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
      });

      const config: LLMProviderConfig = {
        provider: 'ollama',
        model: 'llama3.2:3b',
        baseUrl: 'http://localhost:11434',
      };

      const extractor = new MemoryExtractor(config);
      const result = await extractor.extract('This will fail');

      expect(result.memories).toHaveLength(0);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Ollama API error: 500');
    });

    it('should handle invalid JSON responses', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ response: 'invalid json' }),
      });

      const config: LLMProviderConfig = {
        provider: 'ollama',
        model: 'llama3.2:3b',
        baseUrl: 'http://localhost:11434',
      };

      const extractor = new MemoryExtractor(config);
      const result = await extractor.extract('Test message');

      expect(result.memories).toHaveLength(0);
      expect(result.error).toBeDefined();
    });
  });
});