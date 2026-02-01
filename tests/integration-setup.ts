/**
 * Integration Test Setup - Mocks for Pearl integration and E2E tests
 */

import { vi } from 'vitest';
import type { ChatChunk, BackendClient } from '../src/types.js';

// Default mock responses
const defaultMockChunks = [
  'Hello',
  ' world',
  '! This is a test response.'
];

// Mock backend client factory
const createMockBackendClient = (): BackendClient => ({
  async *chat(request: any) {
    const chunks = defaultMockChunks;
    
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const chunk: ChatChunk = {
        id: `test-chunk-${i}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: request.model,
        choices: [{
          index: 0,
          delta: { 
            content: chunks[i],
            ...(i === 0 ? { role: 'assistant' } : {})
          },
          finishReason: isLast ? 'stop' : null,
        }],
      };
      yield chunk;
    }
  },

  async models() {
    return [
      { id: 'anthropic/claude-sonnet-4-20250514', ownedBy: 'anthropic' },
      { id: 'gpt-4', ownedBy: 'openai' },
      { id: 'ollama/llama3.2:3b', ownedBy: 'ollama' },
    ];
  },
});

// Mock all backend-related modules
vi.mock('../src/backends/index.js', () => ({
  createBackendClient: vi.fn().mockImplementation(() => createMockBackendClient()),
  AnthropicClient: vi.fn().mockImplementation(() => createMockBackendClient()),
  OpenAIClient: vi.fn().mockImplementation(() => createMockBackendClient()),
  OllamaClient: vi.fn().mockImplementation(() => createMockBackendClient()),
}));

// Mock memory extractor
vi.mock('../src/memory/extractor.js', () => ({
  createProvider: vi.fn().mockReturnValue({
    complete: vi.fn().mockResolvedValue({ choices: [{ message: { content: '{}' } }] }),
  }),
  MemoryExtractor: vi.fn().mockImplementation(() => ({
    extract: vi.fn().mockResolvedValue({ memories: [] }),
    initialize: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock embeddings with proper dimensions
vi.mock('../src/memory/embeddings.js', async () => {
  const actual = await vi.importActual('../src/memory/embeddings.js');
  return {
    ...actual,
    createEmbeddingProvider: vi.fn().mockReturnValue({
      dimensions: 768,
      embed: vi.fn().mockResolvedValue(new Float32Array(768).fill(0.1)),
      embedBatch: vi.fn().mockImplementation(async (texts: string[]) => 
        texts.map(() => new Float32Array(768).fill(0.1))
      ),
    }),
  };
});

// Mock Request classifier 
vi.mock('../src/routing/classifier.js', () => ({
  RequestClassifier: vi.fn().mockImplementation(() => ({
    classify: vi.fn().mockResolvedValue({
      model: 'anthropic/claude-sonnet-4-20250514',
      confidence: 0.9,
      reasoning: 'Test classification',
      complexity: 'medium',
      isSensitive: false,
      type: 'chat',
      tokens: { input: 100, output: 200 },
    }),
    initialize: vi.fn().mockResolvedValue(undefined),
    detectSensitive: vi.fn().mockReturnValue({ isSensitive: false, patterns: [] }),
    detectType: vi.fn().mockReturnValue({ type: 'chat', confidence: 0.9 }),
    analyzeComplexity: vi.fn().mockReturnValue({ complexity: 'medium', score: 0.5 }),
    estimateTokens: vi.fn().mockReturnValue({ input: 100, output: 200 }),
  })),
}));

// Mock Model Router 
vi.mock('../src/routing/router.js', () => ({
  ModelRouter: vi.fn().mockImplementation(() => ({
    route: vi.fn().mockResolvedValue({
      model: 'anthropic/claude-sonnet-4-20250514',
      classification: {
        complexity: 'medium',
        type: 'chat',
        sensitive: false,
        estimatedTokens: 100,
        requiresTools: false,
      },
      rule: 'test-rule',
      fallbacks: [],
    }),
    initialize: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock Rules Engine
vi.mock('../src/routing/rules.js', () => ({
  RuleEngine: vi.fn().mockImplementation(() => ({
    evaluate: vi.fn().mockReturnValue({
      matched: false,
      rule: null,
      model: 'anthropic/claude-sonnet-4-20250514',
    }),
  })),
  createRulesFromConfig: vi.fn().mockReturnValue([]),
}));

// Mock persistence for database issues
vi.mock('../src/memory/persistence.js', () => ({
  MemoryStore: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    store: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    getMetrics: vi.fn().mockReturnValue({ totalMemories: 0 }),
  })),
}));