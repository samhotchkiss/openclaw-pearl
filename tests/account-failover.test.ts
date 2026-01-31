import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AccountFailover } from '../src/ratelimit/failover.js';
import { AccountRegistry } from '../src/accounts/registry.js';
import { RateLimitManager } from '../src/ratelimit/manager.js';
import type { Account } from '../src/accounts/types.js';
import type { RateLimitConfig } from '../src/ratelimit/types.js';

describe('AccountFailover', () => {
  let failover: AccountFailover;
  let registry: AccountRegistry;
  let rateLimitManager: RateLimitManager;
  let config: RateLimitConfig;

  const mockAccounts: Account[] = [
    {
      id: 'anthropic-1',
      provider: 'anthropic',
      apiKey: 'key1',
      enabled: true,
      usageCurrentMonthUsd: 0,
    },
    {
      id: 'anthropic-2',
      provider: 'anthropic',
      apiKey: 'key2',
      enabled: true,
      usageCurrentMonthUsd: 0,
    },
    {
      id: 'openai-1',
      provider: 'openai',
      apiKey: 'key3',
      enabled: true,
      usageCurrentMonthUsd: 0,
    },
    {
      id: 'disabled-account',
      provider: 'anthropic',
      apiKey: 'key4',
      enabled: false,
      usageCurrentMonthUsd: 0,
    },
  ];

  beforeEach(() => {
    config = {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      failoverEnabled: true,
      cooldownMs: 60000,
      jitterFactor: 0.1,
    };

    registry = new AccountRegistry();
    rateLimitManager = new RateLimitManager(config);
    failover = new AccountFailover(registry, rateLimitManager, config);

    // Register mock accounts
    mockAccounts.forEach(account => {
      registry.register(account);
    });

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('findAlternativeAccount', () => {
    it('should find alternative account for same provider', async () => {
      const result = await failover.findAlternativeAccount('anthropic-1', 'anthropic');

      expect(result.success).toBe(true);
      expect(result.accountId).toBe('anthropic-2');
      expect(result.reason).toContain('alternative account');
      expect(result.consideredAccounts).toContain('anthropic-2');
    });

    it('should exclude disabled accounts', async () => {
      // Mark anthropic-2 as disabled
      registry.get('anthropic-2')!.enabled = false;

      const result = await failover.findAlternativeAccount('anthropic-1', 'anthropic');

      expect(result.success).toBe(false);
      expect(result.accountId).toBeUndefined();
      expect(result.skippedAccounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            accountId: 'anthropic-2',
            reason: expect.stringContaining('disabled'),
          }),
        ])
      );
    });

    it('should exclude rate limited accounts', async () => {
      rateLimitManager.markRateLimited('anthropic-2', 'anthropic');

      const result = await failover.findAlternativeAccount('anthropic-1', 'anthropic');

      expect(result.success).toBe(false);
      expect(result.skippedAccounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            accountId: 'anthropic-2',
            reason: expect.stringContaining('unavailable'),
          }),
        ])
      );
    });

    it('should exclude accounts in cooldown', async () => {
      rateLimitManager.startCooldown('anthropic-2');

      const result = await failover.findAlternativeAccount('anthropic-1', 'anthropic');

      expect(result.success).toBe(false);
      expect(result.skippedAccounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            accountId: 'anthropic-2',
            reason: expect.stringContaining('unavailable'),
          }),
        ])
      );
    });

    it('should exclude explicitly provided excluded accounts', async () => {
      const result = await failover.findAlternativeAccount(
        'anthropic-1',
        'anthropic',
        ['anthropic-2']
      );

      expect(result.success).toBe(false);
      expect(result.skippedAccounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            accountId: 'anthropic-2',
            reason: expect.stringContaining('excluded'),
          }),
        ])
      );
    });

    it('should not consider accounts from different providers', async () => {
      const result = await failover.findAlternativeAccount('anthropic-1', 'anthropic');

      expect(result.consideredAccounts).not.toContain('openai-1');
      expect(result.skippedAccounts.find(s => s.accountId === 'openai-1')).toBeUndefined();
    });

    it('should handle case where no alternatives exist', async () => {
      const result = await failover.findAlternativeAccount('openai-1', 'openai');

      expect(result.success).toBe(false);
      expect(result.reason).toContain('No alternative accounts');
      expect(result.consideredAccounts).toHaveLength(0);
    });

    it('should select account with lowest usage when multiple alternatives exist', async () => {
      // Add another anthropic account
      const account3: Account = {
        id: 'anthropic-3',
        provider: 'anthropic',
        apiKey: 'key5',
        enabled: true,
        usageCurrentMonthUsd: 5.0, // Lower usage
      };
      registry.register(account3);

      // Set higher usage for anthropic-2
      registry.get('anthropic-2')!.usageCurrentMonthUsd = 10.0;

      const result = await failover.findAlternativeAccount('anthropic-1', 'anthropic');

      expect(result.success).toBe(true);
      expect(result.accountId).toBe('anthropic-3'); // Should prefer lower usage
    });

    it('should handle budget constraints when selecting alternatives', async () => {
      // Set budget limit and usage
      const account2 = registry.get('anthropic-2')!;
      account2.budgetMonthlyUsd = 10.0;
      account2.usageCurrentMonthUsd = 15.0; // Over budget

      const result = await failover.findAlternativeAccount('anthropic-1', 'anthropic');

      expect(result.success).toBe(false);
      expect(result.skippedAccounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            accountId: 'anthropic-2',
            reason: expect.stringContaining('over budget'),
          }),
        ])
      );
    });

    it('should handle failover when disabled in config', async () => {
      const disabledConfig = { ...config, failoverEnabled: false };
      const disabledFailover = new AccountFailover(registry, rateLimitManager, disabledConfig);

      const result = await disabledFailover.findAlternativeAccount('anthropic-1', 'anthropic');

      expect(result.success).toBe(false);
      expect(result.reason).toContain('disabled');
    });
  });

  describe('getAvailableAccounts', () => {
    it('should return all enabled accounts for provider', async () => {
      const accounts = await failover.getAvailableAccounts('anthropic');

      expect(accounts).toContain('anthropic-1');
      expect(accounts).toContain('anthropic-2');
      expect(accounts).not.toContain('openai-1'); // Different provider
      expect(accounts).not.toContain('disabled-account'); // Disabled
    });

    it('should exclude rate limited accounts', async () => {
      rateLimitManager.markRateLimited('anthropic-1', 'anthropic');

      const accounts = await failover.getAvailableAccounts('anthropic');

      expect(accounts).not.toContain('anthropic-1');
      expect(accounts).toContain('anthropic-2');
    });

    it('should exclude accounts in cooldown', async () => {
      rateLimitManager.startCooldown('anthropic-2');

      const accounts = await failover.getAvailableAccounts('anthropic');

      expect(accounts).toContain('anthropic-1');
      expect(accounts).not.toContain('anthropic-2');
    });

    it('should return empty array when no accounts available', async () => {
      rateLimitManager.markRateLimited('anthropic-1', 'anthropic');
      rateLimitManager.markRateLimited('anthropic-2', 'anthropic');

      const accounts = await failover.getAvailableAccounts('anthropic');

      expect(accounts).toHaveLength(0);
    });

    it('should exclude over-budget accounts', async () => {
      const account = registry.get('anthropic-1')!;
      account.budgetMonthlyUsd = 10.0;
      account.usageCurrentMonthUsd = 15.0;

      const accounts = await failover.getAvailableAccounts('anthropic');

      expect(accounts).not.toContain('anthropic-1');
      expect(accounts).toContain('anthropic-2');
    });
  });

  describe('account selection priority', () => {
    it('should prioritize accounts with lower usage', async () => {
      // Add multiple accounts with different usage levels
      const accounts = [
        { id: 'low-usage', usageCurrentMonthUsd: 1.0 },
        { id: 'medium-usage', usageCurrentMonthUsd: 5.0 },
        { id: 'high-usage', usageCurrentMonthUsd: 10.0 },
      ];

      accounts.forEach(({ id, usageCurrentMonthUsd }) => {
        registry.register({
          id,
          provider: 'anthropic',
          apiKey: 'test-key',
          enabled: true,
          usageCurrentMonthUsd,
        });
      });

      // Exclude anthropic-2 to test our new accounts priority
      const result = await failover.findAlternativeAccount('anthropic-1', 'anthropic', ['anthropic-2']);

      expect(result.success).toBe(true);
      expect(result.accountId).toBe('low-usage');
    });

    it('should handle accounts with identical usage', async () => {
      // Both accounts have same usage - should pick first available
      registry.get('anthropic-2')!.usageCurrentMonthUsd = 
        registry.get('anthropic-1')!.usageCurrentMonthUsd;

      const result = await failover.findAlternativeAccount('anthropic-1', 'anthropic');

      expect(result.success).toBe(true);
      expect(result.accountId).toBe('anthropic-2'); // Should be deterministic
    });
  });

  describe('error handling', () => {
    it('should handle registry errors gracefully', async () => {
      // Mock registry to throw error
      vi.spyOn(registry, 'getAllByProvider').mockRejectedValue(new Error('Registry error'));

      const result = await failover.findAlternativeAccount('anthropic-1', 'anthropic');

      expect(result.success).toBe(false);
      expect(result.reason).toContain('error');
    });

    it('should handle invalid provider gracefully', async () => {
      const result = await failover.findAlternativeAccount('test-1', 'invalid' as any);

      expect(result.success).toBe(false);
      expect(result.consideredAccounts).toHaveLength(0);
    });
  });
});