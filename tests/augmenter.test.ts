/**
 * Prompt Augmenter Tests
 *
 * Tests for the memory-augmented prompt injection system
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PromptAugmenter,
  type AugmentOptions,
  type AugmentResult,
  type ChatMessage,
  type MemoryRetrieverInterface,
  formatMemoriesForInjection,
  estimateTokens,
} from '../src/memory/augmenter.js';
import type { ScoredMemory } from '../src/memory/retriever.js';
import type { MemoryType } from '../src/memory/store.js';

// ====== Mock Setup ======

/**
 * Create a mock memory for testing
 */
function createMockMemory(
  id: string,
  content: string,
  type: MemoryType = 'fact',
  score: number = 0.8
): ScoredMemory {
  return {
    id,
    agent_id: 'test-agent',
    type,
    content,
    score,
    created_at: Date.now() - 1000 * 60 * 60, // 1 hour ago
    updated_at: Date.now() - 1000 * 60 * 60,
    access_count: 0,
  };
}

/**
 * Create a mock retriever that returns specified memories
 */
function createMockRetriever(memories: ScoredMemory[] = []): MemoryRetrieverInterface {
  return {
    retrieve: vi.fn().mockResolvedValue(memories),
  };
}

// ====== Utility Function Tests ======

describe('estimateTokens', () => {
  it('should estimate tokens at ~4 chars per token', () => {
    expect(estimateTokens('hello')).toBe(2); // 5 chars = 1.25 → 2
    expect(estimateTokens('hello world')).toBe(3); // 11 chars = 2.75 → 3
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBe(1);
  });

  it('should handle long text', () => {
    const longText = 'a'.repeat(400);
    expect(estimateTokens(longText)).toBe(100);
  });
});

describe('formatMemoriesForInjection', () => {
  it('should format empty memories to empty string', () => {
    expect(formatMemoriesForInjection([])).toBe('');
  });

  it('should format single memory', () => {
    const memories = [createMockMemory('1', 'User prefers dark mode', 'preference')];
    const result = formatMemoriesForInjection(memories);

    expect(result).toContain('User prefers dark mode');
    expect(result).toContain('<pearl:memories>');
    expect(result).toContain('</pearl:memories>');
  });

  it('should format multiple memories', () => {
    const memories = [
      createMockMemory('1', 'User prefers dark mode', 'preference'),
      createMockMemory('2', 'User timezone is America/Denver', 'fact'),
      createMockMemory('3', 'Always use bullet points', 'rule'),
    ];
    const result = formatMemoriesForInjection(memories);

    expect(result).toContain('User prefers dark mode');
    expect(result).toContain('User timezone is America/Denver');
    expect(result).toContain('Always use bullet points');
  });

  it('should include memory type indicator for decisions', () => {
    const memories = [
      createMockMemory('1', 'Use SQLite for storage', 'decision'),
    ];
    const result = formatMemoriesForInjection(memories);

    expect(result).toContain('[Decision]');
    expect(result).toContain('Use SQLite for storage');
  });

  it('should include memory type indicator for rules', () => {
    const memories = [
      createMockMemory('1', 'Never send emails without asking', 'rule'),
    ];
    const result = formatMemoriesForInjection(memories);

    expect(result).toContain('[Rule]');
  });
});

// ====== PromptAugmenter Class Tests ======

