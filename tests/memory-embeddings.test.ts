import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EmbeddingService,
  OllamaEmbeddingProvider,
  OpenAIEmbeddingProvider,
  createEmbeddingProvider,
  cosineSimilarity,
  type EmbeddingProvider,
  type EmbeddingProviderConfig,
} from '../src/memory/embeddings.js';

/**
 * Mock embedding provider for testing
 */
function createMockProvider(
  dimensions: number = 768,
  response?: (text: string) => Float32Array
): EmbeddingProvider {
  const defaultResponse = (_text: string) =>
    new Float32Array(Array.from({ length: dimensions }, (_, i) => Math.sin(i / 100)));

  return {
    dimensions,
    async embed(text: string): Promise<Float32Array> {
      return (response ?? defaultResponse)(text);
    },
    async embedBatch(texts: string[]): Promise<Float32Array[]> {
      return Promise.all(texts.map((t) => this.embed(t)));
    },
  };
}

describe('EmbeddingService', () => {
  describe('construction', () => {
    it('creates with default config (ollama)', () => {
      const service = new EmbeddingService();
      expect(service).toBeDefined();
    });

    it('creates with custom provider config', () => {
      const service = new EmbeddingService({
        provider: 'ollama',
        model: 'nomic-embed-text',
        baseUrl: 'http://localhost:11434',
      });
      expect(service).toBeDefined();
    });

    it('accepts custom embedding provider', () => {
      const mockProvider = createMockProvider();
      const service = new EmbeddingService({}, mockProvider);
      expect(service).toBeDefined();
    });
  });

  describe('embed()', () => {
    let service: EmbeddingService;
    let mockProvider: EmbeddingProvider;

    beforeEach(() => {
      mockProvider = createMockProvider(768);
      service = new EmbeddingService({}, mockProvider);
    });

    it('returns Float32Array for single text', async () => {
      const result = await service.embed('Hello world');

      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(768);
    });

    it('returns consistent embeddings for same text', async () => {
      // Same input should produce same output
      const result1 = await service.embed('Test content');
      const result2 = await service.embed('Test content');

      expect(result1).toEqual(result2);
    });

    it('returns different embeddings for different text', async () => {
      mockProvider = createMockProvider(768, (text) => {
        // Use text hash to generate different embeddings
        const hash = text.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
        return new Float32Array(
          Array.from({ length: 768 }, (_, i) => Math.sin((i + hash) / 100))
        );
      });
      service = new EmbeddingService({}, mockProvider);

      const result1 = await service.embed('Hello world');
      const result2 = await service.embed('Goodbye world');

      // At least some values should differ
      let different = false;
      for (let i = 0; i < result1.length; i++) {
        if (Math.abs(result1[i] - result2[i]) > 0.001) {
          different = true;
          break;
        }
      }
      expect(different).toBe(true);
    });

    it('handles empty string', async () => {
      const result = await service.embed('');

      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(768);
    });

    it('handles long text', async () => {
      const longText = 'word '.repeat(10000);
      const result = await service.embed(longText);

      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(768);
    });

    it('handles unicode text', async () => {
      const result = await service.embed('こんにちは世界 🌍');

      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(768);
    });
  });

  describe('embedBatch()', () => {
    let service: EmbeddingService;
    let mockProvider: EmbeddingProvider;

    beforeEach(() => {
      mockProvider = createMockProvider(768);
      service = new EmbeddingService({}, mockProvider);
    });

    it('returns array of Float32Arrays', async () => {
      const texts = ['Text one', 'Text two', 'Text three'];
      const results = await service.embedBatch(texts);

      expect(results).toHaveLength(3);
      results.forEach((r) => {
        expect(r).toBeInstanceOf(Float32Array);
        expect(r.length).toBe(768);
      });
    });

    it('returns empty array for empty input', async () => {
      const results = await service.embedBatch([]);

      expect(results).toEqual([]);
    });

    it('handles single item batch', async () => {
      const results = await service.embedBatch(['Only one']);

      expect(results).toHaveLength(1);
      expect(results[0]).toBeInstanceOf(Float32Array);
    });

    it('handles large batch', async () => {
      const texts = Array.from({ length: 100 }, (_, i) => `Text number ${i}`);
      const results = await service.embedBatch(texts);

      expect(results).toHaveLength(100);
    });

    it('preserves order of inputs', async () => {
      // Use mock that encodes position in embedding
      mockProvider = createMockProvider(768, (text) => {
        const num = parseInt(text.match(/\d+/)?.[0] ?? '0');
        return new Float32Array(
          Array.from({ length: 768 }, (_, i) => (i === 0 ? num : 0))
        );
      });
      service = new EmbeddingService({}, mockProvider);

      const texts = ['Text 1', 'Text 2', 'Text 3'];
      const results = await service.embedBatch(texts);

      expect(results[0][0]).toBe(1);
      expect(results[1][0]).toBe(2);
      expect(results[2][0]).toBe(3);
    });
  });

  describe('getDimensions()', () => {
    it('returns embedding dimensions from provider', () => {
      const mockProvider = createMockProvider(1536);
      const service = new EmbeddingService({}, mockProvider);

      expect(service.getDimensions()).toBe(1536);
    });

    it('returns default dimensions for ollama', () => {
      const mockProvider = createMockProvider(768);
      const service = new EmbeddingService({}, mockProvider);

      expect(service.getDimensions()).toBe(768);
    });
  });

  describe('error handling', () => {
    it('throws on provider error', async () => {
      const failingProvider: EmbeddingProvider = {
        dimensions: 768,
        async embed(_text: string): Promise<Float32Array> {
          throw new Error('Provider API error');
        },
        async embedBatch(_texts: string[]): Promise<Float32Array[]> {
          throw new Error('Provider API error');
        },
      };
      const service = new EmbeddingService({}, failingProvider);

      await expect(service.embed('test')).rejects.toThrow('Provider API error');
    });

    it('throws on batch provider error', async () => {
      const failingProvider: EmbeddingProvider = {
        dimensions: 768,
        async embed(_text: string): Promise<Float32Array> {
          throw new Error('Provider API error');
        },
        async embedBatch(_texts: string[]): Promise<Float32Array[]> {
          throw new Error('Batch API error');
        },
      };
      const service = new EmbeddingService({}, failingProvider);

      await expect(service.embedBatch(['test'])).rejects.toThrow('Batch API error');
    });
  });
});

