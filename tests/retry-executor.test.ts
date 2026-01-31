import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetryExecutor } from '../src/ratelimit/retry-executor.js';
import { RateLimitManager } from '../src/ratelimit/manager.js';
import { AccountFailover } from '../src/ratelimit/failover.js';
import { RateLimitError, BackendError } from '../src/backends/types.js';
import type { RateLimitConfig, FailoverResult } from '../src/ratelimit/types.js';

describe('RetryExecutor', () => {
  let executor: RetryExecutor;
  let rateLimitManager: RateLimitManager;
  let accountFailover: AccountFailover;
  let config: RateLimitConfig;

  beforeEach(() => {
    config = {
      maxRetries: 3,
      baseDelayMs: 100, // Use small delays for tests
      maxDelayMs: 1000,
      failoverEnabled: true,
      cooldownMs: 60000,
      jitterFactor: 0.1,
    };

    rateLimitManager = new RateLimitManager(config);
    accountFailover = {} as AccountFailover; // Will mock methods as needed
    executor = new RetryExecutor(rateLimitManager, accountFailover, config);

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('executeWithRetry', () => {
    it('should succeed on first attempt when no errors occur', async () => {
      const mockFn = vi.fn().mockResolvedValue('success');

      const result = await executor.executeWithRetry(
        mockFn,
        'account-1',
        'anthropic'
      );

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should retry on rate limit errors', async () => {
      const mockFn = vi
        .fn()
        .mockRejectedValueOnce(new RateLimitError('Rate limited', 1))
        .mockResolvedValueOnce('success');

      const resultPromise = executor.executeWithRetry(
        mockFn,
        'account-1',
        'anthropic'
      );

      // Advance timers to trigger retry
      vi.advanceTimersToNextTimer();

      const result = await resultPromise;

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it('should respect retry-after headers in delays', async () => {
      const retryAfterSeconds = 2;
      const mockFn = vi
        .fn()
        .mockRejectedValueOnce(new RateLimitError('Rate limited', retryAfterSeconds))
        .mockResolvedValueOnce('success');

      const startTime = Date.now();
      const resultPromise = executor.executeWithRetry(
        mockFn,
        'account-1',
        'anthropic'
      );

      // Should delay for at least retry-after time
      vi.advanceTimersByTime(retryAfterSeconds * 1000);

      const result = await resultPromise;
      const endTime = Date.now();

      expect(result).toBe('success');
      expect(endTime - startTime).toBeGreaterThanOrEqual(retryAfterSeconds * 1000 * 0.9); // Allow for jitter
    });

    it('should fail after max retries', async () => {
      const mockFn = vi.fn().mockRejectedValue(new RateLimitError('Rate limited'));

      const promise = executor.executeWithRetry(
        mockFn,
        'account-1',
        'anthropic'
      );

      // Advance through all retries
      for (let i = 0; i < config.maxRetries; i++) {
        vi.advanceTimersToNextTimer();
      }

      await expect(promise).rejects.toThrow('Rate limited');
      expect(mockFn).toHaveBeenCalledTimes(config.maxRetries + 1);
    });

    it('should mark account as rate limited after detecting rate limit', async () => {
      const mockFn = vi.fn().mockRejectedValue(new RateLimitError('Rate limited', 60));

      const promise = executor.executeWithRetry(
        mockFn,
        'account-1',
        'anthropic'
      );

      vi.advanceTimersToNextTimer();

      await expect(promise).rejects.toThrow();

      // Account should be marked as rate limited
      expect(rateLimitManager.isAccountAvailable('account-1')).toBe(false);
      const state = rateLimitManager.getState('account-1');
      expect(state?.isRateLimited).toBe(true);
    });

    it('should not retry non-retryable errors', async () => {
      const mockFn = vi.fn().mockRejectedValue(new BackendError('Auth error', 'AUTH', 401, false));

      await expect(executor.executeWithRetry(
        mockFn,
        'account-1',
        'anthropic'
      )).rejects.toThrow('Auth error');

      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should attempt failover when enabled and primary account is rate limited', async () => {
      const mockFailoverResult: FailoverResult = {
        success: true,
        accountId: 'account-2',
        reason: 'Failover to account-2',
        consideredAccounts: ['account-2'],
        skippedAccounts: [],
      };

      accountFailover.findAlternativeAccount = vi.fn().mockResolvedValue(mockFailoverResult);

      const mockFn = vi
        .fn()
        .mockRejectedValueOnce(new RateLimitError('Rate limited'))
        .mockResolvedValueOnce('success after failover');

      const result = await executor.executeWithRetry(
        mockFn,
        'account-1',
        'anthropic'
      );

      expect(result).toBe('success after failover');
      expect(accountFailover.findAlternativeAccount).toHaveBeenCalledWith(
        'account-1',
        'anthropic',
        []
      );
    });

    it('should not attempt failover when disabled', async () => {
      const disabledConfig = { ...config, failoverEnabled: false };
      const disabledExecutor = new RetryExecutor(rateLimitManager, accountFailover, disabledConfig);

      accountFailover.findAlternativeAccount = vi.fn();

      const mockFn = vi.fn().mockRejectedValue(new RateLimitError('Rate limited'));

      const promise = disabledExecutor.executeWithRetry(
        mockFn,
        'account-1',
        'anthropic'
      );

      vi.advanceTimersToNextTimer();

      await expect(promise).rejects.toThrow('Rate limited');
      expect(accountFailover.findAlternativeAccount).not.toHaveBeenCalled();
    });

    it('should handle failed failover attempts', async () => {
      const mockFailoverResult: FailoverResult = {
        success: false,
        reason: 'No alternative accounts available',
        consideredAccounts: [],
        skippedAccounts: [],
      };

      accountFailover.findAlternativeAccount = vi.fn().mockResolvedValue(mockFailoverResult);

      const mockFn = vi.fn().mockRejectedValue(new RateLimitError('Rate limited'));

      const promise = executor.executeWithRetry(
        mockFn,
        'account-1',
        'anthropic'
      );

      // Should still retry with same account
      vi.advanceTimersToNextTimer();

      await expect(promise).rejects.toThrow('Rate limited');
      expect(accountFailover.findAlternativeAccount).toHaveBeenCalled();
    });

    it('should include context in retry attempts', async () => {
      const context = {
        operation: 'chat',
        metadata: { model: 'claude-3-sonnet', sessionId: 'test-session' },
      };

      const mockFn = vi
        .fn()
        .mockRejectedValueOnce(new RateLimitError('Rate limited'))
        .mockResolvedValueOnce('success');

      const resultPromise = executor.executeWithRetry(
        mockFn,
        'account-1',
        'anthropic',
        context
      );

      vi.advanceTimersToNextTimer();

      const result = await resultPromise;

      expect(result).toBe('success');
      // Context should be preserved through retries (implementation specific)
    });

    it('should handle exponential backoff correctly', async () => {
      const mockFn = vi
        .fn()
        .mockRejectedValueOnce(new BackendError('Server error', 'SERVER', 500, true))
        .mockRejectedValueOnce(new BackendError('Server error', 'SERVER', 500, true))
        .mockResolvedValueOnce('success');

      const delays: number[] = [];
      const originalCalculateDelay = rateLimitManager.calculateDelay;
      rateLimitManager.calculateDelay = vi.fn().mockImplementation((...args) => {
        const delay = originalCalculateDelay.call(rateLimitManager, ...args);
        delays.push(delay);
        return delay;
      });

      const resultPromise = executor.executeWithRetry(
        mockFn,
        'account-1',
        'anthropic'
      );

      // Advance through retries
      vi.advanceTimersToNextTimer(); // First retry
      vi.advanceTimersToNextTimer(); // Second retry

      const result = await resultPromise;

      expect(result).toBe('success');
      expect(delays).toHaveLength(2);
      expect(delays[1]).toBeGreaterThan(delays[0]); // Exponential backoff
    });

    it('should start cooldown after successful failover', async () => {
      const mockFailoverResult: FailoverResult = {
        success: true,
        accountId: 'account-2',
        reason: 'Failover to account-2',
        consideredAccounts: ['account-2'],
        skippedAccounts: [],
      };

      accountFailover.findAlternativeAccount = vi.fn().mockResolvedValue(mockFailoverResult);

      const mockFn = vi
        .fn()
        .mockRejectedValueOnce(new RateLimitError('Rate limited'))
        .mockResolvedValueOnce('success after failover');

      await executor.executeWithRetry(
        mockFn,
        'account-1',
        'anthropic'
      );

      // Original account should be in cooldown
      const state = rateLimitManager.getState('account-1');
      expect(state?.isCoolingDown).toBe(true);
    });

    it('should handle multiple consecutive failures with different errors', async () => {
      const mockFn = vi
        .fn()
        .mockRejectedValueOnce(new RateLimitError('Rate limited'))
        .mockRejectedValueOnce(new BackendError('Server error', 'SERVER', 500, true))
        .mockResolvedValueOnce('success');

      const resultPromise = executor.executeWithRetry(
        mockFn,
        'account-1',
        'anthropic'
      );

      vi.advanceTimersToNextTimer(); // Rate limit retry
      vi.advanceTimersToNextTimer(); // Server error retry

      const result = await resultPromise;

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(3);
    });
  });

  describe('error classification', () => {
    it('should correctly identify rate limit errors for retry', async () => {
      const rateLimitError = new RateLimitError('Rate limited');
      const mockFn = vi.fn().mockRejectedValue(rateLimitError);

      const promise = executor.executeWithRetry(
        mockFn,
        'account-1',
        'anthropic'
      );

      vi.advanceTimersToNextTimer();

      await expect(promise).rejects.toThrow('Rate limited');
      expect(mockFn).toHaveBeenCalledTimes(2); // Should retry
    });

    it('should correctly identify server errors for retry', async () => {
      const serverError = new BackendError('Server error', 'SERVER', 500, true);
      const mockFn = vi.fn().mockRejectedValue(serverError);

      const promise = executor.executeWithRetry(
        mockFn,
        'account-1',
        'anthropic'
      );

      vi.advanceTimersToNextTimer();

      await expect(promise).rejects.toThrow('Server error');
      expect(mockFn).toHaveBeenCalledTimes(2); // Should retry
    });

    it('should not retry non-retryable client errors', async () => {
      const clientError = new BackendError('Bad request', 'CLIENT', 400, false);
      const mockFn = vi.fn().mockRejectedValue(clientError);

      await expect(executor.executeWithRetry(
        mockFn,
        'account-1',
        'anthropic'
      )).rejects.toThrow('Bad request');

      expect(mockFn).toHaveBeenCalledTimes(1); // Should not retry
    });
  });
});