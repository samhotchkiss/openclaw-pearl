/**
 * Rate limiting types and interfaces
 */

import type { Provider } from '../accounts/types.js';
import type { RateLimitConfig } from '../config/types.js';

/**
 * Rate limit state for an account
 */
export interface RateLimitState {
  /** Account ID */
  accountId: string;
  /** Provider (anthropic, openai, etc.) */
  provider: Provider;
  /** Whether account is currently rate limited */
  isRateLimited: boolean;
  /** When the rate limit expires (if known) */
  retryAfter?: Date;
  /** Number of consecutive rate limit hits */
  hitCount: number;
  /** Last time this account was rate limited */
  lastHit?: Date;
  /** Whether account is in cooldown period */
  isCoolingDown: boolean;
  /** When cooldown period ends */
  cooldownUntil?: Date;
}

/**
 * Rate limit detection result
 */
export interface RateLimitDetection {
  /** Whether this error is a rate limit */
  isRateLimit: boolean;
  /** Retry-after value in seconds (from headers) */
  retryAfterSeconds?: number;
  /** Provider-specific error code */
  errorCode?: string;
  /** Original error message */
  message: string;
}

/**
 * Retry strategy configuration
 */
export interface RetryStrategy {
  /** Maximum number of retries */
  maxRetries: number;
  /** Base delay in milliseconds */
  baseDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Jitter factor (0.0-1.0) */
  jitterFactor: number;
  /** Whether to respect provider retry-after hints */
  respectRetryAfter: boolean;
}

/**
 * Retry attempt result
 */
export interface RetryAttempt {
  /** Attempt number (0-based) */
  attempt: number;
  /** Delay before this attempt in milliseconds */
  delayMs: number;
  /** Whether this was the final attempt */
  isFinalAttempt: boolean;
  /** Reason for retry */
  reason: string;
}

/**
 * Account failover result
 */
export interface FailoverResult {
  /** Whether failover was successful */
  success: boolean;
  /** Account ID that was selected for failover */
  accountId?: string;
  /** Reason for failover decision */
  reason: string;
  /** Fallback accounts that were considered */
  consideredAccounts: string[];
  /** Accounts that were skipped and why */
  skippedAccounts: Array<{
    accountId: string;
    reason: string;
  }>;
}

/**
 * Rate limit manager interface
 */
export interface IRateLimitManager {
  /**
   * Detect if an error is a rate limit error
   */
  detectRateLimit(error: Error, provider: Provider): RateLimitDetection;

  /**
   * Mark an account as rate limited
   */
  markRateLimited(accountId: string, provider: Provider, retryAfterSeconds?: number): void;

  /**
   * Check if an account is currently rate limited or cooling down
   */
  isAccountAvailable(accountId: string): boolean;

  /**
   * Get rate limit state for an account
   */
  getState(accountId: string): RateLimitState | null;

  /**
   * Clear rate limit state for an account
   */
  clearState(accountId: string): void;

  /**
   * Get all accounts that are currently unavailable
   */
  getUnavailableAccounts(): string[];

  /**
   * Calculate delay for retry attempt
   */
  calculateDelay(attempt: number, retryAfterSeconds?: number): number;

  /**
   * Start cooldown period for an account
   */
  startCooldown(accountId: string): void;
}

/**
 * Account failover manager interface
 */
export interface IAccountFailover {
  /**
   * Find alternative account when primary is rate limited
   */
  findAlternativeAccount(
    primaryAccountId: string,
    provider: Provider,
    excludeAccounts?: string[]
  ): Promise<FailoverResult>;

  /**
   * Get all available accounts for a provider
   */
  getAvailableAccounts(provider: Provider): Promise<string[]>;
}

/**
 * Retry executor interface
 */
export interface IRetryExecutor {
  /**
   * Execute a function with retry logic
   */
  executeWithRetry<T>(
    fn: () => Promise<T>,
    accountId: string,
    provider: Provider,
    context?: { operation: string; metadata?: Record<string, unknown> }
  ): Promise<T>;
}

/**
 * Combined rate limit service interface
 */
export interface IRateLimitService extends IRateLimitManager, IAccountFailover, IRetryExecutor {
  /**
   * Initialize the service with configuration
   */
  initialize(config: RateLimitConfig): void;

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RateLimitConfig>): void;

  /**
   * Get current configuration
   */
  getConfig(): RateLimitConfig;

  /**
   * Clean up expired state entries
   */
  cleanup(): void;
}

/**
 * Default rate limit configuration
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  failoverEnabled: true,
  cooldownMs: 60000,
  jitterFactor: 0.1,
};