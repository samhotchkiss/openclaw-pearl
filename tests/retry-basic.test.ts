import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetryExecutor } from '../src/ratelimit/retry-executor.js';
import { RateLimitManager } from '../src/ratelimit/manager.js';
import { AccountFailover } from '../src/ratelimit/failover.js';
import { RateLimitError } from '../src/backends/types.js';
import type { RateLimitConfig } from '../src/ratelimit/types.js';

describe('RetryExecutor Basic', () => {
  let executor: RetryExecutor;
  let rateLimitManager: RateLimitManager;
  let accountFailover: AccountFailover;
  let config: RateLimitConfig;

  beforeEach(() => {
    config = {
      maxRetries: 2,
      baseDelayMs: 10, // Very small delay for tests
      maxDelayMs: 100,
      failoverEnabled: false, // Disable failover for basic tests
      cooldownMs: 1000,
      jitterFactor: 0,
    };

    rateLimitManager = new RateLimitManager(config);
    accountFailover = {} as AccountFailover; // Mock, not used when failover disabled
    executor = new RetryExecutor(rateLimitManager, accountFailover, config);

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should succeed immediately when no errors', async () => {
    const mockFn = vi.fn().mockResolvedValue('success');

    const result = await executor.executeWithRetry(
      mockFn,
      'account-1',
      'anthropic'
    );

    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should fail immediately for non-retryable errors', async () => {
    const mockFn = vi.fn().mockRejectedValue(new Error('Bad request'));

    await expect(executor.executeWithRetry(
      mockFn,
      'account-1',
      'anthropic'
    )).rejects.toThrow('Bad request');

    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should retry and succeed on second attempt', async () => {
    const mockFn = vi
      .fn()
      .mockRejectedValueOnce(new RateLimitError('Rate limited'))
      .mockResolvedValueOnce('success');

    const promise = executor.executeWithRetry(
      mockFn,
      'account-1',
      'anthropic'
    );

    // Fast forward to complete the delay
    await vi.runAllTimersAsync();

    const result = await promise;

    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('should fail after max retries', async () => {
    const mockFn = vi.fn().mockRejectedValue(new RateLimitError('Rate limited'));

    const promise = executor.executeWithRetry(
      mockFn,
      'account-1',
      'anthropic'
    );

    // Fast forward through all retries
    await vi.runAllTimersAsync();

    try {
      await promise;
      throw new Error('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitError);
      expect((error as RateLimitError).message).toBe('Rate limited');
    }

    expect(mockFn).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });
});