describe('PromptAugmenter', () => {
  let augmenter: PromptAugmenter;
  let mockRetriever: MemoryRetrieverInterface & { retrieve: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockRetriever = createMockRetriever() as MemoryRetrieverInterface & { retrieve: ReturnType<typeof vi.fn> };
    augmenter = new PromptAugmenter(mockRetriever);
  });

  describe('augment()', () => {
    it('should return unchanged messages when no memories found', async () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello!' },
      ];

      mockRetriever.retrieve.mockResolvedValue([]);

      const result = await augmenter.augment('test-agent', messages);

      expect(result.messages).toEqual(messages);
      expect(result.injectedMemories).toEqual([]);
      expect(result.tokensUsed).toBe(0);
    });

    it('should prepend memories to system message', async () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Help me with design.' },
      ];

      const memories = [
        createMockMemory('1', 'User prefers dark mode', 'preference'),
      ];
      mockRetriever.retrieve.mockResolvedValue(memories);

      const result = await augmenter.augment('test-agent', messages);

      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].content).toContain('<pearl:memories>');
      expect(result.messages[0].content).toContain('User prefers dark mode');
      expect(result.messages[0].content).toContain('You are helpful.');
      expect(result.injectedMemories).toEqual(['1']);
    });

    it('should create system message if none exists', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello!' },
      ];

      const memories = [
        createMockMemory('1', 'User likes concise answers', 'preference'),
      ];
      mockRetriever.retrieve.mockResolvedValue(memories);

      const result = await augmenter.augment('test-agent', messages);

      expect(result.messages.length).toBe(2);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].content).toContain('User likes concise answers');
    });

    it('should track injected memories to avoid duplicates', async () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'First question' },
      ];

      const memories = [
        createMockMemory('1', 'User prefers dark mode', 'preference'),
        createMockMemory('2', 'User timezone is MST', 'fact'),
      ];
      mockRetriever.retrieve.mockResolvedValue(memories);

      // First augmentation
      const result1 = await augmenter.augment('test-agent', messages, {
        sessionId: 'session-1',
      });
      expect(result1.injectedMemories).toEqual(['1', '2']);

      // Second augmentation with same session - should filter already-injected
      const result2 = await augmenter.augment('test-agent', messages, {
        sessionId: 'session-1',
      });
      expect(result2.injectedMemories).toEqual([]);
      expect(result2.messages[0].content).not.toContain('<pearl:memories>');
    });

    it('should inject memories for different sessions independently', async () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ];

      const memories = [createMockMemory('1', 'User prefers dark mode')];
      mockRetriever.retrieve.mockResolvedValue(memories);

      // Session 1
      const result1 = await augmenter.augment('test-agent', messages, {
        sessionId: 'session-1',
      });
      expect(result1.injectedMemories).toEqual(['1']);

      // Session 2 (different session) - should still inject
      const result2 = await augmenter.augment('test-agent', messages, {
        sessionId: 'session-2',
      });
      expect(result2.injectedMemories).toEqual(['1']);
    });

    it('should respect token budget', async () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ];

      // Create memories that exceed budget
      const memories = [
        createMockMemory('1', 'Short memory', 'fact', 0.9),
        createMockMemory('2', 'A'.repeat(400), 'fact', 0.8), // ~100 tokens
        createMockMemory('3', 'Another memory', 'fact', 0.7),
      ];
      mockRetriever.retrieve.mockResolvedValue(memories);

      const result = await augmenter.augment('test-agent', messages, {
        tokenBudget: 50, // Only allow ~50 tokens
      });

      // Should only include memories that fit within budget
      expect(result.tokensUsed).toBeLessThanOrEqual(50);
    });

    it('should use user message content for retrieval query', async () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Help me with dark mode design' },
        { role: 'assistant', content: 'Sure!' },
        { role: 'user', content: 'Use a purple theme' },
      ];

      mockRetriever.retrieve.mockResolvedValue([]);

      await augmenter.augment('test-agent', messages);

      // Should use the last user message as the query
      expect(mockRetriever.retrieve).toHaveBeenCalledWith(
        'test-agent',
        expect.stringContaining('Use a purple theme'),
        expect.any(Object)
      );
    });

    it('should combine recent user messages for query context', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'I need help with my website' },
        { role: 'assistant', content: 'Sure!' },
        { role: 'user', content: 'Specifically the login page' },
      ];

      mockRetriever.retrieve.mockResolvedValue([]);

      await augmenter.augment('test-agent', messages, {
        queryContextMessages: 2, // Include last 2 user messages
      });

      expect(mockRetriever.retrieve).toHaveBeenCalledWith(
        'test-agent',
        expect.stringContaining('login page'),
        expect.any(Object)
      );
    });

    it('should report tokens used in result', async () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ];

      const memories = [
        createMockMemory('1', 'User prefers dark mode', 'preference'),
      ];
      mockRetriever.retrieve.mockResolvedValue(memories);

      const result = await augmenter.augment('test-agent', messages);

      expect(result.tokensUsed).toBeGreaterThan(0);
    });

    it('should pass retrieval options to retriever', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      mockRetriever.retrieve.mockResolvedValue([]);

      await augmenter.augment('test-agent', messages, {
        maxMemories: 5,
        minScore: 0.5,
        types: ['preference', 'rule'],
      });

      expect(mockRetriever.retrieve).toHaveBeenCalledWith(
        'test-agent',
        expect.any(String),
        expect.objectContaining({
          limit: 5,
          minScore: 0.5,
          types: ['preference', 'rule'],
        })
      );
    });
  });

  describe('clearSession()', () => {
    it('should clear tracked memories for a session', async () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ];

      const memories = [createMockMemory('1', 'User prefers dark mode')];
      mockRetriever.retrieve.mockResolvedValue(memories);

      // First call
      await augmenter.augment('test-agent', messages, {
        sessionId: 'session-1',
      });

      // Clear session
      augmenter.clearSession('session-1');

      // Second call should inject again
      const result = await augmenter.augment('test-agent', messages, {
        sessionId: 'session-1',
      });

      expect(result.injectedMemories).toEqual(['1']);
    });
  });

  describe('clearAllSessions()', () => {
    it('should clear all tracked sessions', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const memories = [createMockMemory('1', 'Memory 1')];
      mockRetriever.retrieve.mockResolvedValue(memories);

      await augmenter.augment('test-agent', messages, { sessionId: 's1' });
      await augmenter.augment('test-agent', messages, { sessionId: 's2' });

      augmenter.clearAllSessions();

      // Both sessions should inject again
      const r1 = await augmenter.augment('test-agent', messages, { sessionId: 's1' });
      const r2 = await augmenter.augment('test-agent', messages, { sessionId: 's2' });

      expect(r1.injectedMemories).toEqual(['1']);
      expect(r2.injectedMemories).toEqual(['1']);
    });
  });

  describe('getSessionStats()', () => {
    it('should return stats for a session', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const memories = [
        createMockMemory('1', 'Memory 1'),
        createMockMemory('2', 'Memory 2'),
      ];
      mockRetriever.retrieve.mockResolvedValue(memories);

      await augmenter.augment('test-agent', messages, { sessionId: 'session-1' });

      const stats = augmenter.getSessionStats('session-1');

      expect(stats).toEqual({
        injectedCount: 2,
        memoryIds: ['1', '2'],
      });
    });

    it('should return empty stats for unknown session', () => {
      const stats = augmenter.getSessionStats('unknown');

      expect(stats).toEqual({
        injectedCount: 0,
        memoryIds: [],
      });
    });
  });
});

