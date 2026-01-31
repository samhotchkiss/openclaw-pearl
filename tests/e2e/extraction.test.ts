/**
 * E2E Tests - Memory Extraction
 * Tests the full extraction flow with mocked LLM responses
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryStore } from '../../src/memory/store.js';
import { MemoryExtractor } from '../../src/memory/extractor.js';
import type { LLMProvider, ExtractionResult, ExtractedMemory } from '../../src/memory/extractor.js';

// Create a mock LLM provider that returns deterministic results
const createMockLLMProvider = (): LLMProvider => ({
  extract: vi.fn().mockImplementation(async (message: string): Promise<ExtractionResult> => {
    const memories: ExtractedMemory[] = [];
    const lowerMsg = message.toLowerCase();
    
    if (lowerMsg.includes('prefer') || lowerMsg.includes('like')) {
      let preferenceContent = 'User has a preference';
      if (lowerMsg.includes('dark mode') || lowerMsg.includes('dark')) {
        preferenceContent = 'User prefers dark mode';
      } else if (lowerMsg.includes('light mode') || lowerMsg.includes('light')) {
        preferenceContent = 'User prefers light mode';
      } else if (lowerMsg.includes('vim')) {
        preferenceContent = 'User prefers vim over emacs';
      }
      memories.push({
        type: 'preference',
        content: preferenceContent,
        confidence: 0.9,
        tags: ['ui'],
      });
    }
    
    if (lowerMsg.includes('name is') || lowerMsg.includes('born')) {
      memories.push({
        type: 'fact',
        content: 'Personal fact about the user',
        confidence: 0.95,
        tags: ['personal'],
      });
    }
    
    if (lowerMsg.includes('always') || lowerMsg.includes('never') || lowerMsg.includes('should')) {
      memories.push({
        type: 'rule',
        content: 'Instruction for agent behavior',
        confidence: 0.85,
        tags: ['instruction'],
      });
    }
    
    return { memories };
  }),
});

describe('E2E: Memory Extraction Flow', () => {
  let store: MemoryStore;
  let extractor: MemoryExtractor;
  let mockProvider: LLMProvider;

  beforeEach(() => {
    store = new MemoryStore(':memory:');
    mockProvider = createMockLLMProvider();
    extractor = new MemoryExtractor({}, mockProvider);
  });

  afterEach(() => {
    store.close();
  });

  it('should extract and store preference memory', async () => {
    const message = 'I prefer dark mode interfaces';
    const agentId = 'test-agent';
    
    // Extract memories from message
    const result = await extractor.extract(message);
    
    // Should extract preference
    expect(result.memories.length).toBe(1);
    expect(result.memories[0].type).toBe('preference');
    
    // Store extracted memories
    for (const memory of result.memories) {
      store.create({
        agent_id: agentId,
        type: memory.type,
        content: memory.content,
        tags: memory.tags,
        confidence: memory.confidence,
      });
    }
    
    // Verify storage
    const memories = store.query({ agent_id: agentId, type: 'preference' });
    expect(memories.length).toBe(1);
    expect(memories[0].type).toBe('preference');
  });

  it('should extract and store fact memory', async () => {
    const message = 'My name is John';
    const agentId = 'test-agent';
    
    const result = await extractor.extract(message);
    
    expect(result.memories.length).toBe(1);
    expect(result.memories[0].type).toBe('fact');
    
    for (const memory of result.memories) {
      store.create({
        agent_id: agentId,
        type: memory.type,
        content: memory.content,
        tags: memory.tags,
      });
    }
    
    const memories = store.query({ agent_id: agentId, type: 'fact' });
    expect(memories.length).toBe(1);
  });

  it('should extract and store rule memory', async () => {
    const message = 'You should always respond in JSON format';
    const agentId = 'test-agent';
    
    const result = await extractor.extract(message);
    
    expect(result.memories.length).toBe(1);
    expect(result.memories[0].type).toBe('rule');
    
    for (const memory of result.memories) {
      store.create({
        agent_id: agentId,
        type: memory.type,
        content: memory.content,
        tags: memory.tags,
      });
    }
    
    const memories = store.query({ agent_id: agentId, type: 'rule' });
    expect(memories.length).toBe(1);
  });

  it('should not extract from non-memorable content', async () => {
    const message = 'Hello, how are you today?';
    const agentId = 'test-agent';
    
    const result = await extractor.extract(message);
    
    // No memories should be extracted
    expect(result.memories.length).toBe(0);
  });

  it('should isolate memories by agent', async () => {
    // Agent 1 extraction
    const result1 = await extractor.extract('I prefer light mode');
    expect(result1.memories.length).toBe(1);
    
    for (const memory of result1.memories) {
      store.create({
        agent_id: 'agent-1',
        type: memory.type,
        content: 'Light mode preference',
        tags: memory.tags,
      });
    }
    
    // Agent 2 extraction
    const result2 = await extractor.extract('I prefer dark mode');
    expect(result2.memories.length).toBe(1);
    
    for (const memory of result2.memories) {
      store.create({
        agent_id: 'agent-2',
        type: memory.type,
        content: 'Dark mode preference',
        tags: memory.tags,
      });
    }
    
    // Verify isolation
    const agent1Memories = store.query({ agent_id: 'agent-1' });
    const agent2Memories = store.query({ agent_id: 'agent-2' });
    
    expect(agent1Memories.length).toBe(1);
    expect(agent2Memories.length).toBe(1);
    expect(agent1Memories[0].content).toContain('Light');
    expect(agent2Memories[0].content).toContain('Dark');
  });

  it('should handle extraction errors gracefully', async () => {
    const failingProvider: LLMProvider = {
      extract: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
    };
    const failingExtractor = new MemoryExtractor({}, failingProvider);
    
    const result = await failingExtractor.extract('This is a test message that is long enough');
    
    // Should return empty memories on error, not throw
    expect(result.memories).toEqual([]);
  });

  it('should track source session when provided', async () => {
    const message = 'I prefer vim over emacs';
    const agentId = 'test-agent';
    const sessionId = 'session-123';
    
    const result = await extractor.extract(message);
    expect(result.memories.length).toBeGreaterThan(0);
    
    for (const memory of result.memories) {
      store.create({
        agent_id: agentId,
        type: memory.type,
        content: memory.content,
        tags: memory.tags,
        source_session: sessionId,
      });
    }
    
    const memories = store.query({ agent_id: agentId });
    expect(memories.length).toBeGreaterThan(0);
    expect(memories[0].source_session).toBe(sessionId);
  });
});