describe('OllamaEmbeddingProvider', () => {
  describe('construction', () => {
    it('creates with default config', () => {
      const provider = new OllamaEmbeddingProvider();
      expect(provider).toBeDefined();
      expect(provider.dimensions).toBe(768); // nomic-embed-text default
    });

    it('creates with custom config', () => {
      const provider = new OllamaEmbeddingProvider({
        baseUrl: 'http://custom:11434',
        model: 'custom-model',
        dimensions: 1024,
      });
      expect(provider).toBeDefined();
      expect(provider.dimensions).toBe(1024);
    });
  });

  describe('embed() - mocked', () => {
    it('calls ollama API with correct format', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            embedding: Array.from({ length: 768 }, () => Math.random()),
          }),
      });
      global.fetch = mockFetch;

      const provider = new OllamaEmbeddingProvider();
      await provider.embed('Test text');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'nomic-embed-text',
            prompt: 'Test text',
          }),
        })
      );
    });

    it('returns Float32Array from API response', async () => {
      const mockEmbedding = Array.from({ length: 768 }, (_, i) => i / 768);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ embedding: mockEmbedding }),
      });

      const provider = new OllamaEmbeddingProvider();
      const result = await provider.embed('Test');

      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(768);
      expect(result[0]).toBeCloseTo(0, 5);
      expect(result[767]).toBeCloseTo(767 / 768, 5);
    });

    it('throws on API error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const provider = new OllamaEmbeddingProvider();

      await expect(provider.embed('Test')).rejects.toThrow('Ollama API error: 500');
    });

    it('throws on network error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const provider = new OllamaEmbeddingProvider();

      await expect(provider.embed('Test')).rejects.toThrow('Connection refused');
    });
  });

  describe('embedBatch() - mocked', () => {
    it('calls embed for each text', async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              embedding: Array.from({ length: 768 }, () => callCount),
            }),
        });
      });

      const provider = new OllamaEmbeddingProvider();
      const results = await provider.embedBatch(['Text 1', 'Text 2', 'Text 3']);

      expect(results).toHaveLength(3);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });
});

