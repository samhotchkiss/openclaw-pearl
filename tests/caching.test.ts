import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnthropicClient } from '../src/backends/anthropic.js';
import { CostCalculator } from '../src/usage/calculator.js';
import type { ChatRequest, TokenUsage } from '../src/backends/types.js';
import type { CachingConfig } from '../src/config/types.js';

// Mock fetch to simulate Anthropic API responses
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Anthropic Cache Control', () => {
  let client: AnthropicClient;
  let cachingConfig: CachingConfig;

  beforeEach(() => {
    cachingConfig = {
      enabled: true,
      anthropic: {
        systemPromptCache: true,
        memoryContextCache: true,
      },
    };

    client = new AnthropicClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.anthropic.com',
    }, cachingConfig);

    mockFetch.mockClear();
  });

  describe('System Prompt Caching', () => {
    it('should add cache_control to system prompts when enabled', async () => {
      const request: ChatRequest = {
        model: 'claude-3-sonnet-20240229',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant with extensive context about the user.',
          },
          {
            role: 'user',
            content: 'Hello, how are you?',
          },
        ],
        stream: false,
      };

      // Mock successful response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test-id',
          content: [{ text: 'Hello! I am doing well, thank you.' }],
          usage: {
            input_tokens: 50,
            output_tokens: 25,
            cache_creation_input_tokens: 40,
            cache_read_input_tokens: 0,
          },
        }),
      });

      // Convert to generator and consume
      const generator = client.chat(request);
      const responses = [];
      for await (const response of generator) {
        responses.push(response);
      }

      // Verify the request was made with cache_control
      const [url, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.system).toEqual([
        {
          type: 'text',
          text: 'You are a helpful assistant with extensive context about the user.',
          cache_control: { type: 'ephemeral' },
        },
      ]);
    });

    it('should not add cache_control when caching is disabled', async () => {
      // Create client with caching disabled
      const noCacheClient = new AnthropicClient({
        apiKey: 'test-key',
        baseUrl: 'https://api.anthropic.com',
      }, {
        enabled: false,
        anthropic: {
          systemPromptCache: false,
          memoryContextCache: false,
        },
      });

      const request: ChatRequest = {
        model: 'claude-3-sonnet-20240229',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant.',
          },
          {
            role: 'user',
            content: 'Hello',
          },
        ],
        stream: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test-id',
          content: [{ text: 'Hello!' }],
          usage: { input_tokens: 20, output_tokens: 5 },
        }),
      });

      const generator = noCacheClient.chat(request);
      const responses = [];
      for await (const response of generator) {
        responses.push(response);
      }

      const [url, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      // Should be a simple string, not an object with cache_control
      expect(body.system).toBe('You are a helpful assistant.');
    });
  });

  describe('Memory Context Caching', () => {
    it('should add cache_control to memory context messages', async () => {
      const request: ChatRequest = {
        model: 'claude-3-sonnet-20240229',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant.',
          },
          {
            role: 'user',
            content: '[MEMORY_CONTEXT]\nPrevious conversations and user preferences...\n[/MEMORY_CONTEXT]\n\nHello, what\'s my favorite color?',
          },
        ],
        stream: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test-id',
          content: [{ text: 'Based on our previous conversations, your favorite color is blue.' }],
          usage: {
            input_tokens: 100,
            output_tokens: 15,
            cache_creation_input_tokens: 80,
            cache_read_input_tokens: 0,
          },
        }),
      });

      const generator = client.chat(request);
      const responses = [];
      for await (const response of generator) {
        responses.push(response);
      }

      const [url, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      // Should restructure the user message to separate cacheable memory context
      expect(body.messages).toEqual([
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Previous conversations and user preferences...',
              cache_control: { type: 'ephemeral' },
            },
            {
              type: 'text',
              text: 'Hello, what\'s my favorite color?',
            },
          ],
        },
      ]);
    });

    it('should handle messages without memory context normally', async () => {
      const request: ChatRequest = {
        model: 'claude-3-sonnet-20240229',
        messages: [
          {
            role: 'user',
            content: 'Hello, how are you?',
          },
        ],
        stream: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test-id',
          content: [{ text: 'I am doing well, thank you!' }],
          usage: { input_tokens: 15, output_tokens: 10 },
        }),
      });

      const generator = client.chat(request);
      const responses = [];
      for await (const response of generator) {
        responses.push(response);
      }

      const [url, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.messages).toEqual([
        {
          role: 'user',
          content: 'Hello, how are you?',
        },
      ]);
    });
  });

  describe('Cache Metrics Extraction', () => {
    it('should extract cache metrics from Anthropic response', async () => {
      const request: ChatRequest = {
        model: 'claude-3-sonnet-20240229',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant.',
          },
          {
            role: 'user',
            content: 'Hello',
          },
        ],
        stream: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test-id',
          content: [{ text: 'Hello!' }],
          usage: {
            input_tokens: 50,
            output_tokens: 10,
            cache_creation_input_tokens: 30,
            cache_read_input_tokens: 20,
          },
        }),
      });

      const generator = client.chat(request);
      const responses = [];
      for await (const response of generator) {
        responses.push(response);
      }

      const finalResponse = responses[responses.length - 1];
      
      expect(finalResponse.usage).toEqual({
        promptTokens: 50,
        completionTokens: 10,
        totalTokens: 60,
        cache: {
          writeTokens: 30,
          readTokens: 20,
          type: 'ephemeral',
        },
      });
    });

    it('should handle responses without cache metrics', async () => {
      const request: ChatRequest = {
        model: 'claude-3-sonnet-20240229',
        messages: [
          {
            role: 'user',
            content: 'Hello',
          },
        ],
        stream: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test-id',
          content: [{ text: 'Hello!' }],
          usage: {
            input_tokens: 15,
            output_tokens: 10,
          },
        }),
      });

      const generator = client.chat(request);
      const responses = [];
      for await (const response of generator) {
        responses.push(response);
      }

      const finalResponse = responses[responses.length - 1];
      
      expect(finalResponse.usage).toEqual({
        promptTokens: 15,
        completionTokens: 10,
        totalTokens: 25,
      });
    });
  });

  describe('Streaming with Cache Metrics', () => {
    it('should handle cache metrics in streaming responses', async () => {
      const request: ChatRequest = {
        model: 'claude-3-sonnet-20240229',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant.',
          },
          {
            role: 'user',
            content: 'Hello',
          },
        ],
        stream: true,
      };

      // Mock streaming response
      const mockBody = {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode('data: {"type":"message_start","message":{"id":"test-id","usage":{"input_tokens":50}}}\n\n'),
            })
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode('data: {"type":"content_block_delta","delta":{"text":"Hello!"}}\n\n'),
            })
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode('data: {"type":"message_delta","usage":{"output_tokens":10}}\n\n'),
            })
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode('data: {"type":"message_stop"}\n\n'),
            })
            .mockResolvedValueOnce({
              done: true,
              value: undefined,
            }),
          releaseLock: vi.fn(),
        }),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: mockBody,
      });

      const generator = client.chat(request);
      const responses = [];
      for await (const response of generator) {
        responses.push(response);
      }

      // Should have content chunk and final chunk with usage
      expect(responses).toHaveLength(2);
      const finalResponse = responses[1];
      
      expect(finalResponse.usage).toBeDefined();
      expect(finalResponse.choices[0].finishReason).toBe('stop');
    });
  });
});

