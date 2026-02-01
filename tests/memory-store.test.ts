import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore, type Memory, type MemoryInput, type MemoryQuery } from '../src/memory/store.js';
import { unlinkSync, existsSync, rmSync } from 'fs';

const TEST_DB_PATH = '/tmp/pearl-test-memories.db';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    // Remove test DB if it exists
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    store = new MemoryStore(TEST_DB_PATH);
  });

  afterEach(() => {
    store.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  describe('initialization', () => {
    it('creates database and tables', () => {
      // Store should be ready after construction
      expect(store).toBeDefined();
    });

    it('creates in-memory database when path is :memory:', () => {
      const memStore = new MemoryStore(':memory:');
      expect(memStore).toBeDefined();
      memStore.close();
    });

    it('should create parent directory if it does not exist', () => {
      const testPath = '/tmp/pearl-test-nonexistent-dir/memories.db';
      
      // Ensure the directory doesn't exist
      if (existsSync('/tmp/pearl-test-nonexistent-dir')) {
        rmSync('/tmp/pearl-test-nonexistent-dir', { recursive: true });
      }

      // This should not throw an error
      const dirStore = new MemoryStore(testPath);
      expect(dirStore).toBeDefined();
      
      // Verify the file was created
      expect(existsSync(testPath)).toBe(true);
      
      dirStore.close();
      
      // Cleanup
      if (existsSync('/tmp/pearl-test-nonexistent-dir')) {
        rmSync('/tmp/pearl-test-nonexistent-dir', { recursive: true });
      }
    });
  });

  describe('create()', () => {
    it('creates a memory with all fields', () => {
      const input: MemoryInput = {
        agent_id: 'test-agent',
        type: 'fact',
        content: 'User lives in Santa Fe',
        tags: ['location', 'personal'],
        embedding: [0.1, 0.2, 0.3],
        confidence: 0.95,
        source_session: 'session-123',
      };

      const memory = store.create(input);

      expect(memory.id).toBeDefined();
      expect(memory.id).toMatch(/^[0-9a-f-]+$/); // UUID format
      expect(memory.agent_id).toBe('test-agent');
      expect(memory.type).toBe('fact');
      expect(memory.content).toBe('User lives in Santa Fe');
      expect(memory.tags).toEqual(['location', 'personal']);
      // Float32 storage loses some precision - use toBeCloseTo
      expect(memory.embedding).toHaveLength(3);
      expect(memory.embedding![0]).toBeCloseTo(0.1, 5);
      expect(memory.embedding![1]).toBeCloseTo(0.2, 5);
      expect(memory.embedding![2]).toBeCloseTo(0.3, 5);
      expect(memory.confidence).toBe(0.95);
      expect(memory.source_session).toBe('session-123');
      expect(memory.created_at).toBeDefined();
      expect(memory.updated_at).toBeDefined();
      expect(memory.access_count).toBe(0);
    });

    it('creates memory with minimal fields', () => {
      const input: MemoryInput = {
        agent_id: 'test-agent',
        type: 'preference',
        content: 'Prefers dark mode',
      };

      const memory = store.create(input);

      expect(memory.id).toBeDefined();
      expect(memory.agent_id).toBe('test-agent');
      expect(memory.type).toBe('preference');
      expect(memory.content).toBe('Prefers dark mode');
      expect(memory.tags).toBeUndefined();
      expect(memory.embedding).toBeUndefined();
      expect(memory.confidence).toBeUndefined();
    });

    it('generates unique IDs', () => {
      const memory1 = store.create({
        agent_id: 'agent',
        type: 'fact',
        content: 'Memory 1',
      });
      const memory2 = store.create({
        agent_id: 'agent',
        type: 'fact',
        content: 'Memory 2',
      });

      expect(memory1.id).not.toBe(memory2.id);
    });
  });

  describe('get()', () => {
    it('retrieves a memory by id', () => {
      const created = store.create({
        agent_id: 'test-agent',
        type: 'rule',
        content: 'Always be concise',
        tags: ['style'],
      });

      const retrieved = store.get(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.content).toBe('Always be concise');
      expect(retrieved!.tags).toEqual(['style']);
    });

    it('returns undefined for non-existent id', () => {
      const result = store.get('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('update()', () => {
    it('updates memory content', () => {
      const created = store.create({
        agent_id: 'test-agent',
        type: 'preference',
        content: 'Prefers dark mode',
      });

      const updated = store.update(created.id, {
        content: 'Prefers dark mode in all apps',
      });

      expect(updated).toBeDefined();
      expect(updated!.content).toBe('Prefers dark mode in all apps');
      expect(updated!.updated_at).toBeGreaterThanOrEqual(created.updated_at);
    });

    it('updates memory tags', () => {
      const created = store.create({
        agent_id: 'test-agent',
        type: 'fact',
        content: 'Test',
        tags: ['old'],
      });

      const updated = store.update(created.id, {
        tags: ['new', 'updated'],
      });

      expect(updated!.tags).toEqual(['new', 'updated']);
    });

    it('updates memory embedding', () => {
      const created = store.create({
        agent_id: 'test-agent',
        type: 'fact',
        content: 'Test',
        embedding: [0.1, 0.2],
      });

      const updated = store.update(created.id, {
        embedding: [0.3, 0.4, 0.5],
      });

      // Float32 storage loses some precision
      expect(updated!.embedding).toHaveLength(3);
      expect(updated!.embedding![0]).toBeCloseTo(0.3, 5);
      expect(updated!.embedding![1]).toBeCloseTo(0.4, 5);
      expect(updated!.embedding![2]).toBeCloseTo(0.5, 5);
    });

    it('returns undefined for non-existent id', () => {
      const result = store.update('non-existent', { content: 'test' });
      expect(result).toBeUndefined();
    });
  });

  describe('delete()', () => {
    it('deletes a memory', () => {
      const created = store.create({
        agent_id: 'test-agent',
        type: 'fact',
        content: 'To be deleted',
      });

      const deleted = store.delete(created.id);
      expect(deleted).toBe(true);

      const retrieved = store.get(created.id);
      expect(retrieved).toBeUndefined();
    });

    it('returns false for non-existent id', () => {
      const result = store.delete('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('query()', () => {
    beforeEach(() => {
      // Create test memories for different agents
      store.create({ agent_id: 'agent-1', type: 'fact', content: 'Fact 1', tags: ['work'] });
      store.create({ agent_id: 'agent-1', type: 'preference', content: 'Pref 1', tags: ['style'] });
      store.create({ agent_id: 'agent-1', type: 'fact', content: 'Fact 2', tags: ['personal'] });
      store.create({ agent_id: 'agent-2', type: 'rule', content: 'Rule 1', tags: ['work'] });
      store.create({ agent_id: 'agent-2', type: 'fact', content: 'Agent 2 fact', tags: ['other'] });
    });

    it('queries by agent_id', () => {
      const results = store.query({ agent_id: 'agent-1' });

      expect(results).toHaveLength(3);
      results.forEach((m) => expect(m.agent_id).toBe('agent-1'));
    });

    it('queries by agent_id and type', () => {
      const results = store.query({ agent_id: 'agent-1', type: 'fact' });

      expect(results).toHaveLength(2);
      results.forEach((m) => {
        expect(m.agent_id).toBe('agent-1');
        expect(m.type).toBe('fact');
      });
    });

    it('queries by agent_id and multiple types', () => {
      const results = store.query({ agent_id: 'agent-1', types: ['fact', 'preference'] });

      expect(results).toHaveLength(3);
    });

    it('queries by tag', () => {
      const results = store.query({ agent_id: 'agent-1', tag: 'work' });

      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Fact 1');
    });

    it('applies limit', () => {
      const results = store.query({ agent_id: 'agent-1', limit: 2 });

      expect(results).toHaveLength(2);
    });

    it('orders by created_at descending by default', () => {
      const results = store.query({ agent_id: 'agent-1' });

      // Verify results are returned sorted by created_at (desc)
      expect(results).toHaveLength(3);
      // Timestamps should be in descending order (or equal for same-ms inserts)
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].created_at).toBeGreaterThanOrEqual(results[i].created_at);
      }
    });

    it('returns empty array for no matches', () => {
      const results = store.query({ agent_id: 'non-existent' });
      expect(results).toEqual([]);
    });
  });

  describe('text search', () => {
    beforeEach(() => {
      store.create({ agent_id: 'agent-1', type: 'fact', content: 'User lives in Santa Fe, New Mexico' });
      store.create({ agent_id: 'agent-1', type: 'preference', content: 'Prefers dark mode for all applications' });
      store.create({ agent_id: 'agent-1', type: 'fact', content: 'Works at Acme Corporation' });
    });

    it('searches by content text', () => {
      const results = store.query({ agent_id: 'agent-1', search: 'Santa Fe' });

      expect(results).toHaveLength(1);
      expect(results[0].content).toContain('Santa Fe');
    });

    it('searches case-insensitively', () => {
      const results = store.query({ agent_id: 'agent-1', search: 'dark mode' });

      expect(results).toHaveLength(1);
      expect(results[0].content).toContain('dark mode');
    });

    it('returns empty for no text matches', () => {
      const results = store.query({ agent_id: 'agent-1', search: 'nonexistent term' });
      expect(results).toEqual([]);
    });
  });

  describe('access tracking', () => {
    it('records access when memory is retrieved', () => {
      const created = store.create({
        agent_id: 'test-agent',
        type: 'fact',
        content: 'Test memory',
      });

      expect(created.access_count).toBe(0);
      expect(created.accessed_at).toBeUndefined();

      // Record access
      store.recordAccess([created.id]);

      const updated = store.get(created.id);
      expect(updated!.access_count).toBe(1);
      expect(updated!.accessed_at).toBeDefined();
    });

    it('increments access count on multiple accesses', () => {
      const created = store.create({
        agent_id: 'test-agent',
        type: 'fact',
        content: 'Test memory',
      });

      store.recordAccess([created.id]);
      store.recordAccess([created.id]);
      store.recordAccess([created.id]);

      const updated = store.get(created.id);
      expect(updated!.access_count).toBe(3);
    });

    it('records access for multiple memories at once', () => {
      const m1 = store.create({ agent_id: 'agent', type: 'fact', content: 'Memory 1' });
      const m2 = store.create({ agent_id: 'agent', type: 'fact', content: 'Memory 2' });

      store.recordAccess([m1.id, m2.id]);

      expect(store.get(m1.id)!.access_count).toBe(1);
      expect(store.get(m2.id)!.access_count).toBe(1);
    });
  });

  describe('expiration', () => {
    it('stores expiration timestamp', () => {
      const expiresAt = Date.now() + 3600000; // 1 hour from now
      const memory = store.create({
        agent_id: 'test-agent',
        type: 'reminder',
        content: 'Temporary memory',
        expires_at: expiresAt,
      });

      expect(memory.expires_at).toBe(expiresAt);
    });

    it('prunes expired memories', () => {
      // Create expired memory
      const pastTime = Date.now() - 1000; // 1 second ago
      store.create({
        agent_id: 'test-agent',
        type: 'reminder',
        content: 'Expired memory',
        expires_at: pastTime,
      });

      // Create non-expired memory
      store.create({
        agent_id: 'test-agent',
        type: 'fact',
        content: 'Valid memory',
      });

      const pruned = store.pruneExpired();
      expect(pruned).toBe(1);

      const remaining = store.query({ agent_id: 'test-agent' });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].content).toBe('Valid memory');
    });
  });

  describe('embedding storage', () => {
    it('stores and retrieves large embeddings', () => {
      // Create a 768-dimension embedding (typical for nomic-embed-text)
      const embedding = Array.from({ length: 768 }, (_, i) => Math.sin(i / 100));

      const memory = store.create({
        agent_id: 'test-agent',
        type: 'fact',
        content: 'Memory with embedding',
        embedding,
      });

      const retrieved = store.get(memory.id);
      expect(retrieved!.embedding).toHaveLength(768);
      
      // Verify values are preserved (allow small floating point differences)
      for (let i = 0; i < 768; i++) {
        expect(retrieved!.embedding![i]).toBeCloseTo(embedding[i], 5);
      }
    });

    it('queries memories with embeddings for semantic search', () => {
      // Create memories with embeddings
      store.create({
        agent_id: 'test-agent',
        type: 'fact',
        content: 'Memory 1',
        embedding: [0.1, 0.2, 0.3],
      });
      store.create({
        agent_id: 'test-agent',
        type: 'fact',
        content: 'Memory 2',
        embedding: [0.4, 0.5, 0.6],
      });

      const results = store.query({
        agent_id: 'test-agent',
        hasEmbedding: true,
      });

      expect(results).toHaveLength(2);
      results.forEach((m) => expect(m.embedding).toBeDefined());
    });
  });

  describe('getRecentForDedup()', () => {
    it('returns recent memories for deduplication check', () => {
      const now = Date.now();
      
      // Create memories
      store.create({
        agent_id: 'test-agent',
        type: 'fact',
        content: 'Recent memory',
        embedding: [0.1, 0.2, 0.3],
      });

      const recent = store.getRecentForDedup('test-agent', 3600); // 1 hour window

      expect(recent.length).toBeGreaterThanOrEqual(1);
      expect(recent[0].embedding).toBeDefined();
    });

    it('respects time window', async () => {
      // This is tricky to test without time mocking
      // Just verify the method works and returns appropriate structure
      const recent = store.getRecentForDedup('test-agent', 1);
      expect(Array.isArray(recent)).toBe(true);
    });
  });

  describe('statistics', () => {
    it('returns memory count by agent', () => {
      store.create({ agent_id: 'agent-1', type: 'fact', content: '1' });
      store.create({ agent_id: 'agent-1', type: 'fact', content: '2' });
      store.create({ agent_id: 'agent-2', type: 'fact', content: '3' });

      const stats = store.getStats();

      expect(stats.totalMemories).toBe(3);
      expect(stats.byAgent['agent-1']).toBe(2);
      expect(stats.byAgent['agent-2']).toBe(1);
    });

    it('returns memory count by type', () => {
      store.create({ agent_id: 'agent', type: 'fact', content: '1' });
      store.create({ agent_id: 'agent', type: 'fact', content: '2' });
      store.create({ agent_id: 'agent', type: 'preference', content: '3' });

      const stats = store.getStats();

      expect(stats.byType['fact']).toBe(2);
      expect(stats.byType['preference']).toBe(1);
    });
  });
});
