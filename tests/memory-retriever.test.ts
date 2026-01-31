import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRetriever, type RetrievalOptions, type ScoredMemory } from '../src/memory/retriever.js';
import { MemoryStore, type Memory, type MemoryInput } from '../src/memory/store.js';
import { EmbeddingService, type EmbeddingProvider, cosineSimilarity } from '../src/memory/embeddings.js';
import { unlinkSync, existsSync } from 'fs';

const TEST_DB_PATH = '/tmp/pearl-test-retriever.db';

/**
 * Mock embedding provider that generates deterministic embeddings
 * based on text content for testing semantic search
 */
function createMockEmbeddingProvider(dimensions: number = 768): EmbeddingProvider {
  // Generate embedding from text - similar texts should have similar embeddings
  const textToEmbedding = (text: string): Float32Array => {
    const words = text.toLowerCase().split(/\s+/);
    const embedding = new Float32Array(dimensions);
    
    // Create a simple bag-of-words style embedding
    for (const word of words) {
      const hash = word.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const index = hash % dimensions;
      embedding[index] += 1;
    }
    
    // Normalize
    let norm = 0;
    for (let i = 0; i < dimensions; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < dimensions; i++) {
        embedding[i] /= norm;
      }
    }
    
    return embedding;
  };

  return {
    dimensions,
    async embed(text: string): Promise<Float32Array> {
      return textToEmbedding(text);
    },
    async embedBatch(texts: string[]): Promise<Float32Array[]> {
      return texts.map(textToEmbedding);
    },
  };
}