describe('Cache Cost Calculation', () => {
  let calculator: any;

  beforeEach(() => {
    const costConfig = {
      anthropic: {
        'claude-3-sonnet-20240229': {
          inputCostPer1kTokens: 0.003,
          outputCostPer1kTokens: 0.015,
          cacheCostPer1kTokens: 0.0015, // 50% of input cost
        },
      },
    };
    calculator = new CostCalculator(costConfig);
  });

  it('should calculate cost with cache savings', () => {
    const usage: TokenUsage = {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      cache: {
        readTokens: 600,
        writeTokens: 0,
        type: 'ephemeral',
      },
    };

    const result = calculator.calculateCostWithCache('anthropic', 'claude-3-sonnet-20240229', usage);
    
    // Normal cost: (1000 * 0.003) + (500 * 0.015) = 0.003 + 0.0075 = 0.0105
    // Cache savings: 600 * (0.003 - 0.0015) / 1000 = 600 * 0.0015 / 1000 = 0.0009
    // Final cost: 0.0105 - 0.0009 = 0.0096
    expect(result.totalCost).toBeCloseTo(0.0096);
    expect(result.cacheSavings).toBeCloseTo(0.0009);
    expect(result.cacheUsed).toBe(true);
  });

  it('should handle cache writes (creation)', () => {
    const usage: TokenUsage = {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      cache: {
        readTokens: 0,
        writeTokens: 400, // Creating cache
        type: 'ephemeral',
      },
    };

    const result = calculator.calculateCostWithCache('anthropic', 'claude-3-sonnet-20240229', usage);
    
    // Normal cost without cache savings (cache write costs same as input)
    expect(result.totalCost).toBeCloseTo(0.0105);
    expect(result.cacheSavings).toBe(0);
    expect(result.cacheUsed).toBe(true);
  });

  it('should handle both cache reads and writes', () => {
    const usage: TokenUsage = {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      cache: {
        readTokens: 300,
        writeTokens: 200,
        type: 'ephemeral',
      },
    };

    const result = calculator.calculateCostWithCache('anthropic', 'claude-3-sonnet-20240229', usage);
    
    // Cache savings only from reads: 300 * (0.003 - 0.0015) / 1000 = 0.00045
    expect(result.cacheSavings).toBeCloseTo(0.00045);
    expect(result.cacheUsed).toBe(true);
  });
});
describe('OAuth Auth Type', () => {
  it('should skip caching when authType is oauth', async () => {
    const { AnthropicClient } = await import('../src/backends/anthropic.js');
    
    const client = new AnthropicClient(
      { apiKey: 'test-key', authType: 'oauth' },
      { enabled: true, anthropic: { systemPromptCache: true, memoryContextCache: true } }
    );
    
    // Access private method via any cast for testing
    const result = (client as any).processSystemMessage('test content');
    
    // Should return string, not array with cache_control
    expect(typeof result).toBe('string');
    expect(result).toBe('test content');
  });

  it('should apply caching when authType is apiKey', async () => {
    const { AnthropicClient } = await import('../src/backends/anthropic.js');
    
    const client = new AnthropicClient(
      { apiKey: 'test-key', authType: 'apiKey' },
      { enabled: true, anthropic: { systemPromptCache: true, memoryContextCache: true } }
    );
    
    const result = (client as any).processSystemMessage('test content');
    
    // Should return array with cache_control
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});
