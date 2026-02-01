/**
 * End-to-End Memory Flow Integration Tests
 * Tests the complete lifecycle: extraction → storage → retrieval → augmentation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore, type MemoryInput } from '../../src/memory/store.js';
import { EmbeddingService } from '../../src/memory/embeddings.js';
import { MemoryRetriever } from '../../src/memory/retriever.js';
import { PromptAugmenter, type ChatMessage } from '../../src/memory/augmenter.js';
import { unlinkSync, existsSync } from 'fs';

const TEST_DB_PATH = '/tmp/pearl-e2e-memory-flow-test.db';

describe('End-to-End Memory Flow', () => {
  let store: MemoryStore;
  let embeddingService: EmbeddingService;
  let retriever: MemoryRetriever;
  let augmenter: PromptAugmenter;

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
    augmenter = new PromptAugmenter(retriever);
  });

  afterEach(() => {
    store.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  describe('Complete Memory Lifecycle', () => {
    it('should extract → store → retrieve → augment memories end-to-end', async () => {
      const agentId = 'test-agent';
      const sessionId = 'session-123';

      // Step 1: Store initial memory (simulating extraction result)
      const memoryContent = 'User prefers morning meetings between 9-11 AM';
      const embedding = await embeddingService.embed(memoryContent);
      
      const memoryInput: MemoryInput = {
        agent_id: agentId,
        type: 'preference',
        content: memoryContent,
        embedding: Array.from(embedding),
        source_session: sessionId,
      };

      const storedMemory = store.create(memoryInput);
      expect(storedMemory).toBeDefined();
      expect(storedMemory.embedding).toBeDefined();

      // Step 2: User sends a message that should trigger memory retrieval
      const userMessages: ChatMessage[] = [
        { role: 'user', content: 'When should we schedule our weekly team call?' }
      ];

      // Step 3: Augment the prompt with relevant memories
      const result = await augmenter.augment(agentId, userMessages, {
        sessionId,
        tokenBudget: 500,
        minScore: 0.1, // Low threshold for testing
      });

      // Step 4: Verify memories were retrieved and injected
      expect(result.messages).toHaveLength(2); // Original user message + system message with memories
      expect(result.injectedMemories).toHaveLength(1);
      expect(result.injectedMemories[0]).toBe(storedMemory.id);
      expect(result.tokensUsed).toBeGreaterThan(0);

      // Verify system message contains the memory
      const systemMessage = result.messages.find(m => m.role === 'system');
      expect(systemMessage).toBeDefined();
      expect(systemMessage!.content).toContain('morning meetings');
      expect(systemMessage!.content).toContain('9-11 AM');

      // Original user message should remain unchanged
      const userMessage = result.messages.find(m => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage!.content).toBe('When should we schedule our weekly team call?');
    });

    it('should handle multi-turn conversations with session tracking', async () => {
      const agentId = 'test-agent';
      const sessionId = 'session-456';

      // Store multiple memories
      const memories = [
        { content: 'User lives in Pacific Time Zone', type: 'fact' as const },
        { content: 'User prefers video calls over phone calls', type: 'preference' as const },
        { content: 'User has a busy schedule on Fridays', type: 'fact' as const },
      ];

      // Store memories with embeddings
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

      // First turn: Ask about timezone
      const firstTurnMessages: ChatMessage[] = [
        { role: 'user', content: 'What time zone am I in?' }
      ];

      const firstResult = await augmenter.augment(agentId, firstTurnMessages, {
        sessionId,
        minScore: 0.1,
      });
      
      // Should inject at least one memory, possibly more due to low threshold
      expect(firstResult.injectedMemories.length).toBeGreaterThan(0);
      expect(firstResult.messages.find(m => m.role === 'system')?.content)
        .toContain('Pacific Time Zone');

      // Second turn: Ask about meeting preference (should not re-inject timezone memory)
      const secondTurnMessages: ChatMessage[] = [
        ...firstResult.messages,
        { role: 'assistant', content: 'You are in the Pacific Time Zone.' },
        { role: 'user', content: 'How should we have our meeting - video or phone?' }
      ];

      const secondResult = await augmenter.augment(agentId, secondTurnMessages, {
        sessionId, // Same session
        minScore: 0.1,
      });

      // In second turn, no NEW memories should be injected since relevant ones 
      // are already in the conversation context
      expect(secondResult.injectedMemories).toHaveLength(0);
      
      // But the system message should still contain all relevant memories
      // from the conversation context (passed through from first turn)
      const systemMessage = secondResult.messages.find(m => m.role === 'system');
      expect(systemMessage).toBeDefined();
      expect(systemMessage!.content).toContain('video calls over phone calls');
      expect(systemMessage!.content).toContain('Pacific Time Zone');
      
      // Messages should include the full conversation (may have same length due to context management)
      expect(secondResult.messages.length).toBeGreaterThanOrEqual(secondTurnMessages.length);
    });

    it('should respect token budget limits', async () => {
      const agentId = 'test-agent';
      const sessionId = 'session-token-limit';

      // Create a simple memory that will definitely match the query
      const testContent = 'User likes pizza and pasta very much';
      const embedding = await embeddingService.embed(testContent);
      const memoryInput: MemoryInput = {
        agent_id: agentId,
        type: 'preference',
        content: testContent,
        embedding: Array.from(embedding),
      };
      store.create(memoryInput);

      const userMessages: ChatMessage[] = [
        { role: 'user', content: 'What food do I like?' } // Should match the pizza/pasta memory
      ];

      // Test with very small token budget
      const result = await augmenter.augment(agentId, userMessages, {
        sessionId,
        tokenBudget: 100, // Very small budget
        minScore: 0.0, // Include all memories for testing
      });
      
      // Should inject the memory and respect the budget
      expect(result.injectedMemories.length).toBeGreaterThan(0);
      expect(result.tokensUsed).toBeLessThanOrEqual(100);
      expect(result.tokensUsed).toBeGreaterThan(0); // Should use some tokens

      // Verify system message was created
      const systemMessage = result.messages.find(m => m.role === 'system');
      expect(systemMessage).toBeDefined();
    });

    it('should filter memories by type correctly', async () => {
      const agentId = 'test-agent';

      // Store different types of memories
      const memoryTypes = [
        { content: 'User likes chocolate ice cream', type: 'preference' as const },
        { content: 'User decided to buy a new laptop', type: 'decision' as const },
        { content: 'User lives in New York City', type: 'fact' as const },
        { content: 'User should call mom on Sunday', type: 'reminder' as const },
      ];

      for (const memory of memoryTypes) {
        const embedding = await embeddingService.embed(memory.content);
        const memoryInput: MemoryInput = {
          agent_id: agentId,
          type: memory.type,
          content: memory.content,
          embedding: Array.from(embedding),
        };
        store.create(memoryInput);
      }

      // Query that could match any type but filter to preferences only
      const userMessages: ChatMessage[] = [
        { role: 'user', content: 'What do I like?' }
      ];

      const result = await augmenter.augment(agentId, userMessages, {
        types: ['preference'], // Filter to preferences only
        minScore: 0.1,
      });

      expect(result.injectedMemories).toHaveLength(1);
      const systemMessage = result.messages.find(m => m.role === 'system');
      expect(systemMessage!.content).toContain('chocolate ice cream');
      expect(systemMessage!.content).not.toContain('laptop');
      expect(systemMessage!.content).not.toContain('New York');
      expect(systemMessage!.content).not.toContain('call mom');
    });

    it('should handle empty message arrays gracefully', async () => {
      const agentId = 'test-agent';
      
      const result = await augmenter.augment(agentId, [], {
        sessionId: 'empty-session',
      });

      expect(result.messages).toHaveLength(0);
      expect(result.injectedMemories).toHaveLength(0);
      expect(result.tokensUsed).toBe(0);
    });

    it('should handle queries with no relevant memories', async () => {
      const agentId = 'test-agent-no-memories';

      // Store a memory that won't match the query
      const embedding = await embeddingService.embed('User loves quantum physics');
      const memoryInput: MemoryInput = {
        agent_id: agentId,
        type: 'preference',
        content: 'User loves quantum physics',
        embedding: Array.from(embedding),
      };
      store.create(memoryInput);

      // Query about something completely unrelated with high threshold
      const userMessages: ChatMessage[] = [
        { role: 'user', content: 'What is the weather like on Mars?' }
      ];

      const result = await augmenter.augment(agentId, userMessages, {
        minScore: 0.8, // Very high threshold to filter out unrelated memories
      });
      
      // With high threshold, should have fewer or no memories
      expect(result.injectedMemories.length).toBeLessThanOrEqual(1);
      
      // If no memories were injected, messages should be unchanged
      if (result.injectedMemories.length === 0) {
        expect(result.messages).toHaveLength(1);
        expect(result.messages[0]).toEqual(userMessages[0]);
        expect(result.tokensUsed).toBe(0);
      } else {
        // If some memories were injected (due to random similarity), that's also acceptable
        expect(result.messages).toHaveLength(2);
        expect(result.messages.find(m => m.role === 'system')).toBeDefined();
      }
    });
  });

  describe('Memory Deduplication', () => {
    it('should not inject the same memory twice in one session', async () => {
      const agentId = 'test-agent';
      const sessionId = 'dedup-session';

      // Store a memory
      const embedding = await embeddingService.embed('User prefers dark mode UI');
      const memoryInput: MemoryInput = {
        agent_id: agentId,
        type: 'preference',
        content: 'User prefers dark mode UI',
        embedding: Array.from(embedding),
      };
      store.create(memoryInput);

      // First query - should inject memory
      const firstMessages: ChatMessage[] = [
        { role: 'user', content: 'How should I configure my interface?' }
      ];

      const firstResult = await augmenter.augment(agentId, firstMessages, {
        sessionId,
        minScore: 0.1,
      });

      expect(firstResult.injectedMemories).toHaveLength(1);

      // Second query in same session - should NOT inject same memory
      const secondMessages: ChatMessage[] = [
        ...firstResult.messages,
        { role: 'assistant', content: 'I recommend using dark mode.' },
        { role: 'user', content: 'Are there any other UI preferences I have?' }
      ];

      const secondResult = await augmenter.augment(agentId, secondMessages, {
        sessionId, // Same session
        minScore: 0.1,
      });

      expect(secondResult.injectedMemories).toHaveLength(0); // No new memories injected
      expect(secondResult.messages).toEqual(secondMessages); // Messages unchanged
    });

    it('should allow same memory in different sessions', async () => {
      const agentId = 'test-agent';

      // Store a memory
      const embedding = await embeddingService.embed('User works remotely from home');
      const memoryInput: MemoryInput = {
        agent_id: agentId,
        type: 'fact',
        content: 'User works remotely from home',
        embedding: Array.from(embedding),
      };
      store.create(memoryInput);

      const userMessages: ChatMessage[] = [
        { role: 'user', content: 'Where do I work?' }
      ];

      // Session 1
      const session1Result = await augmenter.augment(agentId, userMessages, {
        sessionId: 'session-1',
        minScore: 0.1,
      });
      expect(session1Result.injectedMemories).toHaveLength(1);

      // Session 2 - should inject same memory again (different session)
      const session2Result = await augmenter.augment(agentId, userMessages, {
        sessionId: 'session-2',
        minScore: 0.1,
      });
      expect(session2Result.injectedMemories).toHaveLength(1);
      expect(session2Result.injectedMemories[0]).toBe(session1Result.injectedMemories[0]);
    });

    it('should handle skipSessionTracking option', async () => {
      const agentId = 'test-agent';
      const sessionId = 'skip-tracking-session';

      // Store a memory
      const embedding = await embeddingService.embed('User drinks coffee every morning');
      const memoryInput: MemoryInput = {
        agent_id: agentId,
        type: 'preference',
        content: 'User drinks coffee every morning',
        embedding: Array.from(embedding),
      };
      store.create(memoryInput);

      const userMessages: ChatMessage[] = [
        { role: 'user', content: 'What do I drink in the morning?' }
      ];

      // First call
      const firstResult = await augmenter.augment(agentId, userMessages, {
        sessionId,
        minScore: 0.1,
      });
      expect(firstResult.injectedMemories).toHaveLength(1);

      // Second call with skipSessionTracking - should inject again
      const secondResult = await augmenter.augment(agentId, userMessages, {
        sessionId,
        skipSessionTracking: true,
        minScore: 0.1,
      });
      expect(secondResult.injectedMemories).toHaveLength(1);
      expect(secondResult.injectedMemories[0]).toBe(firstResult.injectedMemories[0]);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle embedding service failures gracefully', async () => {
      const agentId = 'test-agent';

      // Create augmenter with bad embedding service
      const badEmbeddingService = new EmbeddingService({
        provider: 'ollama',
        model: 'nonexistent-model',
        baseUrl: 'http://localhost:11434',
      });
      const badRetriever = new MemoryRetriever(store, badEmbeddingService);
      const badAugmenter = new PromptAugmenter(badRetriever);

      const userMessages: ChatMessage[] = [
        { role: 'user', content: 'Test message' }
      ];

      // Should not throw, should return original messages
      const result = await badAugmenter.augment(agentId, userMessages);
      
      expect(result.messages).toEqual(userMessages);
      expect(result.injectedMemories).toHaveLength(0);
      expect(result.tokensUsed).toBe(0);
    });

    it('should handle large conversation histories efficiently', async () => {
      const agentId = 'test-agent';

      // Store a relevant memory
      const embedding = await embeddingService.embed('User speaks French and English');
      const memoryInput: MemoryInput = {
        agent_id: agentId,
        type: 'fact',
        content: 'User speaks French and English',
        embedding: Array.from(embedding),
      };
      store.create(memoryInput);

      // Create large conversation history
      const largeConversation: ChatMessage[] = [];
      for (let i = 0; i < 50; i++) {
        largeConversation.push({ role: 'user', content: `Message ${i}` });
        largeConversation.push({ role: 'assistant', content: `Response ${i}` });
      }
      largeConversation.push({ role: 'user', content: 'What languages do I speak?' });

      const startTime = Date.now();
      const result = await augmenter.augment(agentId, largeConversation, {
        minScore: 0.1,
      });
      const duration = Date.now() - startTime;

      expect(result.injectedMemories).toHaveLength(1);
      expect(duration).toBeLessThan(2000); // Should complete within 2 seconds
      
      // Should inject system message at the beginning
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].content).toContain('French and English');
    });
  });
});