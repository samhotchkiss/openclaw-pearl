/**
 * Usage tracker for per-account LLM usage monitoring
 */

import type { 
  IUsageTracker, 
  UsageStore, 
  UsageRecord, 
  UsageQuery, 
  UsageSummary, 
  RecordUsageParams 
} from './types.js';

/**
 * Generate a unique ID for usage records
 */
function generateUsageId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 9);
  return `usage_${timestamp}_${random}`;
}

/**
 * Usage tracker implementation
 */
export class UsageTracker implements IUsageTracker {
  private store: UsageStore;

  constructor(store: UsageStore) {
    this.store = store;
  }

  /**
   * Record usage for a request
   */
  async recordUsage(params: RecordUsageParams): Promise<void> {
    const record: UsageRecord = {
      id: generateUsageId(),
      accountId: params.accountId,
      agentId: params.agentId,
      model: params.model,
      provider: params.provider,
      usage: params.usage,
      cost: params.cost,
      timestamp: params.timestamp || new Date(),
      metadata: params.metadata
    };

    await this.store.save(record);
  }

  /**
   * Get usage records
   */
  async getUsage(query: UsageQuery): Promise<UsageRecord[]> {
    return await this.store.query(query);
  }

  /**
   * Get usage for a specific account
   */
  async getUsageByAccount(
    accountId: string, 
    options?: {
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    }
  ): Promise<UsageRecord[]> {
    const query: UsageQuery = {
      accountId,
      startDate: options?.startDate,
      endDate: options?.endDate,
      limit: options?.limit,
      sortBy: 'timestamp',
      sortOrder: 'desc'
    };

    return await this.store.query(query);
  }

  /**
   * Get usage for a specific agent
   */
  async getUsageByAgent(
    agentId: string, 
    options?: {
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    }
  ): Promise<UsageRecord[]> {
    const query: UsageQuery = {
      agentId,
      startDate: options?.startDate,
      endDate: options?.endDate,
      limit: options?.limit,
      sortBy: 'timestamp',
      sortOrder: 'desc'
    };

    return await this.store.query(query);
  }

  /**
   * Get usage for a date range
   */
  async getUsageByDateRange(
    startDate: Date, 
    endDate: Date, 
    options?: {
      accountId?: string;
      agentId?: string;
      limit?: number;
    }
  ): Promise<UsageRecord[]> {
    const query: UsageQuery = {
      startDate,
      endDate,
      accountId: options?.accountId,
      agentId: options?.agentId,
      limit: options?.limit,
      sortBy: 'timestamp',
      sortOrder: 'desc'
    };

    return await this.store.query(query);
  }

  /**
   * Get aggregated usage summary
   */
  async getUsageSummary(
    query: Omit<UsageQuery, 'limit' | 'offset' | 'sortBy' | 'sortOrder'>
  ): Promise<UsageSummary> {
    return await this.store.getUsageSummary(query);
  }

  /**
   * Get usage trends over time
   */
  async getUsageTrends(query: UsageQuery & {
    granularity: 'hour' | 'day' | 'week' | 'month';
  }): Promise<Array<{
    period: string;
    summary: UsageSummary;
  }>> {
    return await this.store.getTrends(query);
  }

  /**
   * Get top spending accounts
   */
  async getTopSpenders(options?: {
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<Array<{
    accountId: string;
    totalCost: number;
    totalTokens: number;
    requestCount: number;
  }>> {
    const query: UsageQuery = {
      startDate: options?.startDate,
      endDate: options?.endDate
    };

    const records = await this.store.query(query);
    const accountMap = new Map<string, {
      totalCost: number;
      totalTokens: number;
      requestCount: number;
    }>();

    for (const record of records) {
      const existing = accountMap.get(record.accountId) || {
        totalCost: 0,
        totalTokens: 0,
        requestCount: 0
      };

      existing.totalCost += record.cost;
      existing.totalTokens += record.usage.totalTokens;
      existing.requestCount += 1;

      accountMap.set(record.accountId, existing);
    }

    const results = Array.from(accountMap.entries()).map(([accountId, stats]) => ({
      accountId,
      ...stats
    }));

    // Sort by cost descending
    results.sort((a, b) => b.totalCost - a.totalCost);

    return options?.limit ? results.slice(0, options.limit) : results;
  }

  /**
   * Get usage breakdown by model
   */
  async getModelBreakdown(options?: {
    accountId?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<Array<{
    model: string;
    provider: string;
    totalCost: number;
    totalTokens: number;
    requestCount: number;
    avgCostPerRequest: number;
  }>> {
    const query: UsageQuery = {
      accountId: options?.accountId,
      startDate: options?.startDate,
      endDate: options?.endDate
    };

    const records = await this.store.query(query);
    const modelMap = new Map<string, {
      provider: string;
      totalCost: number;
      totalTokens: number;
      requestCount: number;
    }>();

    for (const record of records) {
      const key = `${record.provider}:${record.model}`;
      const existing = modelMap.get(key) || {
        provider: record.provider,
        totalCost: 0,
        totalTokens: 0,
        requestCount: 0
      };

      existing.totalCost += record.cost;
      existing.totalTokens += record.usage.totalTokens;
      existing.requestCount += 1;

      modelMap.set(key, existing);
    }

    const results = Array.from(modelMap.entries()).map(([key, stats]) => {
      const model = key.split(':')[1];
      return {
        model,
        provider: stats.provider,
        totalCost: stats.totalCost,
        totalTokens: stats.totalTokens,
        requestCount: stats.requestCount,
        avgCostPerRequest: stats.requestCount > 0 ? stats.totalCost / stats.requestCount : 0
      };
    });

    // Sort by cost descending
    results.sort((a, b) => b.totalCost - a.totalCost);

    return results;
  }

  /**
   * Get current month usage for an account
   */
  async getCurrentMonthUsage(accountId: string): Promise<UsageSummary> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    return await this.getUsageSummary({
      accountId,
      startDate: startOfMonth,
      endDate: endOfMonth
    });
  }

  /**
   * Get yesterday's usage summary
   */
  async getYesterdayUsage(accountId?: string): Promise<UsageSummary> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    const startOfDay = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
    const endOfDay = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);

    return await this.getUsageSummary({
      accountId,
      startDate: startOfDay,
      endDate: endOfDay
    });
  }

  /**
   * Delete old usage records (for data retention)
   */
  async deleteOldRecords(olderThanDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    return await this.store.delete({
      endDate: cutoffDate
    });
  }

  /**
   * Export usage data as CSV
   */
  async exportUsage(query: UsageQuery): Promise<string> {
    const records = await this.store.query(query);
    
    const headers = [
      'ID',
      'Account ID',
      'Agent ID',
      'Model',
      'Provider',
      'Prompt Tokens',
      'Completion Tokens',
      'Total Tokens',
      'Cost (USD)',
      'Timestamp',
      'Type',
      'Complexity',
      'Sensitive'
    ];

    const csvLines = [headers.join(',')];

    for (const record of records) {
      const row = [
        record.id,
        record.accountId,
        record.agentId || '',
        record.model,
        record.provider,
        record.usage.promptTokens.toString(),
        record.usage.completionTokens.toString(),
        record.usage.totalTokens.toString(),
        record.cost.toFixed(6),
        record.timestamp.toISOString(),
        record.metadata?.type || '',
        record.metadata?.complexity || '',
        record.metadata?.sensitive ? 'true' : 'false'
      ];

      csvLines.push(row.join(','));
    }

    return csvLines.join('\n');
  }
}