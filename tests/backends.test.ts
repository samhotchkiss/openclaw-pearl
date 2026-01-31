/**
 * Backend Client Tests
 * Tests for Anthropic, OpenAI, and Ollama clients
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicClient, OpenAIClient, OllamaClient, createBackendClient, parseModelString } from '../src/backends/index.js';
import type { 
  BackendClient, 
  ChatRequest, 
  ChatChunk, 
  Model, 
  TokenUsage,
  BackendConfig 
} from '../src/backends/types.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

/**
 * Test utilities for mocking HTTP responses
 */
const createMockResponse = (body: any, status = 200, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? 'OK' : 'Error',
  headers: new Map(Object.entries({
    'content-type': 'application/json',
    ...headers
  })),
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body))
});

const createMockStreamResponse = (chunks: string[]) => {
  const encoder = new TextEncoder();
  let chunkIndex = 0;
  
  const stream = new ReadableStream({
    start(controller) {
      const sendNext = () => {
        if (chunkIndex < chunks.length) {
          controller.enqueue(encoder.encode(chunks[chunkIndex++]));
          setTimeout(sendNext, 10); // Simulate streaming delay
        } else {
          controller.close();
        }
      };
      sendNext();
    }
  });

  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Map([['content-type', 'text/event-stream']]),
    body: stream
  };
};

/**
 * Shared test data
 */
const testChatRequest: ChatRequest = {
  model: 'test-model',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello, how are you?' }
  ],
  stream: true,
  maxTokens: 150,
  temperature: 0.7
};

describe('Anthropic Backend Client', () => {
  let client: AnthropicClient;
  const config: BackendConfig = {
    apiKey: 'test-api-key',
    baseUrl: 'https://api.anthropic.com',
    timeout: 5000,
    retries: 3
  };

  const anthropicStreamChunks = [
    'data: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","content":[],"model":"claude-3-sonnet-20240229","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":20,"output_tokens":0}}}\n\n',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"! I\'m doing well."}}\n\n',
    'data: {"type":"content_block_stop","index":0}\n\n',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":10}}\n\n',
    'data: {"type":"message_stop"}\n\n'
  ];

  beforeEach(() => {
    mockFetch.mockClear();
    client = new AnthropicClient(config);
  });

  it('should stream chat responses', async () => {
    mockFetch.mockResolvedValueOnce(createMockStreamResponse(anthropicStreamChunks));

    const chunks: ChatChunk[] = [];
    for await (const chunk of client.chat(testChatRequest)) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toHaveProperty('id');
    expect(chunks[0]).toHaveProperty('choices');
  });

  it('should return available models', async () => {
    const models = await client.models();
    
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toHaveProperty('id');
    expect(models[0].ownedBy).toBe('anthropic');
  });

  it('should check health', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ id: 'test' }));
    
    const isHealthy = await client.health();
    expect(typeof isHealthy).toBe('boolean');
  });
});

describe('OpenAI Backend Client', () => {
  let client: OpenAIClient;
  const config: BackendConfig = {
    apiKey: 'test-api-key',
    baseUrl: 'https://api.openai.com/v1',
    timeout: 5000,
    retries: 3
  };

  const openaiStreamChunks = [
    'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-3.5-turbo-0301","choices":[{"delta":{"role":"assistant","content":"Hello"},"index":0,"finish_reason":null}]}\n\n',
    'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-3.5-turbo-0301","choices":[{"delta":{"content":"! I\'m doing well."},"index":0,"finish_reason":null}]}\n\n',
    'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-3.5-turbo-0301","choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":20,"completion_tokens":10,"total_tokens":30}}\n\n',
    'data: [DONE]\n\n'
  ];

  beforeEach(() => {
    mockFetch.mockClear();
    client = new OpenAIClient(config);
  });

  it('should stream chat responses', async () => {
    mockFetch.mockResolvedValueOnce(createMockStreamResponse(openaiStreamChunks));

    const chunks: ChatChunk[] = [];
    for await (const chunk of client.chat(testChatRequest)) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toHaveProperty('id');
    expect(chunks[0]).toHaveProperty('choices');
  });

  it('should return available models', async () => {
    const mockModelsResponse = {
      data: [
        {
          id: 'gpt-3.5-turbo',
          object: 'model',
          created: 1677610602,
          ownedBy: 'openai'
        }
      ]
    };
    
    mockFetch.mockResolvedValueOnce(createMockResponse(mockModelsResponse));

    const models = await client.models();
    
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toHaveProperty('id');
    expect(models[0].ownedBy).toBe('openai');
  });

  it('should check health', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ data: [] }));
    
    const isHealthy = await client.health();
    expect(typeof isHealthy).toBe('boolean');
  });
});

