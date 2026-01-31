import { describe, it, expect, beforeEach } from 'vitest';
import { AccountRegistry } from '../src/accounts/registry.js';
import { AccountRouter } from '../src/accounts/router.js';
import type { Account, AccountConfig, RoutingRule, RoutingContext } from '../src/accounts/types.js';

describe('AccountRegistry', () => {
  let registry: AccountRegistry;

  const testAccounts: AccountConfig[] = [
    {
      id: 'claude_production',
      provider: 'anthropic',
      apiKey: 'sk-ant-test-prod',
      budgetMonthlyUsd: 100,
    },
    {
      id: 'claude_max',
      provider: 'anthropic',
      type: 'oauth',
      // OAuth tokens managed separately
    },
    {
      id: 'openai_backup',
      provider: 'openai',
      apiKey: 'sk-openai-test',
      budgetMonthlyUsd: 50,
    },
    {
      id: 'local_private',
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      // No budget (free)
    },
  ];

  beforeEach(() => {
    registry = new AccountRegistry();
    for (const account of testAccounts) {
      registry.register(account);
    }
  });

  describe('Account Registration', () => {
    it('should register and retrieve accounts', () => {
      const account = registry.get('claude_production');
      expect(account).toBeDefined();
      expect(account?.provider).toBe('anthropic');
      expect(account?.id).toBe('claude_production');
    });

    it('should return undefined for unknown accounts', () => {
      const account = registry.get('nonexistent');
      expect(account).toBeUndefined();
    });

    it('should list all registered accounts', () => {
      const accounts = registry.list();
      expect(accounts).toHaveLength(4);
      expect(accounts.map(a => a.id)).toContain('claude_production');
      expect(accounts.map(a => a.id)).toContain('local_private');
    });

    it('should list accounts by provider', () => {
      const anthropicAccounts = registry.listByProvider('anthropic');
      expect(anthropicAccounts).toHaveLength(2);
      expect(anthropicAccounts.map(a => a.id)).toContain('claude_production');
      expect(anthropicAccounts.map(a => a.id)).toContain('claude_max');
    });

    it('should update an existing account', () => {
      registry.update('claude_production', { budgetMonthlyUsd: 200 });
      const account = registry.get('claude_production');
      expect(account?.budgetMonthlyUsd).toBe(200);
    });

    it('should remove an account', () => {
      const removed = registry.remove('openai_backup');
      expect(removed).toBe(true);
      expect(registry.get('openai_backup')).toBeUndefined();
      expect(registry.list()).toHaveLength(3);
    });
  });

  describe('Budget Tracking', () => {
    it('should track usage for an account', () => {
      registry.recordUsage('claude_production', 5.50);
      const account = registry.get('claude_production');
      expect(account?.usageCurrentMonthUsd).toBe(5.50);
    });

    it('should accumulate usage over multiple calls', () => {
      registry.recordUsage('claude_production', 5.50);
      registry.recordUsage('claude_production', 3.25);
      const account = registry.get('claude_production');
      expect(account?.usageCurrentMonthUsd).toBe(8.75);
    });

    it('should report budget status correctly', () => {
      registry.recordUsage('claude_production', 85);
      const status = registry.getBudgetStatus('claude_production');
      expect(status?.used).toBe(85);
      expect(status?.budget).toBe(100);
      expect(status?.remaining).toBe(15);
      expect(status?.percentUsed).toBe(85);
      expect(status?.isOverBudget).toBe(false);
      expect(status?.isNearBudget).toBe(true); // > 80%
    });

    it('should detect over-budget accounts', () => {
      registry.recordUsage('claude_production', 110);
      const status = registry.getBudgetStatus('claude_production');
      expect(status?.isOverBudget).toBe(true);
    });

    it('should handle accounts without budgets', () => {
      const status = registry.getBudgetStatus('local_private');
      expect(status?.budget).toBeUndefined();
      expect(status?.isOverBudget).toBe(false);
    });

    it('should reset monthly usage', () => {
      registry.recordUsage('claude_production', 50);
      registry.resetMonthlyUsage('claude_production');
      const account = registry.get('claude_production');
      expect(account?.usageCurrentMonthUsd).toBe(0);
    });
  });
});

