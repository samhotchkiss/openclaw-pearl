/**
 * Usage tracking types for per-account cost monitoring
 */

import type { TokenUsage } from '../backends/types.js';

/**
 * Usage record for a single LLM request
 */
export interface UsageRecord {
  /** Unique identifier for this usage record */
  id: string;
  
  /** Account ID that made the request */
  accountId: string;
  
  /** Agent ID that made the request (optional) */
  agentId?: string;
  
  /** Model used for the request */
  model: string;
  
  /** Provider used (anthropic, openai, ollama, etc.) */
  provider: string;
  
  /** Token usage details */
  usage: TokenUsage;
  
  /** Calculated cost in USD */
  cost: number;
  
  /** Timestamp of the request */
  timestamp: Date;
  
  /** Additional metadata */
  metadata?: {
    /** Request type (general, code, creative, etc.) */
    type?: string;
    /** Request complexity (low, medium, high) */
    complexity?: string;
    /** Whether request contained sensitive content */
    sensitive?: boolean;
    /** Session ID if available */
    sessionId?: string;
    /** Custom metadata */
    [key: string]: unknown;
  };
}

/**
 * Parameters for recording usage
 */
export interface RecordUsageParams {
  /** Account ID that made the request */
  accountId: string;
  
  /** Agent ID that made the request (optional) */
  agentId?: string;
  
  /** Model used for the request */
  model: string;
  
  /** Provider used */
  provider: string;
  
  /** Token usage details */
  usage: TokenUsage;
  
  /** Calculated cost in USD */
  cost: number;
  
  /** Timestamp of the request (defaults to now) */
  timestamp?: Date;
  
  /** Additional metadata */
  metadata?: UsageRecord['metadata'];
}

/**
 * Query parameters for retrieving usage records
 */
export interface UsageQuery {
  /** Filter by account ID */
  accountId?: string;
  
  /** Filter by agent ID */
  agentId?: string;
  
  /** Filter by provider */
  provider?: string;
  
  /** Filter by model */
  model?: string;
  
  /** Filter by start date (inclusive) */
  startDate?: Date;
  
  /** Filter by end date (inclusive) */
  endDate?: Date;
  
  /** Filter by request type */
  type?: string;
  
  /** Filter by complexity */
  complexity?: string;
  
  /** Filter by sensitivity */
  sensitive?: boolean;
  
  /** Maximum number of records to return */
  limit?: number;
  
  /** Number of records to skip */
  offset?: number;
  
  /** Sort order */
  sortBy?: 'timestamp' | 'cost' | 'tokens';
  
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Aggregated usage summary
 */
export interface UsageSummary {
  /** Total tokens used */
  totalTokens: number;
  
  /** Total prompt tokens */
  promptTokens: number;
  
  /** Total completion tokens */
  completionTokens: number;
  
  /** Total cost in USD */
  totalCost: number;
  
  /** Number of requests */
  requestCount: number;
  
  /** Average cost per request */
  avgCostPerRequest: number;
  
  /** Average tokens per request */
  avgTokensPerRequest: number;
  
  /** Breakdown by provider */
  byProvider?: Record<string, UsageSummary>;
  
  /** Breakdown by model */
  byModel?: Record<string, UsageSummary>;
  
  /** Breakdown by agent */
  byAgent?: Record<string, UsageSummary>;
  
  /** Breakdown by time period */
  byTimePeriod?: Array<{
    period: string; // e.g., "2024-01-15", "2024-01"
    summary: UsageSummary;
  }>;
}

/**
 * Pricing configuration for cost calculation
 */
export interface ModelPricing {
  /** Cost per 1k input tokens in USD */
  inputCostPer1kTokens: number;
  
  /** Cost per 1k output tokens in USD */
  outputCostPer1kTokens: number;
  
  /** Optional cache read cost per 1k tokens */
  cacheCostPer1kTokens?: number;
}

/**
 * Provider-specific pricing configuration
 */
export type ProviderPricing = Record<string, ModelPricing>;

/**
 * Complete cost configuration
 */
export type CostConfig = Record<string, ProviderPricing>;

/**
 * Storage interface for usage records
 */
export interface UsageStore {
  /**
   * Save a usage record
   */
  save(record: UsageRecord): Promise<void>;
  
  /**
   * Query usage records
   */
  query(query: UsageQuery): Promise<UsageRecord[]>;
  
  /**
   * Get aggregated usage summary
   */
  getUsageSummary(query: Omit<UsageQuery, 'limit' | 'offset' | 'sortBy' | 'sortOrder'>): Promise<UsageSummary>;
  
  /**
   * Delete usage records (for data retention)
   */
  delete(query: UsageQuery): Promise<number>;
  
  /**
   * Get usage trends over time
   */
  getTrends(query: UsageQuery & {
    /** Time period granularity */
    granularity: 'hour' | 'day' | 'week' | 'month';
  }): Promise<Array<{
    period: string;
    summary: UsageSummary;
  }>>;
}

/**
 * Usage tracking interface
 */
export interface IUsageTracker {
  /**
   * Record usage for a request
   */
  recordUsage(params: RecordUsageParams): Promise<void>;
  
  /**
   * Get usage records
   */
  getUsage(query: UsageQuery): Promise<UsageRecord[]>;
  
  /**
   * Get usage for a specific account
   */
  getUsageByAccount(accountId: string, options?: {
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<UsageRecord[]>;
  
  /**
   * Get usage for a specific agent
   */
  getUsageByAgent(agentId: string, options?: {
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<UsageRecord[]>;
  
  /**
   * Get usage for a date range
   */
  getUsageByDateRange(startDate: Date, endDate: Date, options?: {
    accountId?: string;
    agentId?: string;
    limit?: number;
  }): Promise<UsageRecord[]>;
  
  /**
   * Get aggregated usage summary
   */
  getUsageSummary(query: Omit<UsageQuery, 'limit' | 'offset' | 'sortBy' | 'sortOrder'>): Promise<UsageSummary>;
}

/**
 * Cost calculator interface
 */
export interface ICostCalculator {
  /**
   * Calculate cost for a request
   */
  calculateCost(provider: string, model: string, usage: TokenUsage): number;
  
  /**
   * Get pricing for a model
   */
  getPricing(provider: string, model: string): ModelPricing | undefined;
  
  /**
   * Get all providers
   */
  getProviders(): string[];
  
  /**
   * Get models for a provider
   */
  getModels(provider: string): string[];
}