describe('Ollama Backend Client', () => {
  let client: OllamaClient;
  const config: BackendConfig = {
    baseUrl: 'http://localhost:11434',
    timeout: 5000,
    retries: 3
  };

  const ollamaStreamChunks = [
    '{"model":"llama3.1:70b","created_at":"2024-01-01T00:00:00Z","message":{"role":"assistant","content":"Hello"},"done":false}\n',
    '{"model":"llama3.1:70b","created_at":"2024-01-01T00:00:00Z","message":{"role":"assistant","content":"! I\'m doing well."},"done":false}\n',
    '{"model":"llama3.1:70b","created_at":"2024-01-01T00:00:00Z","message":{"role":"assistant","content":""},"done":true,"total_duration":1000000000,"load_duration":500000,"prompt_eval_count":20,"prompt_eval_duration":300000000,"eval_count":10,"eval_duration":200000000}\n'
  ];

  beforeEach(() => {
    mockFetch.mockClear();
    client = new OllamaClient(config);
  });

  it('should stream chat responses', async () => {
    mockFetch.mockResolvedValueOnce(createMockStreamResponse(ollamaStreamChunks));

    const chunks: ChatChunk[] = [];
    for await (const chunk of client.chat(testChatRequest)) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toHaveProperty('id');
    expect(chunks[0]).toHaveProperty('choices');
  });

  it('should return available models', async () => {
    const mockModelsResponse = {
      models: [
        {
          name: 'llama3.1:70b',
          model: 'llama3.1:70b',
          modified_at: '2024-01-01T00:00:00Z',
          size: 1000000,
          digest: 'test-digest'
        }
      ]
    };
    
    mockFetch.mockResolvedValueOnce(createMockResponse(mockModelsResponse));

    const models = await client.models();
    
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toHaveProperty('id');
    expect(models[0].ownedBy).toBe('ollama');
  });

  it('should check health', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ models: [] }));
    
    const isHealthy = await client.health();
    expect(typeof isHealthy).toBe('boolean');
  });
});

describe('Backend Client Factory', () => {
  it('should create correct client instances', () => {
    const anthropicClient = createBackendClient('anthropic', { apiKey: 'test' });
    expect(anthropicClient).toBeInstanceOf(AnthropicClient);
    
    const openaiClient = createBackendClient('openai', { apiKey: 'test' });
    expect(openaiClient).toBeInstanceOf(OpenAIClient);
    
    const ollamaClient = createBackendClient('ollama', {});
    expect(ollamaClient).toBeInstanceOf(OllamaClient);
  });

  it('should parse model strings correctly', () => {
    expect(parseModelString('anthropic/claude-sonnet-4-20250514')).toEqual({
      backend: 'anthropic',
      model: 'claude-sonnet-4-20250514'
    });
    
    expect(parseModelString('openai/gpt-4')).toEqual({
      backend: 'openai', 
      model: 'gpt-4'
    });
    
    expect(parseModelString('ollama/llama3.1:70b')).toEqual({
      backend: 'ollama',
      model: 'llama3.1:70b'
    });
  });

  it('should throw error for invalid model strings', () => {
    expect(() => parseModelString('invalid-model')).toThrow();
  });

  it('should throw error for unsupported backends', () => {
    expect(() => createBackendClient('unsupported', {})).toThrow();
  });
});

describe('Error Handling', () => {
  it('should handle authentication errors', async () => {
    const client = new OpenAIClient({ apiKey: 'test-key' });
    
    mockFetch.mockResolvedValueOnce(createMockResponse(
      { error: { message: 'Invalid API key' } },
      401
    ));

    const generator = client.chat(testChatRequest);
    
    await expect(async () => {
      for await (const chunk of generator) {
        // Should throw before yielding
      }
    }).rejects.toThrow();
  });

  it('should handle rate limit errors with retry', async () => {
    mockFetch.mockClear(); // Clear previous calls
    
    const client = new OpenAIClient({ apiKey: 'test-key', retries: 1 });
    
    // First call fails with rate limit
    mockFetch.mockResolvedValueOnce(createMockResponse(
      { error: { message: 'Rate limit exceeded' } },
      429,
      { 'retry-after': '1' }
    ));
    
    // Second call succeeds
    const openaiStreamChunks = [
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-3.5-turbo-0301","choices":[{"delta":{"role":"assistant","content":"Hello"},"index":0,"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n'
    ];
    mockFetch.mockResolvedValueOnce(createMockStreamResponse(openaiStreamChunks));

    const chunks: ChatChunk[] = [];
    for await (const chunk of client.chat(testChatRequest)) {
      chunks.push(chunk);
    }

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(chunks.length).toBeGreaterThan(0);
  });
});