describe('AccountRouter', () => {
  let registry: AccountRegistry;
  let router: AccountRouter;

  const testAccounts: AccountConfig[] = [
    {
      id: 'claude_production',
      provider: 'anthropic',
      apiKey: 'sk-ant-test-prod',
      budgetMonthlyUsd: 100,
    },
    {
      id: 'claude_max',
      provider: 'anthropic',
      type: 'oauth',
    },
    {
      id: 'openai_backup',
      provider: 'openai',
      apiKey: 'sk-openai-test',
      budgetMonthlyUsd: 50,
    },
    {
      id: 'local_private',
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
    },
  ];

  const testRules: RoutingRule[] = [
    {
      name: 'sensitive-local',
      match: { sensitive: true },
      account: 'local_private',
      priority: 100,
    },
    {
      name: 'dev-subscription',
      match: { agentId: 'dev-*' },
      account: 'claude_max',
      priority: 80,
    },
    {
      name: 'production-default',
      match: { default: true },
      account: 'claude_production',
      fallback: 'openai_backup',
      priority: 0,
    },
  ];

  beforeEach(() => {
    registry = new AccountRegistry();
    for (const account of testAccounts) {
      registry.register(account);
    }
    router = new AccountRouter(registry, testRules);
  });

  describe('Sensitivity-Based Routing', () => {
    it('should route sensitive content to local account', () => {
      const context: RoutingContext = {
        sensitive: true,
      };
      
      const result = router.route(context);
      expect(result.account.id).toBe('local_private');
      expect(result.rule).toBe('sensitive-local');
    });

    it('should not route non-sensitive content to local', () => {
      const context: RoutingContext = {
        sensitive: false,
      };
      
      const result = router.route(context);
      expect(result.account.id).not.toBe('local_private');
    });
  });

  describe('Agent ID Pattern Matching', () => {
    it('should match agent ID with wildcard pattern', () => {
      const context: RoutingContext = {
        agentId: 'dev-frontend',
      };
      
      const result = router.route(context);
      expect(result.account.id).toBe('claude_max');
      expect(result.rule).toBe('dev-subscription');
    });

    it('should match different agents with same prefix', () => {
      const context: RoutingContext = {
        agentId: 'dev-backend',
      };
      
      const result = router.route(context);
      expect(result.account.id).toBe('claude_max');
    });

    it('should not match agents without prefix', () => {
      const context: RoutingContext = {
        agentId: 'production-app',
      };
      
      const result = router.route(context);
      expect(result.account.id).toBe('claude_production'); // Falls to default
    });
  });

  describe('Fallback Chains', () => {
    it('should provide fallback account when primary fails', () => {
      const context: RoutingContext = {};
      
      const result = router.route(context);
      expect(result.account.id).toBe('claude_production');
      expect(result.fallback?.id).toBe('openai_backup');
    });

    it('should use fallback when primary is over budget', () => {
      // Put production account over budget
      registry.recordUsage('claude_production', 110);
      
      const context: RoutingContext = {};
      const result = router.route(context, { respectBudget: true });
      
      expect(result.account.id).toBe('openai_backup');
      expect(result.reason).toContain('over budget');
    });
  });

  describe('Budget Enforcement', () => {
    it('should warn when approaching budget', () => {
      registry.recordUsage('claude_production', 85);
      
      const context: RoutingContext = {};
      const result = router.route(context);
      
      expect(result.warning).toContain('budget');
    });

    it('should block over-budget accounts when enforced', () => {
      registry.recordUsage('claude_production', 110);
      registry.recordUsage('openai_backup', 60); // Fallback also over budget
      
      const context: RoutingContext = {};
      
      expect(() => {
        router.route(context, { respectBudget: true, strict: true });
      }).toThrow(/budget/);
    });

    it('should allow over-budget when not enforced', () => {
      registry.recordUsage('claude_production', 110);
      
      const context: RoutingContext = {};
      const result = router.route(context, { respectBudget: false });
      
      expect(result.account.id).toBe('claude_production');
      expect(result.warning).toContain('over budget');
    });
  });

  describe('Priority Ordering', () => {
    it('should respect rule priority', () => {
      // Sensitive + dev agent: sensitive should win (priority 100 > 80)
      const context: RoutingContext = {
        sensitive: true,
        agentId: 'dev-test',
      };
      
      const result = router.route(context);
      expect(result.account.id).toBe('local_private');
      expect(result.rule).toBe('sensitive-local');
    });
  });

  describe('Complex Matching', () => {
    it('should support multiple match conditions', () => {
      const complexRules: RoutingRule[] = [
        {
          name: 'prod-code',
          match: { 
            agentId: 'prod-*',
            type: 'code',
          },
          account: 'claude_production',
          priority: 90,
        },
        {
          name: 'default',
          match: { default: true },
          account: 'local_private',
          priority: 0,
        },
      ];
      
      const complexRouter = new AccountRouter(registry, complexRules);
      
      // Both conditions match
      const result1 = complexRouter.route({
        agentId: 'prod-api',
        type: 'code',
      });
      expect(result1.account.id).toBe('claude_production');
      
      // Only one condition matches - should fall to default
      const result2 = complexRouter.route({
        agentId: 'prod-api',
        type: 'chat',
      });
      expect(result2.account.id).toBe('local_private');
    });
  });

  describe('Routing Result', () => {
    it('should include routing metadata', () => {
      const context: RoutingContext = {
        agentId: 'dev-test',
      };
      
      const result = router.route(context);
      
      expect(result.account).toBeDefined();
      expect(result.rule).toBe('dev-subscription');
      expect(result.fallback).toBeUndefined(); // dev-subscription has no fallback
      expect(result.reason).toContain('dev-subscription');
    });
  });
});

describe('Account Configuration Loading', () => {
  it('should create registry from config object', () => {
    const config = {
      accounts: {
        claude_production: {
          provider: 'anthropic',
          apiKey: '${ANTHROPIC_API_KEY}',
          budgetMonthlyUsd: 100,
        },
        local_private: {
          provider: 'ollama',
          baseUrl: 'http://localhost:11434',
        },
      },
      routing: {
        rules: [
          {
            name: 'sensitive-local',
            match: { sensitive: true },
            account: 'local_private',
          },
          {
            name: 'default',
            match: { default: true },
            account: 'claude_production',
            fallback: 'local_private',
          },
        ],
      },
    };
    
    const registry = AccountRegistry.fromConfig(config.accounts);
    expect(registry.list()).toHaveLength(2);
    expect(registry.get('claude_production')).toBeDefined();
    expect(registry.get('local_private')).toBeDefined();
  });
});
