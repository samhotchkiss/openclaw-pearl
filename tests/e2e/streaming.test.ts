/**
 * E2E Tests - SSE Streaming
 * Tests the full streaming response flow: request → backend → streamed chunks
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Pearl } from '../../src/pearl.js';
import type { PearlConfig, ChatRequest, ChatChunk } from '../../src/types.js';
import { createTestConfig, mockExternalServices } from '../setup/test-helpers.js';

// Track chunks for verification
let emittedChunks: ChatChunk[] = [];
let streamDelays: number[] = [];

// Mock the extractor
vi.mock('../../src/memory/extractor.js', () => {
  return {
    createProvider: vi.fn().mockReturnValue({
      complete: vi.fn(),
    }),
    MemoryExtractor: vi.fn().mockImplementation(() => ({
      extract: vi.fn().mockResolvedValue({ memories: [] }),
    })),
  };
});

// Mock embeddings
vi.mock('../../src/memory/embeddings.js', async () => {
  const actual = await vi.importActual('../../src/memory/embeddings.js');
  return {
    ...actual,
    createEmbeddingProvider: vi.fn().mockReturnValue({
      dimensions: 768,
      embed: vi.fn().mockResolvedValue(new Float32Array(768)),
      embedBatch: vi.fn().mockImplementation(async (texts: string[]) => 
        texts.map(() => new Float32Array(768))
      ),
    }),
  };
});

// Mock backends with configurable streaming behavior
let mockStreamConfig = {
  chunks: ['Hello', ' ', 'World', '!'],
  delayMs: 0,
  shouldError: false,
  errorAtChunk: -1,
};

vi.mock('../../src/backends/index.js', () => {
  return {
    createBackendClient: vi.fn().mockReturnValue({
      chat: async function* (request: any) {
        const startTime = Date.now();
        
        for (let i = 0; i < mockStreamConfig.chunks.length; i++) {
          // Check if we should error at this chunk
          if (mockStreamConfig.shouldError && i === mockStreamConfig.errorAtChunk) {
            throw new Error('Backend stream error');
          }

          // Add delay if configured
          if (mockStreamConfig.delayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, mockStreamConfig.delayMs));
          }

          const isLast = i === mockStreamConfig.chunks.length - 1;
          const chunk: ChatChunk = {
            id: `chunk-${i}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: request.model,
            choices: [{
              index: 0,
              delta: { 
                content: mockStreamConfig.chunks[i],
                ...(i === 0 ? { role: 'assistant' } : {})
              },
              finishReason: isLast ? 'stop' : null,
            }],
          };

          streamDelays.push(Date.now() - startTime);
          yield chunk;
        }
      },
      models: vi.fn().mockResolvedValue([]),
    }),
  };
});

describe('E2E: SSE Streaming', () => {
  let pearl: Pearl;

  const createConfig = (): PearlConfig => ({
    server: { port: 8080, host: '0.0.0.0' },
    memory: { store: 'sqlite', path: ':memory:' },
    extraction: {
      enabled: false,
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
      defaultModel: 'mock/test-model',
      rules: [{
        name: 'default',
        match: { default: true },
        model: 'mock/test-model',
        priority: 1,
      }],
    },
    backends: {
      mock: { enabled: true },
    },
  });

  beforeEach(async () => {
    emittedChunks = [];
    streamDelays = [];
    mockStreamConfig = {
      chunks: ['Hello', ' ', 'World', '!'],
      delayMs: 0,
      shouldError: false,
      errorAtChunk: -1,
    };
    
    pearl = new Pearl(createConfig());
    await pearl.initialize();
  });

  afterEach(async () => {
    await pearl.shutdown();
  });

  describe('Basic Streaming', () => {
    it('should stream response chunks in order', async () => {
      const request: ChatRequest = {
        model: 'pearl',
        messages: [
          { role: 'user', content: 'Hello!' }
        ],
        metadata: {
          agentId: 'test-agent',
          sessionId: 'test-session',
        },
      };

      const chunks: ChatChunk[] = [];
      for await (const chunk of pearl.chatCompletion(request)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(4);
      expect(chunks[0].choices[0].delta.content).toBe('Hello');
      expect(chunks[1].choices[0].delta.content).toBe(' ');
      expect(chunks[2].choices[0].delta.content).toBe('World');
      expect(chunks[3].choices[0].delta.content).toBe('!');
    });

    it('should preserve chunk structure conforming to OpenAI format', async () => {
      const request: ChatRequest = {
        model: 'pearl',
        messages: [
          { role: 'user', content: 'Test' }
        ],
        metadata: {
          agentId: 'test-agent',
          sessionId: 'test-session',
        },
      };

      const chunks: ChatChunk[] = [];
      for await (const chunk of pearl.chatCompletion(request)) {
        chunks.push(chunk);
      }

      // Verify OpenAI-compatible structure
      for (const chunk of chunks) {
        expect(chunk.id).toBeDefined();
        expect(chunk.object).toBe('chat.completion.chunk');
        expect(chunk.created).toBeTypeOf('number');
        expect(chunk.model).toBeDefined();
        expect(chunk.choices).toBeInstanceOf(Array);
        expect(chunk.choices.length).toBeGreaterThan(0);
        expect(chunk.choices[0].index).toBe(0);
        expect(chunk.choices[0].delta).toBeDefined();
      }
    });

    it('should include role on first chunk delta', async () => {
      const request: ChatRequest = {
        model: 'pearl',
        messages: [
          { role: 'user', content: 'Test' }
        ],
        metadata: {
          agentId: 'test-agent',
          sessionId: 'test-session',
        },
      };

      const chunks: ChatChunk[] = [];
      for await (const chunk of pearl.chatCompletion(request)) {
        chunks.push(chunk);
      }

      // First chunk should have role
      expect(chunks[0].choices[0].delta.role).toBe('assistant');
      
      // Subsequent chunks may not have role
      for (let i = 1; i < chunks.length; i++) {
        // Role is optional on subsequent chunks
      }
    });

    it('should set finishReason only on last chunk', async () => {
      const request: ChatRequest = {
        model: 'pearl',
        messages: [
          { role: 'user', content: 'Test' }
        ],
        metadata: {
          agentId: 'test-agent',
          sessionId: 'test-session',
        },
      };

      const chunks: ChatChunk[] = [];
      for await (const chunk of pearl.chatCompletion(request)) {
        chunks.push(chunk);
      }

      // All chunks except last should have null finish_reason
      for (let i = 0; i < chunks.length - 1; i++) {
        expect(chunks[i].choices[0].finishReason).toBeNull();
      }

      // Last chunk should have 'stop'
      expect(chunks[chunks.length - 1].choices[0].finishReason).toBe('stop');
    });
  });

  describe('Full Response Assembly', () => {
    it('should allow concatenating chunks to form complete response', async () => {
      mockStreamConfig.chunks = ['The ', 'quick ', 'brown ', 'fox ', 'jumps!'];
      
      const request: ChatRequest = {
        model: 'pearl',
        messages: [
          { role: 'user', content: 'Tell me a sentence' }
        ],
        metadata: {
          agentId: 'test-agent',
          sessionId: 'test-session',
        },
      };

      let fullResponse = '';
      for await (const chunk of pearl.chatCompletion(request)) {
        if (chunk.choices[0].delta.content) {
          fullResponse += chunk.choices[0].delta.content;
        }
      }

      expect(fullResponse).toBe('The quick brown fox jumps!');
    });

    it('should handle empty content chunks gracefully', async () => {
      mockStreamConfig.chunks = ['Hello', '', 'World'];
      
      const request: ChatRequest = {
        model: 'pearl',
        messages: [
          { role: 'user', content: 'Test' }
        ],
        metadata: {
          agentId: 'test-agent',
          sessionId: 'test-session',
        },
      };

      let fullResponse = '';
      for await (const chunk of pearl.chatCompletion(request)) {
        if (chunk.choices[0].delta.content) {
          fullResponse += chunk.choices[0].delta.content;
        }
      }

      expect(fullResponse).toBe('HelloWorld');
    });
  });

  describe('Streaming Behavior', () => {
    it('should stream chunks without waiting for full response', async () => {
      mockStreamConfig.delayMs = 50; // 50ms delay between chunks
      mockStreamConfig.chunks = ['A', 'B', 'C', 'D', 'E'];
      
      const request: ChatRequest = {
        model: 'pearl',
        messages: [
          { role: 'user', content: 'Test' }
        ],
        metadata: {
          agentId: 'test-agent',
          sessionId: 'test-session',
        },
      };

      const receivedTimestamps: number[] = [];
      const startTime = Date.now();
      
      for await (const chunk of pearl.chatCompletion(request)) {
        receivedTimestamps.push(Date.now() - startTime);
      }

      // Chunks should arrive progressively, not all at once
      expect(receivedTimestamps.length).toBe(5);
      
      // Each subsequent chunk should arrive later
      for (let i = 1; i < receivedTimestamps.length; i++) {
        expect(receivedTimestamps[i]).toBeGreaterThan(receivedTimestamps[i - 1]);
      }
    });

    it('should not buffer entire response before yielding first chunk', async () => {
      mockStreamConfig.delayMs = 10;
      mockStreamConfig.chunks = Array(20).fill('x'); // 20 chunks
      
      const request: ChatRequest = {
        model: 'pearl',
        messages: [
          { role: 'user', content: 'Test' }
        ],
        metadata: {
          agentId: 'test-agent',
          sessionId: 'test-session',
        },
      };

      const startTime = Date.now();
      let firstChunkTime = 0;
      
      for await (const chunk of pearl.chatCompletion(request)) {
        if (firstChunkTime === 0) {
          firstChunkTime = Date.now() - startTime;
        }
      }

      // First chunk should arrive quickly (before all chunks are generated)
      // Total would be ~200ms if buffered, should be < 50ms if streaming
      expect(firstChunkTime).toBeLessThan(100);
    });
  });

  describe('Error Handling', () => {
    it('should propagate backend errors during streaming', async () => {
      mockStreamConfig.shouldError = true;
      mockStreamConfig.errorAtChunk = 0;
      
      const request: ChatRequest = {
        model: 'pearl',
        messages: [
          { role: 'user', content: 'Test' }
        ],
        metadata: {
          agentId: 'test-agent',
          sessionId: 'test-session',
        },
      };

      const generator = pearl.chatCompletion(request);
      
      await expect(generator.next()).rejects.toThrow('Backend stream error');
    });

    it('should handle errors mid-stream', async () => {
      mockStreamConfig.shouldError = true;
      mockStreamConfig.errorAtChunk = 2; // Error on 3rd chunk
      mockStreamConfig.chunks = ['A', 'B', 'C', 'D'];
      
      const request: ChatRequest = {
        model: 'pearl',
        messages: [
          { role: 'user', content: 'Test' }
        ],
        metadata: {
          agentId: 'test-agent',
          sessionId: 'test-session',
        },
      };

      const chunks: ChatChunk[] = [];
      
      try {
        for await (const chunk of pearl.chatCompletion(request)) {
          chunks.push(chunk);
        }
      } catch (error: any) {
        expect(error.message).toBe('Backend stream error');
      }

      // Should have received some chunks before error
      expect(chunks.length).toBe(2);
    });
  });

  describe('Large Responses', () => {
    it('should handle many small chunks efficiently', async () => {
      const chunkCount = 100;
      mockStreamConfig.chunks = Array(chunkCount).fill('word ');
      
      const request: ChatRequest = {
        model: 'pearl',
        messages: [
          { role: 'user', content: 'Write something long' }
        ],
        metadata: {
          agentId: 'test-agent',
          sessionId: 'test-session',
        },
      };

      let count = 0;
      for await (const _ of pearl.chatCompletion(request)) {
        count++;
      }

      expect(count).toBe(chunkCount);
    });

    it('should handle large individual chunks', async () => {
      const largeContent = 'x'.repeat(10000);
      mockStreamConfig.chunks = [largeContent];
      
      const request: ChatRequest = {
        model: 'pearl',
        messages: [
          { role: 'user', content: 'Test' }
        ],
        metadata: {
          agentId: 'test-agent',
          sessionId: 'test-session',
        },
      };

      let fullResponse = '';
      for await (const chunk of pearl.chatCompletion(request)) {
        if (chunk.choices[0].delta.content) {
          fullResponse += chunk.choices[0].delta.content;
        }
      }

      expect(fullResponse.length).toBe(10000);
    });
  });

  describe('Unicode and Special Characters', () => {
    it('should stream unicode content correctly', async () => {
      mockStreamConfig.chunks = ['こんにちは', ' ', '世界', '!'];
      
      const request: ChatRequest = {
        model: 'pearl',
        messages: [
          { role: 'user', content: 'Say hello in Japanese' }
        ],
        metadata: {
          agentId: 'test-agent',
          sessionId: 'test-session',
        },
      };

      let fullResponse = '';
      for await (const chunk of pearl.chatCompletion(request)) {
        if (chunk.choices[0].delta.content) {
          fullResponse += chunk.choices[0].delta.content;
        }
      }

      expect(fullResponse).toBe('こんにちは 世界!');
    });

    it('should stream emoji correctly', async () => {
      mockStreamConfig.chunks = ['Hello ', '👋', ' World ', '🌍', '!'];
      
      const request: ChatRequest = {
        model: 'pearl',
        messages: [
          { role: 'user', content: 'Test' }
        ],
        metadata: {
          agentId: 'test-agent',
          sessionId: 'test-session',
        },
      };

      let fullResponse = '';
      for await (const chunk of pearl.chatCompletion(request)) {
        if (chunk.choices[0].delta.content) {
          fullResponse += chunk.choices[0].delta.content;
        }
      }

      expect(fullResponse).toBe('Hello 👋 World 🌍!');
    });

    it('should handle newlines and formatting in stream', async () => {
      mockStreamConfig.chunks = ['Line 1\n', 'Line 2\n', '```\ncode\n```'];
      
      const request: ChatRequest = {
        model: 'pearl',
        messages: [
          { role: 'user', content: 'Test' }
        ],
        metadata: {
          agentId: 'test-agent',
          sessionId: 'test-session',
        },
      };

      let fullResponse = '';
      for await (const chunk of pearl.chatCompletion(request)) {
        if (chunk.choices[0].delta.content) {
          fullResponse += chunk.choices[0].delta.content;
        }
      }

      expect(fullResponse).toBe('Line 1\nLine 2\n```\ncode\n```');
    });
  });

  describe('Concurrent Streams', () => {
    it('should handle multiple concurrent streaming requests', async () => {
      mockStreamConfig.chunks = ['A', 'B', 'C'];
      
      const request1: ChatRequest = {
        model: 'pearl',
        messages: [{ role: 'user', content: 'Request 1' }],
        metadata: { agentId: 'agent-1', sessionId: 'session-1' },
      };

      const request2: ChatRequest = {
        model: 'pearl',
        messages: [{ role: 'user', content: 'Request 2' }],
        metadata: { agentId: 'agent-2', sessionId: 'session-2' },
      };

      // Start both streams concurrently
      const stream1Promise = (async () => {
        let response = '';
        for await (const chunk of pearl.chatCompletion(request1)) {
          if (chunk.choices[0].delta.content) {
            response += chunk.choices[0].delta.content;
          }
        }
        return response;
      })();

      const stream2Promise = (async () => {
        let response = '';
        for await (const chunk of pearl.chatCompletion(request2)) {
          if (chunk.choices[0].delta.content) {
            response += chunk.choices[0].delta.content;
          }
        }
        return response;
      })();

      const [response1, response2] = await Promise.all([stream1Promise, stream2Promise]);

      expect(response1).toBe('ABC');
      expect(response2).toBe('ABC');
    });
  });

  describe('Model Information in Chunks', () => {
    it('should include correct model in all chunks', async () => {
      mockStreamConfig.chunks = ['A', 'B', 'C'];
      
      const request: ChatRequest = {
        model: 'pearl',
        messages: [
          { role: 'user', content: 'Test' }
        ],
        metadata: {
          agentId: 'test-agent',
          sessionId: 'test-session',
        },
      };

      for await (const chunk of pearl.chatCompletion(request)) {
        // Model should be included in each chunk
        expect(chunk.model).toBeDefined();
        expect(chunk.model.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Generator Protocol', () => {
    it('should support iterator protocol', async () => {
      mockStreamConfig.chunks = ['X', 'Y', 'Z'];
      
      const request: ChatRequest = {
        model: 'pearl',
        messages: [
          { role: 'user', content: 'Test' }
        ],
        metadata: {
          agentId: 'test-agent',
          sessionId: 'test-session',
        },
      };

      const generator = pearl.chatCompletion(request);
      
      // Manually iterate
      const result1 = await generator.next();
      expect(result1.done).toBe(false);
      expect(result1.value.choices[0].delta.content).toBe('X');

      const result2 = await generator.next();
      expect(result2.done).toBe(false);
      expect(result2.value.choices[0].delta.content).toBe('Y');

      const result3 = await generator.next();
      expect(result3.done).toBe(false);
      expect(result3.value.choices[0].delta.content).toBe('Z');

      const result4 = await generator.next();
      expect(result4.done).toBe(true);
    });

    it('should be usable with for-await-of', async () => {
      mockStreamConfig.chunks = ['1', '2', '3'];
      
      const request: ChatRequest = {
        model: 'pearl',
        messages: [
          { role: 'user', content: 'Test' }
        ],
        metadata: {
          agentId: 'test-agent',
          sessionId: 'test-session',
        },
      };

      const contents: string[] = [];
      for await (const chunk of pearl.chatCompletion(request)) {
        contents.push(chunk.choices[0].delta.content || '');
      }

      expect(contents).toEqual(['1', '2', '3']);
    });
  });
});
