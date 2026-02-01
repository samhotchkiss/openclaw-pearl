/**
 * Integration test for memory storage with embeddings and semantic search
 * Tests the full pipeline: memory creation -> embedding generation -> semantic retrieval
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore, type MemoryInput } from '../../src/memory/store.js';
import { EmbeddingService } from '../../src/memory/embeddings.js';
import { MemoryRetriever } from '../../src/memory/retriever.js';
import { unlinkSync, existsSync } from 'fs';

const TEST_DB_PATH = '/tmp/pearl-embedding-integration-test.db';

describe('Memory + Embedding Integration', () => {
  let store: MemoryStore;
  let embeddingService: EmbeddingService;
  let retriever: MemoryRetriever;

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }

    store = new MemoryStore(TEST_DB_PATH);
    embeddingService = new EmbeddingService({
      provider: 'ollama',
      model: 'nomic-embed-text',
      baseUrl: 'http://localhost:11434',
    });
    retriever = new MemoryRetriever(store, embeddingService);
  });

  afterEach(() => {
    store.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  describe('End-to-End Memory Flow', () => {
    it('should store memories with embeddings and retrieve them semantically', async () => {
      const agentId = 'test-agent';

      // Create test memories with embeddings
      const testMemories = [
        { content: 'User loves Italian food, especially pizza', type: 'preference' as const },
        { content: 'User lives in Santa Fe, New Mexico', type: 'fact' as const },
        { content: 'User prefers coffee over tea in the morning', type: 'preference' as const },
        { content: 'User enjoys hiking and outdoor activities', type: 'preference' as const },
      ];

      // Generate embeddings and store memories
      for (const memory of testMemories) {
        const embedding = await embeddingService.embed(memory.content);
        
        const memoryInput: MemoryInput = {
          agent_id: agentId,
          type: memory.type,
          content: memory.content,
          embedding: Array.from(embedding), // Convert Float32Array to number[]
        };

        const created = store.create(memoryInput);
        expect(created).toBeDefined();
        expect(created.embedding).toBeDefined();
        expect(created.embedding).toHaveLength(768); // nomic-embed-text dimensions
      }

      // Test semantic search for food preferences
      const searchQuery = 'What kind of food does the user enjoy?';
      const searchEmbedding = await embeddingService.embed(searchQuery);
      
      const foodMemories = await retriever.retrieve(
        agentId,
        searchQuery,
        { limit: 5, minScore: 0.1 }
      );

      // Should find the Italian food memory as most relevant
      expect(foodMemories.length).toBeGreaterThan(0);
      expect(foodMemories[0].content).toContain('Italian food');
      expect(foodMemories[0].score).toBeGreaterThan(0.3);

      // Test location search
      const locationQuery = 'Where does the user live?';
      const locationMemories = await retriever.retrieve(
        agentId,
        locationQuery,
        { limit: 1, minScore: 0.1 }
      );

      expect(locationMemories).toHaveLength(1);
      expect(locationMemories[0].content).toContain('Santa Fe');
    });

    it('should handle memories without embeddings gracefully', async () => {
      const agentId = 'test-agent';

      // Create memory without embedding
      const memoryWithoutEmbedding: MemoryInput = {
        agent_id: agentId,
        type: 'fact',
        content: 'User has a cat named Whiskers',
      };

      const created = store.create(memoryWithoutEmbedding);
      expect(created).toBeDefined();
      expect(created.embedding).toBeUndefined();

      // Should still be able to query, but won't find this memory semantically
      const searchQuery = 'Tell me about pets';
      const results = await retriever.retrieve(
        agentId,
        searchQuery,
        { limit: 5, minScore: 0.1 }
      );

      // Should return empty results since no memories have embeddings for comparison
      expect(results).toHaveLength(0);
    });

    it('should filter by memory type during semantic search', async () => {
      const agentId = 'test-agent';

      // Create memories of different types
      const memories = [
        { content: 'User loves pizza', type: 'preference' as const },
        { content: 'User decided to go to Italy next summer', type: 'decision' as const },
        { content: 'User lives in New York', type: 'fact' as const },
      ];

      // Store all memories with embeddings
      for (const memory of memories) {
        const embedding = await embeddingService.embed(memory.content);
        const memoryInput: MemoryInput = {
          agent_id: agentId,
          type: memory.type,
          content: memory.content,
          embedding: Array.from(embedding),
        };
        store.create(memoryInput);
      }

      // Search specifically for preferences
      const preferenceResults = await retriever.retrieve(
        agentId,
        'What does the user like?',
        { limit: 5, minScore: 0.1, types: ['preference'] }
      );

      expect(preferenceResults).toHaveLength(1);
      expect(preferenceResults[0].content).toContain('pizza');
      expect(preferenceResults[0].type).toBe('preference');

      // Search specifically for facts
      const factResults = await retriever.retrieve(
        agentId,
        'Where does the user live?',
        { limit: 5, minScore: 0.1, types: ['fact'] }
      );

      expect(factResults).toHaveLength(1);
      expect(factResults[0].content).toContain('New York');
      expect(factResults[0].type).toBe('fact');
    });

    it('should respect similarity threshold in semantic search', async () => {
      const agentId = 'test-agent';

      // Create a memory about pets
      const embedding = await embeddingService.embed('User has a dog named Rex');
      const memoryInput: MemoryInput = {
        agent_id: agentId,
        type: 'fact',
        content: 'User has a dog named Rex',
        embedding: Array.from(embedding),
      };
      store.create(memoryInput);

      // Search for something completely unrelated with high threshold
      const unrelatedResults = await retriever.retrieve(
        agentId,
        'What is the weather like on Mars?',
        { limit: 5, minScore: 0.8 } // High threshold
      );

      // Should return no results due to low similarity
      expect(unrelatedResults).toHaveLength(0);

      // Search with low threshold should find the memory
      const lowThresholdResults = await retriever.retrieve(
        agentId,
        'What is the weather like on Mars?',
        { limit: 5, minScore: 0.0 } // Very low threshold
      );

      expect(lowThresholdResults).toHaveLength(1);
    });
  });

  describe('Performance and Error Handling', () => {
    it('should handle embedding generation failures during memory creation', async () => {
      const agentId = 'test-agent';

      // Create embedding service with bad config to trigger failure
      const badEmbeddingService = new EmbeddingService({
        provider: 'ollama',
        model: 'nonexistent-model',
        baseUrl: 'http://localhost:11434',
      });

      // Should be able to store memory without embedding when embedding fails
      const memoryInput: MemoryInput = {
        agent_id: agentId,
        type: 'fact',
        content: 'Test content',
        // Don't pre-generate embedding - let the retriever handle the failure
      };

      const created = store.create(memoryInput);
      expect(created).toBeDefined();
      expect(created.embedding).toBeUndefined();

      // Search should handle the lack of embeddings gracefully
      const badRetriever = new MemoryRetriever(store, badEmbeddingService);
      
      // This should not throw, but should return empty results
      const results = await badRetriever.retrieve(
        agentId,
        'test query',
        { limit: 5, minScore: 0.1 }
      );

      expect(results).toHaveLength(0);
    });

    it('should handle large batches of memories efficiently', async () => {
      const agentId = 'test-agent';
      const numMemories = 20;

      // Create many memories with embeddings
      const startTime = Date.now();

      for (let i = 0; i < numMemories; i++) {
        const content = `Test memory ${i} about various topics like ${i % 3 === 0 ? 'food' : i % 3 === 1 ? 'travel' : 'hobbies'}`;
        const embedding = await embeddingService.embed(content);
        
        const memoryInput: MemoryInput = {
          agent_id: agentId,
          type: 'fact',
          content,
          embedding: Array.from(embedding),
        };
        store.create(memoryInput);
      }

      const creationTime = Date.now() - startTime;
      console.log(`Created ${numMemories} memories with embeddings in ${creationTime}ms`);

      // Should handle search across many memories efficiently
      const searchStart = Date.now();
      const results = await retriever.retrieve(
        agentId,
        'tell me about food',
        { limit: 5, minScore: 0.1 }
      );
      const searchTime = Date.now() - searchStart;

      console.log(`Searched ${numMemories} memories in ${searchTime}ms`);

      expect(results.length).toBeGreaterThan(0);
      expect(searchTime).toBeLessThan(1000); // Should search quickly
    });
  });
});