// ====== Edge Cases ======

describe('Edge cases', () => {
  let augmenter: PromptAugmenter;
  let mockRetriever: MemoryRetrieverInterface & { retrieve: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockRetriever = createMockRetriever() as MemoryRetrieverInterface & { retrieve: ReturnType<typeof vi.fn> };
    augmenter = new PromptAugmenter(mockRetriever);
  });

  it('should handle empty message array', async () => {
    const result = await augmenter.augment('test-agent', []);

    expect(result.messages).toEqual([]);
    expect(result.injectedMemories).toEqual([]);
  });

  it('should handle messages with only assistant responses', async () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', content: 'Hello!' },
    ];

    mockRetriever.retrieve.mockResolvedValue([]);

    const result = await augmenter.augment('test-agent', messages);

    // Should still work, just won't have a good query
    expect(result.messages).toBeDefined();
  });

  it('should preserve message order', async () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'User 1' },
      { role: 'assistant', content: 'Assistant 1' },
      { role: 'user', content: 'User 2' },
    ];

    const memories = [createMockMemory('1', 'Memory')];
    mockRetriever.retrieve.mockResolvedValue(memories);

    const result = await augmenter.augment('test-agent', messages);

    expect(result.messages.length).toBe(4);
    expect(result.messages[1].role).toBe('user');
    expect(result.messages[1].content).toBe('User 1');
    expect(result.messages[3].role).toBe('user');
    expect(result.messages[3].content).toBe('User 2');
  });

  it('should handle very long system messages', async () => {
    const longSystemMessage = 'A'.repeat(10000);
    const messages: ChatMessage[] = [
      { role: 'system', content: longSystemMessage },
      { role: 'user', content: 'Hello' },
    ];

    const memories = [createMockMemory('1', 'Memory')];
    mockRetriever.retrieve.mockResolvedValue(memories);

    const result = await augmenter.augment('test-agent', messages);

    expect(result.messages[0].content).toContain(longSystemMessage);
    expect(result.messages[0].content).toContain('<pearl:memories>');
  });

  it('should not mutate original messages array', async () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Original' },
      { role: 'user', content: 'Hello' },
    ];
    const originalSystemContent = messages[0].content;

    const memories = [createMockMemory('1', 'Memory')];
    mockRetriever.retrieve.mockResolvedValue(memories);

    await augmenter.augment('test-agent', messages);

    expect(messages[0].content).toBe(originalSystemContent);
  });
});
