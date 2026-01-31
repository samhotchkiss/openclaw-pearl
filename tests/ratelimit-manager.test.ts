import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimitManager } from '../src/ratelimit/manager.js';
import { RateLimitError, BackendError } from '../src/backends/types.js';
import type { RateLimitConfig, RateLimitState, RateLimitDetection } from '../src/ratelimit/types.js';

describe('RateLimitManager', () => {
  let manager: RateLimitManager;
  let config: RateLimitConfig;

  beforeEach(() => {
    config = {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      failoverEnabled: true,
      cooldownMs: 60000,
      jitterFactor: 0.1,
    };
    manager = new RateLimitManager(config);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('detectRateLimit', () => {
    it('should detect Anthropic 429 errors as rate limits', () => {
      const error = new RateLimitError('Rate limit exceeded', 60);
      const detection = manager.detectRateLimit(error, 'anthropic');

      expect(detection.isRateLimit).toBe(true);
      expect(detection.retryAfterSeconds).toBe(60);
      expect(detection.message).toBe('Rate limit exceeded');
    });

    it('should detect OpenAI rate limit errors', () => {
      const error = new BackendError('Rate limit exceeded', 'RATE_LIMIT', 429, true);
      const detection = manager.detectRateLimit(error, 'openai');

      expect(detection.isRateLimit).toBe(true);
      expect(detection.errorCode).toBe('RATE_LIMIT');
    });

    it('should detect generic 429 status codes', () => {
      const error = new BackendError('Too many requests', 'TOO_MANY_REQUESTS', 429, true);
      const detection = manager.detectRateLimit(error, 'ollama');

      expect(detection.isRateLimit).toBe(true);
      expect(detection.message).toBe('Too many requests');
    });

    it('should not detect non-rate-limit errors', () => {
      const error = new BackendError('Server error', 'SERVER_ERROR', 500, true);
      const detection = manager.detectRateLimit(error, 'anthropic');

      expect(detection.isRateLimit).toBe(false);
      expect(detection.message).toBe('Server error');
    });

    it('should handle errors without specific rate limit information', () => {
      const error = new Error('Network timeout');
      const detection = manager.detectRateLimit(error, 'openai');

      expect(detection.isRateLimit).toBe(false);
      expect(detection.message).toBe('Network timeout');
    });
  });

  describe('markRateLimited', () => {
    it('should mark account as rate limited with retry-after', () => {
      const accountId = 'account-1';
      const retryAfter = 120;

      manager.markRateLimited(accountId, 'anthropic', retryAfter);

      const state = manager.getState(accountId);
      expect(state).toBeDefined();
      expect(state!.isRateLimited).toBe(true);
      expect(state!.accountId).toBe(accountId);
      expect(state!.provider).toBe('anthropic');
      expect(state!.hitCount).toBe(1);
      expect(state!.retryAfter).toBeDefined();
    });

    it('should increment hit count on subsequent rate limits', () => {
      const accountId = 'account-1';

      manager.markRateLimited(accountId, 'anthropic');
      manager.markRateLimited(accountId, 'anthropic');
      manager.markRateLimited(accountId, 'anthropic');

      const state = manager.getState(accountId);
      expect(state!.hitCount).toBe(3);
    });

    it('should update retry-after time on new rate limit', () => {
      const accountId = 'account-1';

      manager.markRateLimited(accountId, 'anthropic', 60);
      const firstRetryAfter = manager.getState(accountId)!.retryAfter;

      vi.advanceTimersByTime(10000); // Advance 10 seconds

      manager.markRateLimited(accountId, 'anthropic', 90);
      const secondRetryAfter = manager.getState(accountId)!.retryAfter;

      expect(secondRetryAfter!.getTime()).toBeGreaterThan(firstRetryAfter!.getTime());
    });
  });

  describe('isAccountAvailable', () => {
    it('should return true for unknown accounts', () => {
      expect(manager.isAccountAvailable('unknown-account')).toBe(true);
    });

    it('should return false for rate limited accounts', () => {
      const accountId = 'account-1';
      manager.markRateLimited(accountId, 'anthropic', 60);

      expect(manager.isAccountAvailable(accountId)).toBe(false);
    });

    it('should return false for accounts in cooldown', () => {
      const accountId = 'account-1';
      manager.startCooldown(accountId);

      expect(manager.isAccountAvailable(accountId)).toBe(false);
    });

    it('should return true after rate limit expires', () => {
      const accountId = 'account-1';
      manager.markRateLimited(accountId, 'anthropic', 1); // 1 second

      expect(manager.isAccountAvailable(accountId)).toBe(false);

      vi.advanceTimersByTime(2000); // Advance 2 seconds

      expect(manager.isAccountAvailable(accountId)).toBe(true);
    });

    it('should return true after cooldown expires', () => {
      const accountId = 'account-1';
      manager.startCooldown(accountId);

      expect(manager.isAccountAvailable(accountId)).toBe(false);

      vi.advanceTimersByTime(config.cooldownMs + 1000); // Advance past cooldown

      expect(manager.isAccountAvailable(accountId)).toBe(true);
    });
  });

  describe('calculateDelay', () => {
    it('should calculate exponential backoff delay', () => {
      const delay1 = manager.calculateDelay(0);
      const delay2 = manager.calculateDelay(1);
      const delay3 = manager.calculateDelay(2);

      expect(delay1).toBeGreaterThanOrEqual(config.baseDelayMs * 0.9); // Account for jitter
      expect(delay1).toBeLessThanOrEqual(config.baseDelayMs * 1.1);

      expect(delay2).toBeGreaterThan(delay1);
      expect(delay3).toBeGreaterThan(delay2);
    });

    it('should respect maximum delay', () => {
      const delay = manager.calculateDelay(10); // Large attempt number
      expect(delay).toBeLessThanOrEqual(config.maxDelayMs);
    });

    it('should respect retry-after hint', () => {
      const retryAfter = 5; // 5 seconds
      const delay = manager.calculateDelay(0, retryAfter);

      expect(delay).toBeGreaterThanOrEqual(retryAfter * 1000 * 0.9); // Convert to ms, account for jitter
      expect(delay).toBeLessThanOrEqual(retryAfter * 1000 * 1.1);
    });

    it('should add jitter to delays', () => {
      const delays = Array.from({ length: 10 }, () => manager.calculateDelay(1));
      const uniqueDelays = new Set(delays);

      expect(uniqueDelays.size).toBeGreaterThan(1); // Should have variation due to jitter
    });
  });

  describe('startCooldown', () => {
    it('should mark account as cooling down', () => {
      const accountId = 'account-1';
      manager.startCooldown(accountId);

      const state = manager.getState(accountId);
      expect(state!.isCoolingDown).toBe(true);
      expect(state!.cooldownUntil).toBeDefined();
      expect(manager.isAccountAvailable(accountId)).toBe(false);
    });

    it('should extend cooldown for already cooling down accounts', () => {
      const accountId = 'account-1';
      
      manager.startCooldown(accountId);
      const firstCooldownUntil = manager.getState(accountId)!.cooldownUntil;

      vi.advanceTimersByTime(10000); // Advance 10 seconds

      manager.startCooldown(accountId);
      const secondCooldownUntil = manager.getState(accountId)!.cooldownUntil;

      expect(secondCooldownUntil!.getTime()).toBeGreaterThan(firstCooldownUntil!.getTime());
    });
  });

  describe('clearState', () => {
    it('should remove rate limit state for account', () => {
      const accountId = 'account-1';
      manager.markRateLimited(accountId, 'anthropic');

      expect(manager.getState(accountId)).toBeDefined();

      manager.clearState(accountId);

      expect(manager.getState(accountId)).toBeNull();
      expect(manager.isAccountAvailable(accountId)).toBe(true);
    });
  });

  describe('getUnavailableAccounts', () => {
    it('should return empty array when no accounts are unavailable', () => {
      expect(manager.getUnavailableAccounts()).toEqual([]);
    });

    it('should return rate limited accounts', () => {
      manager.markRateLimited('account-1', 'anthropic');
      manager.markRateLimited('account-2', 'openai');

      const unavailable = manager.getUnavailableAccounts();
      expect(unavailable).toContain('account-1');
      expect(unavailable).toContain('account-2');
      expect(unavailable).toHaveLength(2);
    });

    it('should return accounts in cooldown', () => {
      manager.startCooldown('account-3');

      const unavailable = manager.getUnavailableAccounts();
      expect(unavailable).toContain('account-3');
    });

    it('should not return accounts that are no longer rate limited', () => {
      manager.markRateLimited('account-1', 'anthropic', 1);

      expect(manager.getUnavailableAccounts()).toContain('account-1');

      vi.advanceTimersByTime(2000);

      expect(manager.getUnavailableAccounts()).not.toContain('account-1');
    });
  });

  describe('cleanup', () => {
    it('should remove expired rate limit states', () => {
      manager.markRateLimited('account-1', 'anthropic', 1);
      manager.markRateLimited('account-2', 'openai', 10);

      expect(manager.getState('account-1')).toBeDefined();
      expect(manager.getState('account-2')).toBeDefined();

      vi.advanceTimersByTime(2000); // Advance 2 seconds

      manager.cleanup();

      expect(manager.getState('account-1')).toBeNull(); // Should be cleaned up
      expect(manager.getState('account-2')).toBeDefined(); // Should remain
    });

    it('should remove expired cooldown states', () => {
      manager.startCooldown('account-1');

      expect(manager.getState('account-1')).toBeDefined();

      vi.advanceTimersByTime(config.cooldownMs + 1000); // Advance past cooldown

      manager.cleanup();

      expect(manager.getState('account-1')).toBeNull();
    });
  });

  describe('configuration', () => {
    it('should use provided configuration', () => {
      const customConfig = {
        maxRetries: 5,
        baseDelayMs: 2000,
        maxDelayMs: 60000,
        failoverEnabled: false,
        cooldownMs: 120000,
        jitterFactor: 0.2,
      };

      const customManager = new RateLimitManager(customConfig);
      expect(customManager.getConfig()).toEqual(customConfig);
    });

    it('should allow configuration updates', () => {
      const updates = { maxRetries: 5, baseDelayMs: 2000 };
      manager.updateConfig(updates);

      const updatedConfig = manager.getConfig();
      expect(updatedConfig.maxRetries).toBe(5);
      expect(updatedConfig.baseDelayMs).toBe(2000);
      expect(updatedConfig.failoverEnabled).toBe(config.failoverEnabled); // Should preserve other values
    });
  });
});