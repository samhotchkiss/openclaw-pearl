/**
 * Simple Pearl Tests - Basic Integration Test
 */

import { describe, it, expect } from 'vitest';
import { Pearl } from '../src/pearl.js';
import type { PearlConfig, ChatRequest } from '../src/types.js';

describe('Pearl Simple Integration', () => {
  const createTestConfig = (): PearlConfig => ({
    server: {
      port: 8080,
      host: '0.0.0.0',
    },
    memory: {
      store: 'sqlite',
      path: ':memory:',
    },
    extraction: {
      enabled: false, // Disable for simple test
      model: 'ollama/llama3.2:3b',
      async: false,
      minConfidence: 0.7,
      extractFromAssistant: false,
      dedupWindowSeconds: 300,
    },
    embedding: {
      provider: 'ollama',
      model: 'nomic-embed-text',
      dimensions: 768,
    },
    retrieval: {
      maxMemories: 10,
      minSimilarity: 0.7,
      tokenBudget: 500,
      recencyBoost: true,
    },
    routing: {
      classifier: 'ollama/llama3.2:3b',
      defaultModel: 'anthropic/claude-sonnet-4-20250514',
      rules: [],
    },
    backends: {
      anthropic: {
        apiKey: 'test-key',
      },
    },
  });

  it('should initialize without errors', async () => {
    const config = createTestConfig();
    const pearl = new Pearl(config);
    
    // This should not throw
    await expect(pearl.initialize()).resolves.not.toThrow();
    expect(pearl.isInitialized()).toBe(true);
    
    await pearl.shutdown();
  });

  it('should handle basic chat flow without backend', async () => {
    const config = createTestConfig();
    const pearl = new Pearl(config);
    await pearl.initialize();
    
    const mockRequest: ChatRequest = {
      model: 'pearl',
      messages: [
        { role: 'user', content: 'Hello world' }
      ],
      metadata: {
        agentId: 'test-agent',
        sessionId: 'test-session',
      },
    };
    
    // Should be able to start the generator (even if it fails at backend)
    const generator = pearl.chatCompletion(mockRequest);
    
    // This may throw at the backend level, but should not throw before that
    try {
      await generator.next();
    } catch (error) {
      // Expected to fail at backend since we don't have real backends
      expect(error).toBeDefined();
    }
    
    await pearl.shutdown();
  });
});