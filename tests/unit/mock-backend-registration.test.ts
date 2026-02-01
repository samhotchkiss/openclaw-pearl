/**
 * Test Mock Backend Registration in Pearl
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Pearl } from '../../src/pearl.js';
import type { ChatRequest, PearlConfig } from '../../src/types.js';

/**
 * Create a minimal test config for Pearl instances
 */
function createTestConfig(): PearlConfig {
  return {
    server: { port: 8080, host: '0.0.0.0', cors: true },
    memory: { store: 'sqlite', path: ':memory:' },
    extraction: {
      enabled: false, // Disabled for simple backend test
      model: 'mock/test-model',
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
      minSimilarity: 0.5,
      tokenBudget: 500,
      recencyBoost: true,
    },
    routing: {
      classifier: 'mock/test-model',
      defaultModel: 'mock/test-model',
      rules: [{
        name: 'default',
        match: { default: true },
        model: 'mock/test-model',
        priority: 1,
      }],
    },
    backends: {
      mock: { enabled: true }, // Enable mock backend for testing
    },
    logging: { level: 'error', file: '/dev/null' },
  };
}

describe('Mock Backend Registration', () => {
  let pearl: Pearl;

  beforeEach(async () => {
    const config = createTestConfig();
    pearl = new Pearl(config);
    await pearl.initialize();
  });

  afterEach(async () => {
    if (pearl && pearl.isInitialized()) {
      await pearl.shutdown();
    }
  });

  it('should register mock backend when mock config is present', async () => {
    // The mock backend should be available for test models
    const request: ChatRequest = {
      model: 'mock/test-model',
      messages: [{ role: 'user', content: 'Hello test' }],
      metadata: {
        agentId: 'test-agent',
        sessionId: 'test-session',
      },
    };

    // This should not throw "No backend available" error
    const generator = pearl.chatCompletion(request);
    const firstChunk = await generator.next();
    
    expect(firstChunk.value).toBeDefined();
    expect(firstChunk.value.model).toBe('mock/test-model');
  });

  it('should handle test-model (without mock/ prefix) correctly', async () => {
    // The test-model should also be mapped to mock backend
    const request: ChatRequest = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello test' }],
      metadata: {
        agentId: 'test-agent',
        sessionId: 'test-session',
      },
    };

    // This should not throw "No backend available" error
    const generator = pearl.chatCompletion(request);
    const firstChunk = await generator.next();
    
    expect(firstChunk.value).toBeDefined();
    // The model should be routed to mock/test-model by the routing system
    expect(firstChunk.value.model).toBe('mock/test-model');
  });
});