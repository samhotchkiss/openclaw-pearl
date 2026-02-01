// Import integration setup for comprehensive mocking
import '../tests/integration-setup.js';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Pearl } from '../src/pearl.js';
import type { PearlConfig } from '../src/types.js';

// Mock all dependencies to avoid initialization issues
vi.mock('../src/memory/store.js');
vi.mock('../src/memory/extractor.js');
vi.mock('../src/memory/retriever.js');
vi.mock('../src/memory/augmenter.js');
vi.mock('../src/routing/router.js', () => ({
  ModelRouter: vi.fn().mockImplementation(() => ({
    route: vi.fn().mockResolvedValue({
      model: 'mock/test-model',
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
vi.mock('../src/backends/index.js');
vi.mock('../src/sunrise/index.js');

describe('Pearl Sunrise Integration', () => {
  let testDir: string;
  let pearl: Pearl;

  beforeEach(async () => {
    // Create temporary directories
    testDir = mkdtempSync(join(tmpdir(), 'pearl-sunrise-test-'));

    // Mock config with sunrise enabled
    const config: PearlConfig = {
      memory: {
        store: 'sqlite',
        path: join(testDir, 'memories.db'),
      },
      extraction: {
        enabled: false, // Disable to keep tests simple
        model: 'test-model',
        async: false,
        extract_from_assistant: false,
      },
      embedding: {
        provider: 'mock',
        model: 'test',
        dimensions: 768,
      },
      retrieval: {
        max_memories: 5,
        min_similarity: 0.5,
        token_budget: 200,
        recency_boost: false,
      },
      routing: {
        classifier: 'test',
        default_model: 'test-model',
        rules: [],
      },
      backends: {
        mock: { enabled: true },
        ollama: {
          base_url: 'http://localhost:11434',
        },
      },
      sunrise: {
        enabled: true,
        transcriptPath: join(testDir, 'transcripts'),
        model: 'ollama/llama3.2:3b',
        gapThresholdMs: 100, // Very short for testing
        lookbackMs: 1000,
        maxMessages: 10,
        minMessages: 1,
      },
    };

    pearl = new Pearl(config);

    // Mock backend to avoid real API calls
    const mockBackend = {
      async* chat() {
        yield {
          id: 'test-1',
          object: 'chat.completion.chunk',
          created: Date.now(),
          model: 'test-model',
          choices: [{
            delta: { content: 'Test response' },
            index: 0,
          }],
        };
        yield {
          id: 'test-1',
          object: 'chat.completion.chunk',
          created: Date.now(),
          model: 'test-model',
          choices: [{
            delta: {},
            index: 0,
            finishReason: 'stop',
          }],
        };
      }
    };

    // @ts-expect-error - Accessing private property for testing
    pearl.backends = new Map([['mock', mockBackend]]);
    // @ts-expect-error - Mock the backend routing
    pearl.getBackendFromModel = () => 'mock';
  });

  afterEach(() => {
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should initialize without sunrise when disabled', async () => {
    // Create config with sunrise disabled
    const config: PearlConfig = {
      memory: { store: 'sqlite', path: join(testDir, 'memories.db') },
      extraction: { enabled: false, model: 'test', async: false, extract_from_assistant: false },
      embedding: { provider: 'mock', model: 'test', dimensions: 768 },
      retrieval: { max_memories: 5, min_similarity: 0.5, token_budget: 200, recency_boost: false },
      routing: { classifier: 'test', default_model: 'test-model', rules: [] },
      backends: {
        ollama: {
          base_url: 'http://localhost:11434',
        },
      },
    };

    const pearlWithoutSunrise = new Pearl(config);
    
    // Mock similar setup
    // @ts-expect-error - Accessing private property for testing
    pearlWithoutSunrise.backends = new Map([['mock', {}]]);

    await expect(pearlWithoutSunrise.initialize()).resolves.not.toThrow();
    
    // @ts-expect-error - Accessing private property to verify sunrise is not initialized
    expect(pearlWithoutSunrise.sunriseService).toBeUndefined();
    // @ts-expect-error - Accessing private property to verify transcript logger is not initialized
    expect(pearlWithoutSunrise.transcriptLogger).toBeUndefined();
  });

  it('should initialize with sunrise when enabled', async () => {
    // Mock the sunrise service creation to avoid file system operations during init
    vi.mock('../src/sunrise/index.js', async () => {
      const actual = await vi.importActual('../src/sunrise/index.js');
      return {
        ...actual,
        createSunriseService: vi.fn(() => ({
          handleRequest: vi.fn().mockResolvedValue({ 
            messages: [], 
            summaryInjected: false 
          }),
        })),
        TranscriptLogger: vi.fn(() => ({
          log: vi.fn().mockResolvedValue(undefined),
        })),
      };
    });

    await expect(pearl.initialize()).resolves.not.toThrow();
    
    // @ts-expect-error - Accessing private property to verify sunrise is initialized
    expect(pearl.sunriseService).toBeDefined();
    // @ts-expect-error - Accessing private property to verify transcript logger is initialized
    expect(pearl.transcriptLogger).toBeDefined();
  });

  it('should handle chat completion without sunrise when no gap detected', async () => {
    // Mock sunrise service that says no recovery needed
    const mockSunriseService = {
      handleRequest: vi.fn().mockResolvedValue({ 
        messages: [{ role: 'user', content: 'Hello' }], 
        summaryInjected: false 
      }),
    };
    
    const mockTranscriptLogger = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    // Initialize pearl
    await pearl.initialize();
    
    // @ts-expect-error - Set mock services
    pearl.sunriseService = mockSunriseService;
    // @ts-expect-error - Set mock services
    pearl.transcriptLogger = mockTranscriptLogger;

    // Mock augmenter to avoid memory operations
    // @ts-expect-error - Mock augmenter
    pearl.augmenter = {
      augment: vi.fn().mockResolvedValue({
        messages: [{ role: 'user', content: 'Hello' }],
        injectedMemories: [],
      }),
    };

    // Mock router
    // @ts-expect-error - Mock router
    pearl.router = {
      route: vi.fn().mockResolvedValue({
        model: 'test-model',
        reasoning: 'test',
      }),
    };

    const request = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      metadata: {
        agentId: 'test-agent',
        sessionId: 'test-session',
      },
    };

    const chunks = [];
    for await (const chunk of pearl.chatCompletion(request)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(mockSunriseService.handleRequest).toHaveBeenCalledWith(
      'test-agent',
      'test-session',
      [{ role: 'user', content: 'Hello' }],
      {}
    );
    expect(mockTranscriptLogger.log).toHaveBeenCalled();
  });

  it('should inject sunrise summary when gap is detected', async () => {
    // Mock sunrise service that says recovery is needed and injects summary
    const mockSunriseService = {
      handleRequest: vi.fn().mockResolvedValue({ 
        messages: [
          { role: 'system', content: '<pearl:sunrise>\nSession Recovery Summary\nLast active: Working on tests\n</pearl:sunrise>\n\nYou are an AI assistant.' },
          { role: 'user', content: 'Hello' }
        ], 
        summaryInjected: true,
        summary: {
          lastActive: new Date(),
          context: 'Working on tests',
          decisions: [],
          state: 'testing',
          nextActions: ['continue testing'],
        }
      }),
    };
    
    const mockTranscriptLogger = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    // Initialize pearl
    await pearl.initialize();
    
    // @ts-expect-error - Set mock services
    pearl.sunriseService = mockSunriseService;
    // @ts-expect-error - Set mock services
    pearl.transcriptLogger = mockTranscriptLogger;

    // Mock augmenter to avoid memory operations
    // @ts-expect-error - Mock augmenter
    pearl.augmenter = {
      augment: vi.fn().mockResolvedValue({
        messages: [
          { role: 'system', content: '<pearl:sunrise>\nSession Recovery Summary\nLast active: Working on tests\n</pearl:sunrise>\n\nYou are an AI assistant.' },
          { role: 'user', content: 'Hello' }
        ],
        injectedMemories: [],
      }),
    };

    // Mock router
    // @ts-expect-error - Mock router
    pearl.router = {
      route: vi.fn().mockResolvedValue({
        model: 'test-model',
        reasoning: 'test',
      }),
    };

    const request = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      metadata: {
        agentId: 'test-agent',
        sessionId: 'test-session',
      },
    };

    const chunks = [];
    for await (const chunk of pearl.chatCompletion(request)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(mockSunriseService.handleRequest).toHaveBeenCalledWith(
      'test-agent',
      'test-session',
      [{ role: 'user', content: 'Hello' }],
      {}
    );
    
    // Verify the augmented messages contain the sunrise summary
    // @ts-expect-error - Access mock calls
    const augmentedMessages = pearl.augmenter.augment.mock.calls[0][1];
    expect(augmentedMessages[0].content).toContain('<pearl:sunrise>');
    expect(augmentedMessages[0].content).toContain('Session Recovery Summary');
  });

  it('should handle force sunrise flag', async () => {
    const mockSunriseService = {
      handleRequest: vi.fn().mockResolvedValue({ 
        messages: [{ role: 'user', content: 'Hello' }], 
        summaryInjected: false 
      }),
    };
    
    const mockTranscriptLogger = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    // Initialize pearl
    await pearl.initialize();
    
    // @ts-expect-error - Set mock services
    pearl.sunriseService = mockSunriseService;
    // @ts-expect-error - Set mock services
    pearl.transcriptLogger = mockTranscriptLogger;

    // Mock augmenter and router
    // @ts-expect-error - Mock augmenter
    pearl.augmenter = {
      augment: vi.fn().mockResolvedValue({
        messages: [{ role: 'user', content: 'Hello' }],
        injectedMemories: [],
      }),
    };
    // @ts-expect-error - Mock router
    pearl.router = {
      route: vi.fn().mockResolvedValue({
        model: 'test-model',
        reasoning: 'test',
      }),
    };

    const request = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      metadata: {
        agentId: 'test-agent',
        sessionId: 'test-session',
        forceSunrise: true,
      },
    };

    const chunks = [];
    for await (const chunk of pearl.chatCompletion(request)) {
      chunks.push(chunk);
    }

    expect(mockSunriseService.handleRequest).toHaveBeenCalledWith(
      'test-agent',
      'test-session',
      [{ role: 'user', content: 'Hello' }],
      { forceSunrise: true }
    );
  });
});