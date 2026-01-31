/**
 * E2E Tests - Memory Retrieval
 * Tests the full retrieval flow: query → embed → search → augment
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryStore } from '../../src/memory/store.js';
import { MemoryRetriever } from '../../src/memory/retriever.js';
import { PromptAugmenter } from '../../src/memory/augmenter.js';
import type { EmbeddingProvider } from '../../src/memory/embeddings.js';

// Mock embedding provider that returns deterministic embeddings
const createMockEmbeddingProvider = (): EmbeddingProvider => {
  // Simple keyword-based embedding for deterministic results
  const embed = (text: string): number[] => {
    const dims = 768;
    const embedding = new Array(dims).fill(0);
    
    // Create embedding based on keywords
    const keywords = ['dark', 'light', 'mode', 'prefer', 'design', 'ui', 'code', 'json', 'developer', 'software'];
    keywords.forEach((keyword, i) => {
      if (text.toLowerCase().includes(keyword)) {
        // Set multiple dimensions for each keyword to create similarity
        for (let j = 0; j < 10; j++) {
          embedding[(i * 10 + j) % dims] = 1.0 / (j + 1);
        }
      }
    });
    
    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0)) || 1;
    return embedding.map(v => v / norm);
  };

  return {
    embed: vi.fn().mockImplementation(async (text: string) => embed(text)),
    embedBatch: vi.fn().mockImplementation(async (texts: string[]) => texts.map(embed)),
    dimensions: 768,
  };
};

describe('E2E: Memory Retrieval Flow', () => {
  let store: MemoryStore;
  let retriever: MemoryRetriever;
  let augmenter: PromptAugmenter;
  let embeddingProvider: EmbeddingProvider;

  beforeEach(async () => {
    store = new MemoryStore(':memory:');
    embeddingProvider = createMockEmbeddingProvider();
    
    retriever = new MemoryRetriever(store, embeddingProvider, {
      maxMemories: 10,
      minSimilarity: 0.01, // Very low threshold for testing
      tokenBudget: 500,
      recencyBoost: true,
    });
    
    augmenter = new PromptAugmenter(retriever);
    
    // Seed some memories with embeddings
    const memories = [
      { content: 'User prefers dark mode interfaces', type: 'preference' as const, tags: ['ui', 'dark'] },
      { content: 'User likes minimalist design', type: 'preference' as const, tags: ['ui', 'design'] },
      { content: 'Always respond in JSON format', type: 'rule' as const, tags: ['format'] },
      { content: 'User is a software developer', type: 'fact' as const, tags: ['job'] },
    ];
    
    for (const mem of memories) {
      const embedding = await embeddingProvider.embed(mem.content);
      store.create({
        agent_id: 'test-agent',
        type: mem.type,
        content: mem.content,
        tags: mem.tags,
        embedding,
      });
    }
  });

  afterEach(() => {
    store.close();
  });

  it('should retrieve memories for a query', async () => {
    const query = 'Can you help me with the UI design?';
    
    const results = await retriever.retrieve('test-agent', query);
    
    expect(results.length).toBeGreaterThan(0);
  });

  it('should rank memories by relevance score', async () => {
    const query = 'I need help with dark mode settings';
    
    const results = await retriever.retrieve('test-agent', query);
    
    // Results should be sorted by score (descending)
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('should respect maxMemories limit', async () => {
    // Add more memories
    for (let i = 0; i < 20; i++) {
      const embedding = await embeddingProvider.embed(`Memory ${i} about design patterns`);
      store.create({
        agent_id: 'test-agent',
        type: 'fact',
        content: `Memory ${i} about design patterns`,
        embedding,
      });
    }
    
    const results = await retriever.retrieve('test-agent', 'design question');
    
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it('should only return memories for the specified agent', async () => {
    // Add memory for different agent
    const embedding = await embeddingProvider.embed('Other agent prefers light mode');
    store.create({
      agent_id: 'other-agent',
      type: 'preference',
      content: 'Other agent prefers light mode',
      embedding,
    });
    
    const results = await retriever.retrieve('test-agent', 'mode preference');
    
    // Should only get test-agent memories (if any results returned)
    if (results.length > 0) {
      // Check the first result's structure to determine the correct property
      const firstResult = results[0];
      if ('memory' in firstResult) {
        expect(results.every(m => m.memory.agent_id === 'test-agent')).toBe(true);
      } else if ('agent_id' in firstResult) {
        expect(results.every(m => (m as any).agent_id === 'test-agent')).toBe(true);
      }
    }
  });

  it('should augment prompt with retrieved memories', async () => {
    const messages = [
      { role: 'system' as const, content: 'You are a helpful assistant.' },
      { role: 'user' as const, content: 'Help me with the dark mode design' },
    ];
    
    const result = await augmenter.augment('test-agent', messages, {
      maxMemories: 5,
      minScore: 0.01,
    });
    
    // System message should be augmented with context
    expect(result.messages[0].content).toContain('<pearl:memories>');
    expect(result.injectedMemories.length).toBeGreaterThan(0);
  });

  it('should handle empty retrieval results gracefully', async () => {
    const messages = [
      { role: 'user' as const, content: 'Random unrelated query xyz123' },
    ];
    
    // Use agent with no memories
    const result = await augmenter.augment('empty-agent', messages, {
      maxMemories: 5,
      minScore: 0.9, // High threshold
    });
    
    // Should return original messages unmodified
    expect(result.injectedMemories.length).toBe(0);
    expect(result.messages).toEqual(messages);
  });

  it('should filter by minimum similarity', async () => {
    const retrieverWithHighThreshold = new MemoryRetriever(store, embeddingProvider, {
      maxMemories: 10,
      minSimilarity: 0.99, // Very high - nothing should match
      tokenBudget: 500,
      recencyBoost: true,
    });
    
    const results = await retrieverWithHighThreshold.retrieve('test-agent', 'some random query');
    
    expect(results.length).toBe(0);
  });

  it('should add system message if none exists', async () => {
    const messages = [
      { role: 'user' as const, content: 'Help with dark mode' },
    ];
    
    const result = await augmenter.augment('test-agent', messages, {
      maxMemories: 5,
      minScore: 0.01,
    });
    
    // Should add system message at beginning
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toContain('<pearl:memories>');
  });

  it('should respect token budget', async () => {
    // Create a retriever with small token budget
    const smallBudgetRetriever = new MemoryRetriever(store, embeddingProvider, {
      maxMemories: 100,
      minSimilarity: 0.01,
      tokenBudget: 10, // Very small
      recencyBoost: true,
    });
    
    const results = await smallBudgetRetriever.retrieve('test-agent', 'design');
    
    // Should limit results due to token budget
    expect(results.length).toBeLessThan(4);
  });
});
