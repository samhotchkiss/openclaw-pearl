import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UsageTracker } from '../src/usage/tracker.js';
import { CostCalculator } from '../src/usage/calculator.js';
import type { UsageRecord, UsageSummary, CostConfig } from '../src/usage/types.js';
import type { TokenUsage } from '../src/backends/types.js';

describe('UsageTracker', () => {
  let tracker: UsageTracker;
  let mockStore: any;

  beforeEach(() => {
    // Mock storage implementation
    mockStore = {
      save: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]),
      getUsageSummary: vi.fn().mockResolvedValue({
        totalTokens: 0,
        totalCost: 0,
        requestCount: 0
      })
    };

    tracker = new UsageTracker(mockStore);
  });

  describe('Usage Recording', () => {
    it('should record usage for a request', async () => {
      const usage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150
      };

      const cost = 0.0025; // $0.0025
      
      await tracker.recordUsage({
        accountId: 'test-account',
        agentId: 'test-agent',
        model: 'claude-3-sonnet',
        provider: 'anthropic',
        usage,
        cost,
        timestamp: new Date('2024-01-15T10:30:00Z')
      });

      expect(mockStore.save).toHaveBeenCalledWith({
        id: expect.any(String),
        accountId: 'test-account',
        agentId: 'test-agent',
        model: 'claude-3-sonnet',
        provider: 'anthropic',
        usage,
        cost,
        timestamp: new Date('2024-01-15T10:30:00Z')
      });
    });

    it('should generate unique IDs for each usage record', async () => {
      const usage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150
      };

      await tracker.recordUsage({
        accountId: 'test-account',
        agentId: 'test-agent',
        model: 'claude-3-sonnet',
        provider: 'anthropic',
        usage,
        cost: 0.0025
      });

      await tracker.recordUsage({
        accountId: 'test-account',
        agentId: 'test-agent',
        model: 'claude-3-sonnet',
        provider: 'anthropic',
        usage,
        cost: 0.0025
      });

      expect(mockStore.save).toHaveBeenCalledTimes(2);
      const firstCall = mockStore.save.mock.calls[0][0];
      const secondCall = mockStore.save.mock.calls[1][0];
      
      expect(firstCall.id).not.toBe(secondCall.id);
    });

    it('should use current timestamp if not provided', async () => {
      const beforeCall = Date.now();
      
      await tracker.recordUsage({
        accountId: 'test-account',
        agentId: 'test-agent',
        model: 'claude-3-sonnet',
        provider: 'anthropic',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        cost: 0.0025
      });

      const afterCall = Date.now();
      const savedRecord = mockStore.save.mock.calls[0][0];
      const recordTime = savedRecord.timestamp.getTime();
      
      expect(recordTime).toBeGreaterThanOrEqual(beforeCall);
      expect(recordTime).toBeLessThanOrEqual(afterCall);
    });
  });

  describe('Usage Querying', () => {
    it('should query usage by account', async () => {
      const mockRecords = [
        {
          id: 'record-1',
          accountId: 'test-account',
          agentId: 'agent-1',
          model: 'claude-3-sonnet',
          provider: 'anthropic',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          cost: 0.0025,
          timestamp: new Date('2024-01-15T10:30:00Z')
        }
      ];

      mockStore.query.mockResolvedValue(mockRecords);

      const results = await tracker.getUsageByAccount('test-account');

      expect(mockStore.query).toHaveBeenCalledWith({
        accountId: 'test-account'
      });
      expect(results).toEqual(mockRecords);
    });

    it('should query usage by time period', async () => {
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-01-31T23:59:59Z');

      await tracker.getUsageByDateRange(startDate, endDate);

      expect(mockStore.query).toHaveBeenCalledWith({
        startDate,
        endDate
      });
    });

    it('should query usage by agent', async () => {
      await tracker.getUsageByAgent('test-agent');

      expect(mockStore.query).toHaveBeenCalledWith({
        agentId: 'test-agent'
      });
    });

    it('should query usage with multiple filters', async () => {
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-01-31T23:59:59Z');

      await tracker.getUsage({
        accountId: 'test-account',
        agentId: 'test-agent',
        startDate,
        endDate,
        provider: 'anthropic'
      });

      expect(mockStore.query).toHaveBeenCalledWith({
        accountId: 'test-account',
        agentId: 'test-agent',
        startDate,
        endDate,
        provider: 'anthropic'
      });
    });
  });

  describe('Usage Aggregation', () => {
    it('should get usage summary for an account', async () => {
      const mockSummary: UsageSummary = {
        totalTokens: 1500,
        totalCost: 0.025,
        requestCount: 10,
        promptTokens: 1000,
        completionTokens: 500,
        avgCostPerRequest: 0.0025,
        avgTokensPerRequest: 150
      };

      mockStore.getUsageSummary.mockResolvedValue(mockSummary);

      const summary = await tracker.getUsageSummary({
        accountId: 'test-account'
      });

      expect(mockStore.getUsageSummary).toHaveBeenCalledWith({
        accountId: 'test-account'
      });
      expect(summary).toEqual(mockSummary);
    });

    it('should get usage summary by time period', async () => {
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-01-31T23:59:59Z');

      await tracker.getUsageSummary({
        startDate,
        endDate
      });

      expect(mockStore.getUsageSummary).toHaveBeenCalledWith({
        startDate,
        endDate
      });
    });
  });
});

