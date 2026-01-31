import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteUsageStore } from '../src/usage/sqlite-store.js';
import type { UsageRecord } from '../src/usage/types.js';
import { unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';

describe('SQLiteUsageStore', () => {
  let store: SQLiteUsageStore;
  const testDbPath = ':memory:'; // Use in-memory database for tests

  beforeEach(() => {
    store = new SQLiteUsageStore(testDbPath);
  });

  afterEach(() => {
    store.close();
  });

  describe('Record Storage and Retrieval', () => {
    it('should save and retrieve a usage record', async () => {
      const record: UsageRecord = {
        id: 'test-record-1',
        accountId: 'account-1',
        agentId: 'agent-1',
        model: 'claude-3-sonnet',
        provider: 'anthropic',
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150
        },
        cost: 0.0025,
        timestamp: new Date('2024-01-15T10:30:00Z'),
        metadata: {
          type: 'general',
          complexity: 'medium',
          sensitive: false,
          sessionId: 'session-123'
        }
      };

      await store.save(record);

      const retrieved = await store.query({ accountId: 'account-1' });
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0]).toEqual(record);
    });

    it('should handle records without metadata', async () => {
      const record: UsageRecord = {
        id: 'test-record-2',
        accountId: 'account-2',
        model: 'gpt-4',
        provider: 'openai',
        usage: {
          promptTokens: 200,
          completionTokens: 100,
          totalTokens: 300
        },
        cost: 0.006,
        timestamp: new Date('2024-01-15T11:00:00Z')
      };

      await store.save(record);

      const retrieved = await store.query({ accountId: 'account-2' });
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0]).toEqual(record);
    });

    it('should handle custom metadata', async () => {
      const record: UsageRecord = {
        id: 'test-record-3',
        accountId: 'account-3',
        model: 'claude-3-sonnet',
        provider: 'anthropic',
        usage: {
          promptTokens: 150,
          completionTokens: 75,
          totalTokens: 225
        },
        cost: 0.00375,
        timestamp: new Date('2024-01-15T12:00:00Z'),
        metadata: {
          type: 'code',
          complexity: 'high',
          sensitive: true,
          sessionId: 'session-456',
          customField: 'customValue',
          nestedObject: { key: 'value' }
        }
      };

      await store.save(record);

      const retrieved = await store.query({ accountId: 'account-3' });
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0]).toEqual(record);
    });
  });

  describe('Querying', () => {
    beforeEach(async () => {
      // Insert test data
      const records: UsageRecord[] = [
        {
          id: 'record-1',
          accountId: 'account-1',
          agentId: 'agent-1',
          model: 'claude-3-sonnet',
          provider: 'anthropic',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          cost: 0.0025,
          timestamp: new Date('2024-01-15T10:00:00Z'),
          metadata: { type: 'general', complexity: 'low' }
        },
        {
          id: 'record-2',
          accountId: 'account-1',
          agentId: 'agent-2',
          model: 'gpt-4',
          provider: 'openai',
          usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
          cost: 0.006,
          timestamp: new Date('2024-01-15T11:00:00Z'),
          metadata: { type: 'code', complexity: 'high', sensitive: true }
        },
        {
          id: 'record-3',
          accountId: 'account-2',
          agentId: 'agent-1',
          model: 'claude-3-haiku',
          provider: 'anthropic',
          usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
          cost: 0.000125,
          timestamp: new Date('2024-01-16T09:00:00Z'),
          metadata: { type: 'creative', complexity: 'medium' }
        }
      ];

      for (const record of records) {
        await store.save(record);
      }
    });

    it('should query by account ID', async () => {
      const results = await store.query({ accountId: 'account-1' });
      expect(results).toHaveLength(2);
      expect(results.every(r => r.accountId === 'account-1')).toBe(true);
    });

    it('should query by agent ID', async () => {
      const results = await store.query({ agentId: 'agent-1' });
      expect(results).toHaveLength(2);
      expect(results.every(r => r.agentId === 'agent-1')).toBe(true);
    });

    it('should query by provider', async () => {
      const results = await store.query({ provider: 'anthropic' });
      expect(results).toHaveLength(2);
      expect(results.every(r => r.provider === 'anthropic')).toBe(true);
    });

    it('should query by model', async () => {
      const results = await store.query({ model: 'claude-3-sonnet' });
      expect(results).toHaveLength(1);
      expect(results[0].model).toBe('claude-3-sonnet');
    });

    it('should query by date range', async () => {
      const startDate = new Date('2024-01-15T00:00:00Z');
      const endDate = new Date('2024-01-15T23:59:59Z');
      
      const results = await store.query({ startDate, endDate });
      expect(results).toHaveLength(2);
      expect(results.every(r => 
        r.timestamp >= startDate && r.timestamp <= endDate
      )).toBe(true);
    });

    it('should query by metadata type', async () => {
      const results = await store.query({ type: 'code' });
      expect(results).toHaveLength(1);
      expect(results[0].metadata?.type).toBe('code');
    });

    it('should query by metadata complexity', async () => {
      const results = await store.query({ complexity: 'high' });
      expect(results).toHaveLength(1);
      expect(results[0].metadata?.complexity).toBe('high');
    });

    it('should query by metadata sensitive flag', async () => {
      const results = await store.query({ sensitive: true });
      expect(results).toHaveLength(1);
      expect(results[0].metadata?.sensitive).toBe(true);
    });

    it('should support multiple filters', async () => {
      const results = await store.query({ 
        accountId: 'account-1',
        provider: 'anthropic'
      });
      expect(results).toHaveLength(1);
      expect(results[0].accountId).toBe('account-1');
      expect(results[0].provider).toBe('anthropic');
    });

    it('should support limit and offset', async () => {
      const page1 = await store.query({ limit: 2, sortBy: 'timestamp', sortOrder: 'asc' });
      expect(page1).toHaveLength(2);

      const page2 = await store.query({ limit: 2, offset: 2, sortBy: 'timestamp', sortOrder: 'asc' });
      expect(page2).toHaveLength(1);
    });

    it('should sort by timestamp', async () => {
      const ascending = await store.query({ sortBy: 'timestamp', sortOrder: 'asc' });
      expect(ascending[0].timestamp <= ascending[1].timestamp).toBe(true);

      const descending = await store.query({ sortBy: 'timestamp', sortOrder: 'desc' });
      expect(descending[0].timestamp >= descending[1].timestamp).toBe(true);
    });

    it('should sort by cost', async () => {
      const descending = await store.query({ sortBy: 'cost', sortOrder: 'desc' });
      expect(descending[0].cost >= descending[1].cost).toBe(true);
    });

    it('should sort by tokens', async () => {
      const descending = await store.query({ sortBy: 'tokens', sortOrder: 'desc' });
      expect(descending[0].usage.totalTokens >= descending[1].usage.totalTokens).toBe(true);
    });
  });

  describe('Usage Summary', () => {
    beforeEach(async () => {
      const records: UsageRecord[] = [
        {
          id: 'summary-1',
          accountId: 'account-1',
          agentId: 'agent-1',
          model: 'claude-3-sonnet',
          provider: 'anthropic',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          cost: 0.0025,
          timestamp: new Date('2024-01-15T10:00:00Z')
        },
        {
          id: 'summary-2',
          accountId: 'account-1',
          agentId: 'agent-1',
          model: 'gpt-4',
          provider: 'openai',
          usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
          cost: 0.006,
          timestamp: new Date('2024-01-15T11:00:00Z')
        }
      ];

      for (const record of records) {
        await store.save(record);
      }
    });

    it('should calculate correct usage summary', async () => {
      const summary = await store.getUsageSummary({ accountId: 'account-1' });
      
      expect(summary.requestCount).toBe(2);
      expect(summary.totalTokens).toBe(450);
      expect(summary.promptTokens).toBe(300);
      expect(summary.completionTokens).toBe(150);
      expect(summary.totalCost).toBe(0.0085);
      expect(summary.avgCostPerRequest).toBe(0.00425);
      expect(summary.avgTokensPerRequest).toBe(225);
    });

    it('should handle empty results', async () => {
      const summary = await store.getUsageSummary({ accountId: 'nonexistent' });
      
      expect(summary.requestCount).toBe(0);
      expect(summary.totalTokens).toBe(0);
      expect(summary.totalCost).toBe(0);
      expect(summary.avgCostPerRequest).toBe(0);
      expect(summary.avgTokensPerRequest).toBe(0);
    });
  });

  describe('Trends', () => {
    beforeEach(async () => {
      const records: UsageRecord[] = [
        {
          id: 'trend-1',
          accountId: 'account-1',
          agentId: 'agent-1',
          model: 'claude-3-sonnet',
          provider: 'anthropic',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          cost: 0.0025,
          timestamp: new Date('2024-01-15T10:00:00Z')
        },
        {
          id: 'trend-2',
          accountId: 'account-1',
          agentId: 'agent-1',
          model: 'claude-3-sonnet',
          provider: 'anthropic',
          usage: { promptTokens: 120, completionTokens: 60, totalTokens: 180 },
          cost: 0.003,
          timestamp: new Date('2024-01-15T14:00:00Z')
        },
        {
          id: 'trend-3',
          accountId: 'account-1',
          agentId: 'agent-1',
          model: 'claude-3-sonnet',
          provider: 'anthropic',
          usage: { promptTokens: 80, completionTokens: 40, totalTokens: 120 },
          cost: 0.002,
          timestamp: new Date('2024-01-16T09:00:00Z')
        }
      ];

      for (const record of records) {
        await store.save(record);
      }
    });

    it('should get daily trends', async () => {
      const trends = await store.getTrends({ granularity: 'day', accountId: 'account-1' });
      
      expect(trends).toHaveLength(2);
      expect(trends[0].period).toBe('2024-01-15');
      expect(trends[0].summary.requestCount).toBe(2);
      expect(trends[0].summary.totalCost).toBe(0.0055);
      
      expect(trends[1].period).toBe('2024-01-16');
      expect(trends[1].summary.requestCount).toBe(1);
      expect(trends[1].summary.totalCost).toBe(0.002);
    });

    it('should get monthly trends', async () => {
      const trends = await store.getTrends({ granularity: 'month', accountId: 'account-1' });
      
      expect(trends).toHaveLength(1);
      expect(trends[0].period).toBe('2024-01');
      expect(trends[0].summary.requestCount).toBe(3);
      expect(trends[0].summary.totalCost).toBe(0.0075);
    });
  });

  describe('Record Deletion', () => {
    beforeEach(async () => {
      const records: UsageRecord[] = [
        {
          id: 'delete-1',
          accountId: 'account-1',
          model: 'claude-3-sonnet',
          provider: 'anthropic',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          cost: 0.0025,
          timestamp: new Date('2024-01-15T10:00:00Z')
        },
        {
          id: 'delete-2',
          accountId: 'account-2',
          model: 'gpt-4',
          provider: 'openai',
          usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
          cost: 0.006,
          timestamp: new Date('2024-01-20T11:00:00Z')
        }
      ];

      for (const record of records) {
        await store.save(record);
      }
    });

    it('should delete records by account', async () => {
      const deletedCount = await store.delete({ accountId: 'account-1' });
      expect(deletedCount).toBe(1);

      const remaining = await store.query({});
      expect(remaining).toHaveLength(1);
      expect(remaining[0].accountId).toBe('account-2');
    });

    it('should delete records by date range', async () => {
      const cutoffDate = new Date('2024-01-18T00:00:00Z');
      const deletedCount = await store.delete({ endDate: cutoffDate });
      expect(deletedCount).toBe(1);

      const remaining = await store.query({});
      expect(remaining).toHaveLength(1);
      expect(remaining[0].timestamp > cutoffDate).toBe(true);
    });
  });
});