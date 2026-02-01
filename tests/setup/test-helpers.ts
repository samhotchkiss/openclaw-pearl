/**
 * Test Helpers for Pearl Test Suite
 */

import { vi } from 'vitest';
import type { PearlConfig } from '../../src/types.js';
import type { BackendClient, ChatRequest, ChatChunk, Model } from '../../src/backends/types.js';

/**
 * Mock backend implementation for testing
 */
export class MockBackend implements BackendClient {
  async* chat(request: ChatRequest): AsyncGenerator<ChatChunk> {
    const messageId = 'test-' + Date.now();
    const timestamp = Math.floor(Date.now() / 1000);
    
    // First chunk with role
    yield {
      id: messageId,
      object: 'chat.completion.chunk',
      created: timestamp,
      model: request.model,
      choices: [{
        index: 0,
        delta: { role: 'assistant' },
        finishReason: null,
      }],
    };

    // Content chunk
    yield {
      id: messageId,
      object: 'chat.completion.chunk',
      created: timestamp,
      model: request.model,
      choices: [{
        index: 0,
        delta: { content: 'This is a mock response for testing' },
        finishReason: null,
      }],
    };

    // Final chunk
    yield {
      id: messageId,
      object: 'chat.completion.chunk',
      created: timestamp,
      model: request.model,
      choices: [{
        index: 0,
        delta: {},
        finishReason: 'stop',
      }],
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
    };
  }

  async models(): Promise<Model[]> {
    return [
      {
        id: 'mock/test-model',
        object: 'model',
        created: Date.now(),
        ownedBy: 'mock',
      },
      {
        id: 'pearl',
        object: 'model',
        created: Date.now(),
        ownedBy: 'pearl',
      },
    ];
  }

  async health(): Promise<boolean> {
    return true;
  }
}

/**
 * Create a minimal test config for Pearl instances
 */
export function createTestConfig(): PearlConfig {
  return {
    server: { port: 8080, host: '0.0.0.0', cors: true },
    memory: { store: 'sqlite', path: ':memory:' },
    extraction: {
      enabled: true,
      model: 'ollama/llama3.2:1b',
      async: false, // Sync for testing
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
      classifier: 'ollama/llama3.2:1b',
      defaultModel: 'mock/test-model',
      rules: [{
        name: 'default',
        match: { default: true },
        model: 'mock/test-model',
        priority: 1,
      }],
    },
    backends: {
      anthropic: { apiKey: 'mock-key' },
      openai: { apiKey: 'mock-key' },
      ollama: { baseUrl: 'http://localhost:11434' },
      mock: { enabled: true }, // Enable mock backend for testing
    },
    logging: { level: 'error', file: '/dev/null' },
  };
}

/**
 * Mock external services for testing
 */
export function mockExternalServices() {
  // Mock Anthropic client
  vi.mock('../../src/backends/anthropic.js', () => ({
    AnthropicClient: vi.fn(() => ({
      chat: vi.fn(async function* () {
        yield {
          id: 'test-response',
          object: 'chat.completion.chunk',
          created: Date.now(),
          model: 'claude-3-sonnet',
          choices: [{
            index: 0,
            delta: { role: 'assistant', content: 'Mock response' },
            finishReason: 'stop',
          }],
        };
      }),
      models: vi.fn(() => Promise.resolve([
        { id: 'claude-3-sonnet', object: 'model', created: Date.now(), ownedBy: 'anthropic' }
      ])),
      health: vi.fn(() => Promise.resolve(true)),
    }))
  }));
  
  // Mock Ollama client for tests
  vi.mock('../../src/backends/ollama.js', () => ({
    OllamaClient: vi.fn(() => ({
      chat: vi.fn(async function* () {
        yield {
          id: 'test-response',
          object: 'chat.completion.chunk', 
          created: Date.now(),
          model: 'llama3.2:1b',
          choices: [{
            index: 0,
            delta: { role: 'assistant', content: 'Mock extraction result' },
            finishReason: 'stop',
          }],
        };
      }),
      models: vi.fn(() => Promise.resolve([
        { id: 'llama3.2:1b', object: 'model', created: Date.now(), ownedBy: 'ollama' }
      ])),
      health: vi.fn(() => Promise.resolve(true)),
    }))
  }));
}

/**
 * Create a test memory database
 */
export function getTestDbPath(): string {
  return ':memory:'; // Use in-memory SQLite for tests
}

/**
 * Clean up test environment
 */
export function cleanupTests() {
  vi.clearAllMocks();
  vi.resetAllMocks();
}