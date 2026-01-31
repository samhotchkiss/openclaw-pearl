import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetryExecutor } from '../src/ratelimit/retry-executor.js';
import { RateLimitManager } from '../src/ratelimit/manager.js';
import { BackendError } from '../src/backends/types.js';
import type { RateLimitConfig } from '../src/ratelimit/types.js';

describe('RetryExecutor Simple', () => {
  let executor: RetryExecutor;
  let rateLimitManager: RateLimitManager;
  let config: RateLimitConfig;

  beforeEach(() => {
    config = {
      maxRetries: 1,
      baseDelayMs: 0, // No delay for testing
      maxDelayMs: 0,
      failoverEnabled: false,
      cooldownMs: 1000,
      jitterFactor: 0,
    };

    rateLimitManager = new RateLimitManager(config);
    const accountFailover = {} as any; // Not used when failover disabled
    executor = new RetryExecutor(rateLimitManager, accountFailover, config);
  });

  it('should succeed immediately', async () => {
    const mockFn = vi.fn().mockResolvedValue('success');

    const result = await executor.executeWithRetry(
      mockFn,
      'account-1',
      'anthropic'
    );

    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should not retry non-retryable errors', async () => {
    const mockFn = vi.fn().mockRejectedValue(new BackendError('Auth error', 'AUTH', 401, false));

    try {
      await executor.executeWithRetry(
        mockFn,
        'account-1',
        'anthropic'
      );
      throw new Error('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BackendError);
      expect((error as BackendError).message).toBe('Auth error');
    }

    expect(mockFn).toHaveBeenCalledTimes(1);
  });
});