describe('CostCalculator', () => {
  let calculator: CostCalculator;
  let costConfig: CostConfig;

  beforeEach(() => {
    costConfig = {
      anthropic: {
        'claude-3-sonnet': {
          inputCostPer1kTokens: 0.003,
          outputCostPer1kTokens: 0.015
        },
        'claude-3-haiku': {
          inputCostPer1kTokens: 0.00025,
          outputCostPer1kTokens: 0.00125
        }
      },
      openai: {
        'gpt-4': {
          inputCostPer1kTokens: 0.03,
          outputCostPer1kTokens: 0.06
        },
        'gpt-3.5-turbo': {
          inputCostPer1kTokens: 0.0015,
          outputCostPer1kTokens: 0.002
        }
      },
      ollama: {
        '*': {
          inputCostPer1kTokens: 0,
          outputCostPer1kTokens: 0
        }
      }
    };

    calculator = new CostCalculator(costConfig);
  });

  describe('Cost Calculation', () => {
    it('should calculate cost for Anthropic Claude Sonnet', () => {
      const usage: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500
      };

      const cost = calculator.calculateCost('anthropic', 'claude-3-sonnet', usage);
      
      // (1000 * 0.003 / 1000) + (500 * 0.015 / 1000) = 0.003 + 0.0075 = 0.0105
      expect(cost).toBe(0.0105);
    });

    it('should calculate cost for OpenAI GPT-4', () => {
      const usage: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500
      };

      const cost = calculator.calculateCost('openai', 'gpt-4', usage);
      
      // (1000 * 0.03 / 1000) + (500 * 0.06 / 1000) = 0.03 + 0.03 = 0.06
      expect(cost).toBe(0.06);
    });

    it('should return zero cost for Ollama models', () => {
      const usage: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500
      };

      const cost = calculator.calculateCost('ollama', 'llama2', usage);
      expect(cost).toBe(0);
    });

    it('should handle unknown models by returning zero', () => {
      const usage: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500
      };

      const cost = calculator.calculateCost('anthropic', 'unknown-model', usage);
      expect(cost).toBe(0);
    });

    it('should handle unknown providers by returning zero', () => {
      const usage: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500
      };

      const cost = calculator.calculateCost('unknown-provider', 'some-model', usage);
      expect(cost).toBe(0);
    });

    it('should handle zero token usage', () => {
      const usage: TokenUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      };

      const cost = calculator.calculateCost('anthropic', 'claude-3-sonnet', usage);
      expect(cost).toBe(0);
    });
  });

  describe('Pricing Configuration', () => {
    it('should get pricing for a model', () => {
      const pricing = calculator.getPricing('anthropic', 'claude-3-sonnet');
      
      expect(pricing).toEqual({
        inputCostPer1kTokens: 0.003,
        outputCostPer1kTokens: 0.015
      });
    });

    it('should return undefined for unknown model', () => {
      const pricing = calculator.getPricing('anthropic', 'unknown-model');
      expect(pricing).toBeUndefined();
    });

    it('should list all providers', () => {
      const providers = calculator.getProviders();
      expect(providers).toEqual(['anthropic', 'openai', 'ollama']);
    });

    it('should list models for a provider', () => {
      const models = calculator.getModels('anthropic');
      expect(models).toEqual(['claude-3-sonnet', 'claude-3-haiku']);
    });
  });

  describe('Wildcard Support', () => {
    it('should use wildcard pricing when available', () => {
      const usage: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500
      };

      const cost = calculator.calculateCost('ollama', 'any-model', usage);
      expect(cost).toBe(0);
    });
  });
});