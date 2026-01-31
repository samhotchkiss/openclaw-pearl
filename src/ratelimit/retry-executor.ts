/**
 * Retry Executor
 * Handles execution of functions with retry logic and account failover
 */

import type { Provider } from '../accounts/types.js';
import type {
  IRetryExecutor,
  IRateLimitManager,
  IAccountFailover,
  RateLimitConfig,
  RetryAttempt,
} from './types.js';
import { BackendError } from '../backends/types.js';

/**
 * Executes functions with intelligent retry logic and account failover
 */
export class RetryExecutor implements IRetryExecutor {
  constructor(
    private rateLimitManager: IRateLimitManager,
    private accountFailover: IAccountFailover,
    private config: RateLimitConfig
  ) {}

  /**
   * Execute a function with retry logic and optional failover
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    accountId: string,
    provider: Provider,
    context?: {
      operation: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<T> {
    let currentAccountId = accountId;
    let attempt = 0;
    const excludedAccounts: string[] = [];
    const maxRetries = this.config.maxRetries;

    while (attempt <= maxRetries) {
      try {
        // Execute the function
        const result = await fn();
        return result;

      } catch (error) {
        const isLastAttempt = attempt >= maxRetries;

        // Determine if this error should trigger a retry
        const shouldRetry = this.shouldRetryError(error);
        const isRateLimit = this.rateLimitManager.detectRateLimit(error, provider);

        // If it's a rate limit error, mark the account and try failover
        if (isRateLimit.isRateLimit) {
          this.rateLimitManager.markRateLimited(
            currentAccountId,
            provider,
            isRateLimit.retryAfterSeconds
          );

          // Try failover if enabled and not the last attempt
          if (this.config.failoverEnabled && !isLastAttempt) {
            const failoverResult = await this.accountFailover.findAlternativeAccount(
              accountId, // Original account
              provider,
              [...excludedAccounts, currentAccountId] // Exclude all previously tried accounts
            );

            if (failoverResult.success && failoverResult.accountId) {
              // Mark the original account as cooling down
              this.rateLimitManager.startCooldown(currentAccountId);
              
              // Switch to the failover account
              excludedAccounts.push(currentAccountId);
              currentAccountId = failoverResult.accountId;
              
              // Continue with same attempt counter to prevent infinite loops
              continue;
            }
          }
        }

        // If we can't retry or this is the last attempt, throw the error
        if (!shouldRetry || isLastAttempt) {
          throw error;
        }

        // Calculate delay for retry
        const delay = this.rateLimitManager.calculateDelay(
          attempt,
          isRateLimit.retryAfterSeconds
        );

        // Log retry attempt
        const retryAttempt: RetryAttempt = {
          attempt,
          delayMs: delay,
          isFinalAttempt: attempt >= maxRetries - 1,
          reason: this.getRetryReason(error, isRateLimit.isRateLimit),
        };

        // Wait before retry
        await this.delay(delay);
        attempt++;
      }
    }

    // This should never be reached due to the throw in the catch block
    throw new Error('Maximum retries exceeded');
  }

  /**
   * Determine if an error should trigger a retry
   */
  private shouldRetryError(error: unknown): boolean {
    if (error instanceof BackendError) {
      return error.retryable;
    }

    // For rate limits, always retry
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (
        message.includes('rate limit') ||
        message.includes('too many requests') ||
        message.includes('quota exceeded')
      ) {
        return true;
      }
    }

    // For network errors, timeout errors, etc., generally retry
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (
        message.includes('timeout') ||
        message.includes('network') ||
        message.includes('connection') ||
        message.includes('econnreset') ||
        message.includes('socket hang up')
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get a human-readable reason for the retry
   */
  private getRetryReason(error: unknown, isRateLimit: boolean): string {
    if (isRateLimit) {
      return 'Rate limit exceeded';
    }

    if (error instanceof BackendError) {
      switch (error.code) {
        case 'SERVER_ERROR':
          return 'Server error';
        case 'NETWORK_ERROR':
          return 'Network error';
        case 'TIMEOUT':
          return 'Request timeout';
        default:
          return `Backend error: ${error.code}`;
      }
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes('timeout')) {
        return 'Request timeout';
      }
      if (message.includes('network')) {
        return 'Network error';
      }
      if (message.includes('connection')) {
        return 'Connection error';
      }
    }

    return 'Unknown error';
  }

  /**
   * Delay execution for the specified number of milliseconds
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}