describe('OpenAIEmbeddingProvider', () => {
  describe('construction', () => {
    it('creates with API key', () => {
      const provider = new OpenAIEmbeddingProvider({ apiKey: 'test-key' });
      expect(provider).toBeDefined();
      expect(provider.dimensions).toBe(1536); // text-embedding-3-small default
    });

    it('creates with custom config', () => {
      const provider = new OpenAIEmbeddingProvider({
        apiKey: 'test-key',
        model: 'text-embedding-3-large',
        dimensions: 3072,
        baseUrl: 'https://custom.openai.com/v1',
      });
      expect(provider).toBeDefined();
      expect(provider.dimensions).toBe(3072);
    });

    it('throws without API key', () => {
      expect(() => new OpenAIEmbeddingProvider({} as any)).toThrow(
        'OpenAI API key is required'
      );
    });
  });

  describe('embed() - mocked', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('calls OpenAI API with correct format', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: Array.from({ length: 1536 }, () => Math.random()) }],
          }),
      });
      global.fetch = mockFetch;

      const provider = new OpenAIEmbeddingProvider({ apiKey: 'test-key' });
      await provider.embed('Test text');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-key',
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: 'Test text',
          }),
        })
      );
    });

    it('returns Float32Array from API response', async () => {
      const mockEmbedding = Array.from({ length: 1536 }, (_, i) => i / 1536);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: mockEmbedding }] }),
      });

      const provider = new OpenAIEmbeddingProvider({ apiKey: 'test-key' });
      const result = await provider.embed('Test');

      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(1536);
    });

    it('throws on API error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const provider = new OpenAIEmbeddingProvider({ apiKey: 'bad-key' });

      await expect(provider.embed('Test')).rejects.toThrow('OpenAI API error: 401');
    });
  });

  describe('embedBatch() - mocked', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('calls API with batch input', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              { embedding: Array.from({ length: 1536 }, () => 1) },
              { embedding: Array.from({ length: 1536 }, () => 2) },
            ],
          }),
      });
      global.fetch = mockFetch;

      const provider = new OpenAIEmbeddingProvider({ apiKey: 'test-key' });
      const results = await provider.embedBatch(['Text 1', 'Text 2']);

      expect(results).toHaveLength(2);
      // OpenAI supports batch in single request
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: ['Text 1', 'Text 2'],
          }),
        })
      );
    });

    it('returns embeddings in correct order', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              { index: 0, embedding: Array.from({ length: 1536 }, () => 0) },
              { index: 1, embedding: Array.from({ length: 1536 }, () => 1) },
            ],
          }),
      });

      const provider = new OpenAIEmbeddingProvider({ apiKey: 'test-key' });
      const results = await provider.embedBatch(['First', 'Second']);

      expect(results[0][0]).toBe(0);
      expect(results[1][0]).toBe(1);
    });
  });
});

