/**
 * Test Memory Extractor Error Handling
 * Specific tests for provider creation and error propagation
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MemoryExtractor, createProvider, OllamaProvider, type LLMProviderConfig } from '../../src/memory/extractor.js';

describe('Memory Extractor Error Handling', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should create OllamaProvider when provider is ollama', () => {
    const config: LLMProviderConfig = {
      provider: 'ollama',
      model: 'llama3.2:3b',
      baseUrl: 'http://localhost:11434',
    };

    const provider = createProvider(config);
    
    // Should be an OllamaProvider, not DefaultLLMProvider
    expect(provider).toBeInstanceOf(OllamaProvider);
  });

  it('should propagate Ollama API errors through MemoryExtractor', async () => {
    // Mock fetch to simulate 500 error
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
    const result = await extractor.extract('My name is Alice and I prefer coffee over tea every morning');

    expect(result.memories).toHaveLength(0);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Ollama API error: 500');
  });

  it('should propagate JSON parsing errors through MemoryExtractor', async () => {
    // Mock fetch to return invalid JSON
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: 'this is not valid JSON' }),
    });

    const config: LLMProviderConfig = {
      provider: 'ollama',
      model: 'llama3.2:3b',
      baseUrl: 'http://localhost:11434',
    };

    const extractor = new MemoryExtractor(config);
    const result = await extractor.extract('I work at Google and my favorite programming language is TypeScript');

    expect(result.memories).toHaveLength(0);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('JSON');
  });
});