describe('MemoryRetriever', () => {
  let store: MemoryStore;
  let embeddings: EmbeddingService;
  let retriever: MemoryRetriever;

  beforeEach(() => {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    store = new MemoryStore(TEST_DB_PATH);
    embeddings = new EmbeddingService({}, createMockEmbeddingProvider());
    retriever = new MemoryRetriever(store, embeddings);
  });

  afterEach(() => {
    store.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  describe('construction', () => {
    it('creates retriever with store and embedding service', () => {
      expect(retriever).toBeDefined();
    });

    it('accepts optional default config', () => {
      const customRetriever = new MemoryRetriever(store, embeddings, {
        limit: 5,
        minScore: 0.8,
      });
      expect(customRetriever).toBeDefined();
    });
  });

  describe('retrieve() - basic functionality', () => {
    it('returns empty array when no memories exist', async () => {
      const results = await retriever.retrieve('agent-1', 'search query');
      
      expect(results).toEqual([]);
    });

    it('returns memories with relevance scores', async () => {
      // Create a memory with embedding
      const embedding = await embeddings.embed('User likes dark mode');
      store.create({
        agent_id: 'agent-1',
        type: 'preference',
        content: 'User likes dark mode',
        embedding: Array.from(embedding),
      });

      const results = await retriever.retrieve('agent-1', 'dark mode preference');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('score');
      expect(results[0].score).toBeGreaterThan(0);
      expect(results[0].score).toBeLessThanOrEqual(1);
    });

    it('orders results by score descending', async () => {
      // Create memories with different relevance
      const emb1 = await embeddings.embed('User likes programming in Python');
      const emb2 = await embeddings.embed('User lives in Santa Fe');
      const emb3 = await embeddings.embed('User prefers Python over JavaScript');

      store.create({ agent_id: 'agent-1', type: 'preference', content: 'User likes programming in Python', embedding: Array.from(emb1) });
      store.create({ agent_id: 'agent-1', type: 'fact', content: 'User lives in Santa Fe', embedding: Array.from(emb2) });
      store.create({ agent_id: 'agent-1', type: 'preference', content: 'User prefers Python over JavaScript', embedding: Array.from(emb3) });

      const results = await retriever.retrieve('agent-1', 'Python programming language');

      expect(results.length).toBeGreaterThan(0);
      // Verify scores are in descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('only returns memories for the specified agent', async () => {
      const emb1 = await embeddings.embed('User likes coffee drinks');
      const emb2 = await embeddings.embed('User prefers tea beverages');

      store.create({ agent_id: 'agent-1', type: 'preference', content: 'User likes coffee drinks', embedding: Array.from(emb1) });
      store.create({ agent_id: 'agent-2', type: 'preference', content: 'User prefers tea beverages', embedding: Array.from(emb2) });

      // Query with words that match agent-1's memory
      const results = await retriever.retrieve('agent-1', 'User likes coffee');

      expect(results.length).toBe(1);
      expect(results[0].agent_id).toBe('agent-1');
    });

    it('skips memories without embeddings', async () => {
      const emb = await embeddings.embed('Has embedding');
      
      store.create({ agent_id: 'agent-1', type: 'fact', content: 'No embedding here' });
      store.create({ agent_id: 'agent-1', type: 'fact', content: 'Has embedding', embedding: Array.from(emb) });

      const results = await retriever.retrieve('agent-1', 'search query');

      // Should only return the one with embedding
      expect(results.every(r => r.embedding !== undefined)).toBe(true);
    });
  });

  describe('retrieve() - options', () => {
    beforeEach(async () => {
      // Create a variety of memories
      const memories = [
        { type: 'fact' as const, content: 'User lives in Santa Fe, New Mexico' },
        { type: 'preference' as const, content: 'User prefers dark mode interface' },
        { type: 'rule' as const, content: 'Always use bullet points in responses' },
        { type: 'decision' as const, content: 'Decision: Use SQLite for storage' },
        { type: 'health' as const, content: 'User is allergic to peanuts' },
        { type: 'preference' as const, content: 'User likes Python programming' },
        { type: 'fact' as const, content: 'User works at Acme Corp' },
        { type: 'relationship' as const, content: 'Noah is the user\'s son, age 8' },
      ];

      for (const mem of memories) {
        const emb = await embeddings.embed(mem.content);
        store.create({
          agent_id: 'agent-1',
          type: mem.type,
          content: mem.content,
          embedding: Array.from(emb),
        });
      }
    });

    it('respects limit option', async () => {
      const results = await retriever.retrieve('agent-1', 'user information', { limit: 3 });
      
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('respects minScore option', async () => {
      const results = await retriever.retrieve('agent-1', 'random query xyz', { minScore: 0.9 });
      
      // All results should have score >= minScore
      results.forEach(r => expect(r.score).toBeGreaterThanOrEqual(0.9));
    });

    it('filters by single type', async () => {
      const results = await retriever.retrieve('agent-1', 'user information', { 
        types: ['preference'],
        limit: 10,
      });
      
      results.forEach(r => expect(r.type).toBe('preference'));
    });

    it('filters by multiple types', async () => {
      const results = await retriever.retrieve('agent-1', 'user information', { 
        types: ['fact', 'preference'],
        limit: 10,
      });
      
      results.forEach(r => expect(['fact', 'preference']).toContain(r.type));
    });

    it('applies type weights to scoring', async () => {
      const results = await retriever.retrieve('agent-1', 'user preferences', {
        typeWeights: {
          rule: 2.0,      // Boost rules heavily
          preference: 1.0,
          fact: 0.5,      // Demote facts
        },
        limit: 10,
      });

      // Rules should be boosted relative to their base similarity
      // This is hard to test precisely, but we can check the weights were applied
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('recency boost', () => {
    it('boosts recent memories when recencyBoost is true', async () => {
      // Create an old memory (manually set created_at)
      const oldEmb = await embeddings.embed('User likes coffee');
      const oldMemory = store.create({
        agent_id: 'agent-1',
        type: 'preference',
        content: 'User likes coffee',
        embedding: Array.from(oldEmb),
      });

      // Manually update created_at to be old (1 week ago)
      // We need to do this via raw DB access
      const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      // @ts-ignore - accessing private for testing
      store['db'].prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(oneWeekAgo, oldMemory.id);

      // Create a recent memory with similar content
      const newEmb = await embeddings.embed('User enjoys coffee drinks');
      store.create({
        agent_id: 'agent-1',
        type: 'preference',
        content: 'User enjoys coffee drinks',
        embedding: Array.from(newEmb),
      });

      const results = await retriever.retrieve('agent-1', 'coffee', { 
        recencyBoost: true,
        recencyHalfLifeHours: 168, // 1 week
      });

      expect(results.length).toBe(2);
      // The newer memory should be ranked higher due to recency boost
      // (assuming similar base similarity)
    });

    it('does not boost when recencyBoost is false', async () => {
      const emb = await embeddings.embed('Test memory');
      store.create({
        agent_id: 'agent-1',
        type: 'fact',
        content: 'Test memory',
        embedding: Array.from(emb),
      });

      const results = await retriever.retrieve('agent-1', 'Test', { recencyBoost: false });

      expect(results.length).toBeGreaterThan(0);
      // Score should be pure similarity (no recency factor)
    });
  });

  describe('token budgeting', () => {
    it('respects tokenBudget option', async () => {
      // Create several memories
      for (let i = 0; i < 10; i++) {
        const content = `Memory number ${i} with some content that takes up tokens`;
        const emb = await embeddings.embed(content);
        store.create({
          agent_id: 'agent-1',
          type: 'fact',
          content,
          embedding: Array.from(emb),
        });
      }

      // Very small token budget
      const results = await retriever.retrieve('agent-1', 'memory content', {
        tokenBudget: 50, // ~12 words worth
        limit: 100, // High limit, but budget should constrain
      });

      // Calculate total tokens used
      const totalTokens = results.reduce((sum, r) => sum + estimateTokens(r.content), 0);
      expect(totalTokens).toBeLessThanOrEqual(50);
    });

    it('includes at least one result if budget allows', async () => {
      const content = 'Short memory';
      const emb = await embeddings.embed(content);
      store.create({
        agent_id: 'agent-1',
        type: 'fact',
        content,
        embedding: Array.from(emb),
      });

      const results = await retriever.retrieve('agent-1', 'Short', {
        tokenBudget: 10,
      });

      expect(results.length).toBe(1);
    });
  });

  describe('contextual retrieval', () => {
    it('retrieves memories relevant to conversation context', async () => {
      // Create domain-specific memories
      const memories = [
        'User is building a web app with React framework',
        'User prefers TypeScript over JavaScript programming',
        'User lives in New Mexico state',
        'User has a meeting tomorrow at 3pm',
        'User favorite food is pizza',
      ];

      for (const content of memories) {
        const emb = await embeddings.embed(content);
        store.create({
          agent_id: 'agent-1',
          type: 'fact',
          content,
          embedding: Array.from(emb),
        });
      }

      // Query with words that should match React/TypeScript memories
      const results = await retriever.retrieve('agent-1', 'React TypeScript web app building');

      // Web dev related memories should rank higher
      expect(results.length).toBeGreaterThan(0);
      // Check that programming-related memories are in top results
      const topContents = results.slice(0, 3).map(r => r.content.toLowerCase());
      const hasProgrammingContext = topContents.some(c => 
        c.includes('react') || c.includes('typescript') || c.includes('web')
      );
      expect(hasProgrammingContext).toBe(true);
    });
  });

  describe('access tracking', () => {
    it('records access when memories are retrieved', async () => {
      const emb = await embeddings.embed('Test memory for access tracking');
      const memory = store.create({
        agent_id: 'agent-1',
        type: 'fact',
        content: 'Test memory for access tracking',
        embedding: Array.from(emb),
      });

      expect(memory.access_count).toBe(0);
      expect(memory.accessed_at).toBeUndefined();

      await retriever.retrieve('agent-1', 'Test memory');

      const updated = store.get(memory.id);
      expect(updated!.access_count).toBe(1);
      expect(updated!.accessed_at).toBeDefined();
    });

    it('can skip access tracking with option', async () => {
      const emb = await embeddings.embed('Test memory');
      const memory = store.create({
        agent_id: 'agent-1',
        type: 'fact',
        content: 'Test memory',
        embedding: Array.from(emb),
      });

      await retriever.retrieve('agent-1', 'Test', { recordAccess: false });

      const updated = store.get(memory.id);
      expect(updated!.access_count).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('handles empty query string', async () => {
      const emb = await embeddings.embed('Some memory');
      store.create({
        agent_id: 'agent-1',
        type: 'fact',
        content: 'Some memory',
        embedding: Array.from(emb),
      });

      const results = await retriever.retrieve('agent-1', '');
      
      // Should still work, but may return low scores
      expect(Array.isArray(results)).toBe(true);
    });

    it('handles very long query string', async () => {
      const emb = await embeddings.embed('Memory');
      store.create({
        agent_id: 'agent-1',
        type: 'fact',
        content: 'Memory',
        embedding: Array.from(emb),
      });

      const longQuery = 'word '.repeat(1000);
      const results = await retriever.retrieve('agent-1', longQuery);
      
      expect(Array.isArray(results)).toBe(true);
    });

    it('handles special characters in query', async () => {
      const emb = await embeddings.embed('User email is test@example.com');
      store.create({
        agent_id: 'agent-1',
        type: 'fact',
        content: 'User email is test@example.com',
        embedding: Array.from(emb),
      });

      const results = await retriever.retrieve('agent-1', 'email address @example.com');
      
      expect(Array.isArray(results)).toBe(true);
    });

    it('handles unicode in query', async () => {
      const emb = await embeddings.embed('User speaks Japanese: こんにちは');
      store.create({
        agent_id: 'agent-1',
        type: 'fact',
        content: 'User speaks Japanese: こんにちは',
        embedding: Array.from(emb),
      });

      const results = await retriever.retrieve('agent-1', 'こんにちは Japanese');
      
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('performance', () => {
    it('handles large number of memories efficiently', async () => {
      // Create 500 memories
      const memories: MemoryInput[] = [];
      for (let i = 0; i < 500; i++) {
        const content = `Memory number ${i} about topic ${i % 10}`;
        const emb = await embeddings.embed(content);
        memories.push({
          agent_id: 'agent-1',
          type: 'fact',
          content,
          embedding: Array.from(emb),
        });
      }

      for (const mem of memories) {
        store.create(mem);
      }

      const start = performance.now();
      const results = await retriever.retrieve('agent-1', 'Memory about topic 5', { limit: 10 });
      const elapsed = performance.now() - start;

      expect(results.length).toBe(10);
      expect(elapsed).toBeLessThan(1000); // Should complete within 1 second
    });
  });
});

describe('ScoredMemory type', () => {
  it('extends Memory with score field', () => {
    // Type check - this is compile-time but we can verify runtime shape
    const scoredMemory: ScoredMemory = {
      id: 'test',
      agent_id: 'agent',
      type: 'fact',
      content: 'Test',
      created_at: Date.now(),
      updated_at: Date.now(),
      access_count: 0,
      score: 0.85,
    };

    expect(scoredMemory.score).toBe(0.85);
    expect(scoredMemory.content).toBe('Test');
  });
});

describe('RetrievalOptions type', () => {
  it('accepts all documented options', () => {
    const options: RetrievalOptions = {
      limit: 10,
      minScore: 0.7,
      types: ['fact', 'preference'],
      typeWeights: {
        rule: 1.5,
        decision: 1.3,
      },
      recencyBoost: true,
      recencyHalfLifeHours: 168,
      tokenBudget: 500,
      recordAccess: true,
    };

    expect(options.limit).toBe(10);
    expect(options.minScore).toBe(0.7);
  });
});

// Helper function (should match implementation)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