describe('createEmbeddingProvider', () => {
  it('creates Ollama provider by default', () => {
    const provider = createEmbeddingProvider({});
    expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
  });

  it('creates Ollama provider explicitly', () => {
    const provider = createEmbeddingProvider({ provider: 'ollama' });
    expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
  });

  it('creates OpenAI provider', () => {
    const provider = createEmbeddingProvider({
      provider: 'openai',
      apiKey: 'test-key',
    });
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
  });

  it('throws for OpenAI without API key', () => {
    expect(() => createEmbeddingProvider({ provider: 'openai' })).toThrow(
      'OpenAI API key is required'
    );
  });

  it('passes config to Ollama provider', () => {
    const provider = createEmbeddingProvider({
      provider: 'ollama',
      baseUrl: 'http://custom:11434',
      model: 'custom-model',
      dimensions: 1024,
    });
    expect(provider.dimensions).toBe(1024);
  });

  it('passes config to OpenAI provider', () => {
    const provider = createEmbeddingProvider({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'text-embedding-3-large',
      dimensions: 3072,
    });
    expect(provider.dimensions).toBe(3072);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const vec = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1, 5);
  });

  it('returns -1 for opposite vectors', () => {
    const vec1 = new Float32Array([1, 0, 0]);
    const vec2 = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(-1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    const vec1 = new Float32Array([1, 0, 0]);
    const vec2 = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(0, 5);
  });

  it('handles normalized vectors', () => {
    // Unit vectors
    const vec1 = new Float32Array([1, 0]);
    const vec2 = new Float32Array([Math.SQRT1_2, Math.SQRT1_2]); // 45 degrees
    expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('handles non-normalized vectors', () => {
    const vec1 = new Float32Array([2, 0, 0]);
    const vec2 = new Float32Array([3, 0, 0]);
    expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(1, 5);
  });

  it('handles large vectors efficiently', () => {
    const size = 1536;
    const vec1 = new Float32Array(Array.from({ length: size }, () => Math.random()));
    const vec2 = new Float32Array(Array.from({ length: size }, () => Math.random()));

    const start = performance.now();
    const result = cosineSimilarity(vec1, vec2);
    const elapsed = performance.now() - start;

    expect(result).toBeGreaterThanOrEqual(-1);
    expect(result).toBeLessThanOrEqual(1);
    expect(elapsed).toBeLessThan(10); // Should be fast
  });

  it('handles number arrays', () => {
    const vec1 = [0.1, 0.2, 0.3];
    const vec2 = [0.1, 0.2, 0.3];
    expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(1, 5);
  });

  it('returns 0 for zero vectors', () => {
    const vec1 = new Float32Array([0, 0, 0]);
    const vec2 = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(vec1, vec2)).toBe(0);
  });

  it('throws for mismatched dimensions', () => {
    const vec1 = new Float32Array([1, 2, 3]);
    const vec2 = new Float32Array([1, 2]);
    expect(() => cosineSimilarity(vec1, vec2)).toThrow('dimension');
  });
});

describe('Embedding Provider Config', () => {
  describe('Ollama config', () => {
    it('uses default model: nomic-embed-text', () => {
      const provider = new OllamaEmbeddingProvider();
      expect(provider.dimensions).toBe(768);
    });

    it('uses default baseUrl: localhost:11434', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ embedding: Array.from({ length: 768 }, () => 0) }),
      });
      global.fetch = mockFetch;

      const provider = new OllamaEmbeddingProvider();
      await provider.embed('test');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/embeddings',
        expect.anything()
      );
    });
  });

  describe('OpenAI config', () => {
    it('uses default model: text-embedding-3-small', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ data: [{ embedding: Array.from({ length: 1536 }, () => 0) }] }),
      });
      global.fetch = mockFetch;

      const provider = new OpenAIEmbeddingProvider({ apiKey: 'test' });
      await provider.embed('test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('text-embedding-3-small'),
        })
      );
    });

    it('uses default baseUrl: api.openai.com/v1', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ data: [{ embedding: Array.from({ length: 1536 }, () => 0) }] }),
      });
      global.fetch = mockFetch;

      const provider = new OpenAIEmbeddingProvider({ apiKey: 'test' });
      await provider.embed('test');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.anything()
      );
    });
  });
});
