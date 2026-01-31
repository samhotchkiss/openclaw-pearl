import { describe, it, expect, beforeEach } from 'vitest';
import { ModelRouter } from '../src/routing/router.js';
import { RuleEngine, RoutingRule } from '../src/routing/rules.js';
import type { RequestClassification, Message } from '../src/routing/types.js';

describe('ModelRouter', () => {
  let router: ModelRouter;
  let mockRuleEngine: RuleEngine;

  const defaultRules: RoutingRule[] = [
    {
      name: 'sensitive-local',
      match: { sensitive: true },
      model: 'ollama/llama3.1:70b',
      priority: 100,
    },
    {
      name: 'code-tasks',
      match: { type: 'code' },
      model: 'anthropic/claude-sonnet-4-20250514',
      priority: 50,
    },
    {
      name: 'simple-fast',
      match: { complexity: 'low', estimatedTokens: '<500' },
      model: 'anthropic/claude-3-5-haiku-20241022',
      priority: 30,
    },
    {
      name: 'high-complexity',
      match: { complexity: 'high' },
      model: 'anthropic/claude-opus-4-5',
      priority: 40,
    },
    {
      name: 'default',
      match: { default: true },
      model: 'anthropic/claude-sonnet-4-20250514',
      priority: 0,
    },
  ];

  beforeEach(() => {
    mockRuleEngine = new RuleEngine(defaultRules);
    router = new ModelRouter(mockRuleEngine);
  });

  describe('Model Selection', () => {
    it('should route sensitive content to local model', async () => {
      const classification: RequestClassification = {
        complexity: 'medium',
        type: 'general',
        sensitive: true,
        estimatedTokens: 300,
        requiresTools: false,
      };

      const model = await router.selectModel(classification);
      expect(model).toBe('ollama/llama3.1:70b');
    });

    it('should route code tasks to Claude Sonnet', async () => {
      const classification: RequestClassification = {
        complexity: 'medium',
        type: 'code',
        sensitive: false,
        estimatedTokens: 800,
        requiresTools: false,
      };

      const model = await router.selectModel(classification);
      expect(model).toBe('anthropic/claude-sonnet-4-20250514');
    });

    it('should route low complexity, short requests to Haiku', async () => {
      const classification: RequestClassification = {
        complexity: 'low',
        type: 'general',
        sensitive: false,
        estimatedTokens: 200,
        requiresTools: false,
      };

      const model = await router.selectModel(classification);
      expect(model).toBe('anthropic/claude-3-5-haiku-20241022');
    });

    it('should route high complexity tasks to Opus', async () => {
      const classification: RequestClassification = {
        complexity: 'high',
        type: 'analysis',
        sensitive: false,
        estimatedTokens: 1500,
        requiresTools: false,
      };

      const model = await router.selectModel(classification);
      expect(model).toBe('anthropic/claude-opus-4-5');
    });

    it('should use default model when no specific rules match', async () => {
      const classification: RequestClassification = {
        complexity: 'medium',
        type: 'general',
        sensitive: false,
        estimatedTokens: 600,
        requiresTools: false,
      };

      const model = await router.selectModel(classification);
      expect(model).toBe('anthropic/claude-sonnet-4-20250514');
    });
  });

  describe('Priority Ordering', () => {
    it('should prioritize sensitive detection over other rules', async () => {
      const classification: RequestClassification = {
        complexity: 'low', // Would normally match simple-fast rule
        type: 'code', // Would normally match code-tasks rule
        sensitive: true, // Should override both
        estimatedTokens: 200,
        requiresTools: false,
      };

      const model = await router.selectModel(classification);
      expect(model).toBe('ollama/llama3.1:70b');
    });

    it('should prioritize code over complexity rules when both match', async () => {
      const classification: RequestClassification = {
        complexity: 'high', // Would match high-complexity rule (priority 40)
        type: 'code', // Matches code-tasks rule (priority 50)
        sensitive: false,
        estimatedTokens: 1000,
        requiresTools: false,
      };

      const model = await router.selectModel(classification);
      expect(model).toBe('anthropic/claude-sonnet-4-20250514'); // Code rule wins
    });
  });

  describe('Agent-Specific Overrides', () => {
    it('should apply agent-specific model overrides', async () => {
      const agentOverrides = {
        'test-agent': 'ollama/llama3.2:3b',
      };
      
      const routerWithOverrides = new ModelRouter(mockRuleEngine, { agentOverrides });
      
      const classification: RequestClassification = {
        complexity: 'low',
        type: 'general',
        sensitive: false,
        estimatedTokens: 200,
        requiresTools: false,
      };

      const model = await routerWithOverrides.selectModel(classification, 'test-agent');
      expect(model).toBe('ollama/llama3.2:3b');
    });

    it('should fall back to rules when agent has no override', async () => {
      const agentOverrides = {
        'test-agent': 'ollama/llama3.2:3b',
      };
      
      const routerWithOverrides = new ModelRouter(mockRuleEngine, { agentOverrides });
      
      const classification: RequestClassification = {
        complexity: 'low',
        type: 'general',
        sensitive: false,
        estimatedTokens: 200,
        requiresTools: false,
      };

      const model = await routerWithOverrides.selectModel(classification, 'other-agent');
      expect(model).toBe('anthropic/claude-3-5-haiku-20241022'); // Falls back to rules
    });
  });

  describe('Fallback Chains', () => {
    it('should support fallback chains for model failures', async () => {
      const fallbackChains = {
        'ollama/llama3.1:70b': ['ollama/llama3.2:3b', 'anthropic/claude-sonnet-4-20250514'],
        'anthropic/claude-opus-4-5': ['anthropic/claude-sonnet-4-20250514', 'anthropic/claude-3-5-haiku-20241022'],
      };

      const routerWithFallbacks = new ModelRouter(mockRuleEngine, { fallbackChains });

      // Test getting fallbacks for a model
      const fallbacks = routerWithFallbacks.getFallbackChain('ollama/llama3.1:70b');
      expect(fallbacks).toEqual(['ollama/llama3.2:3b', 'anthropic/claude-sonnet-4-20250514']);
    });

    it('should return empty array when no fallbacks exist', async () => {
      const routerWithoutFallbacks = new ModelRouter(mockRuleEngine);
      
      const fallbacks = routerWithoutFallbacks.getFallbackChain('some-unknown-model');
      expect(fallbacks).toEqual([]);
    });
  });

  describe('Full Routing Workflow', () => {
    it('should classify and route in one step', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'My SSN is 123-45-6789, can you help me file taxes?' }
      ];

      const result = await router.route(messages);
      expect(result.model).toBe('ollama/llama3.1:70b');
      expect(result.classification.sensitive).toBe(true);
      expect(result.rule).toBe('sensitive-local');
    });

    it('should return detailed routing information', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Debug this JavaScript async function' }
      ];

      const result = await router.route(messages);
      expect(result.model).toBe('anthropic/claude-sonnet-4-20250514');
      expect(result.classification.type).toBe('code');
      expect(result.rule).toBe('code-tasks');
      expect(result.fallbacks).toBeDefined();
    });
  });
});

describe('RuleEngine', () => {
  let ruleEngine: RuleEngine;

  const testRules: RoutingRule[] = [
    {
      name: 'sensitive',
      match: { sensitive: true },
      model: 'local-model',
      priority: 100,
    },
    {
      name: 'small-requests',
      match: { estimatedTokens: '<500' },
      model: 'fast-model',
      priority: 50,
    },
    {
      name: 'large-requests',
      match: { estimatedTokens: '>1000' },
      model: 'powerful-model',
      priority: 40,
    },
    {
      name: 'code-medium',
      match: { type: 'code', complexity: 'medium' },
      model: 'code-model',
      priority: 60,
    },
    {
      name: 'default',
      match: { default: true },
      model: 'default-model',
      priority: 0,
    },
  ];

  beforeEach(() => {
    ruleEngine = new RuleEngine(testRules);
  });

  describe('Rule Matching', () => {
    it('should match single condition rules', () => {
      const classification: RequestClassification = {
        complexity: 'low',
        type: 'general',
        sensitive: true,
        estimatedTokens: 300,
        requiresTools: false,
      };

      const result = ruleEngine.findMatchingRule(classification);
      expect(result?.name).toBe('sensitive');
    });

    it('should match multiple condition rules', () => {
      const classification: RequestClassification = {
        complexity: 'medium',
        type: 'code',
        sensitive: false,
        estimatedTokens: 600,
        requiresTools: false,
      };

      const result = ruleEngine.findMatchingRule(classification);
      expect(result?.name).toBe('code-medium');
    });

    it('should match token comparison operators', () => {
      const smallRequest: RequestClassification = {
        complexity: 'low',
        type: 'general',
        sensitive: false,
        estimatedTokens: 300,
        requiresTools: false,
      };

      const largeRequest: RequestClassification = {
        complexity: 'high',
        type: 'general',
        sensitive: false,
        estimatedTokens: 1500,
        requiresTools: false,
      };

      const smallResult = ruleEngine.findMatchingRule(smallRequest);
      expect(smallResult?.name).toBe('small-requests');

      const largeResult = ruleEngine.findMatchingRule(largeRequest);
      expect(largeResult?.name).toBe('large-requests');
    });

    it('should prioritize rules correctly', () => {
      const classification: RequestClassification = {
        complexity: 'low',
        type: 'general',
        sensitive: true, // Matches sensitive (priority 100)
        estimatedTokens: 300, // Also matches small-requests (priority 50)
        requiresTools: false,
      };

      const result = ruleEngine.findMatchingRule(classification);
      expect(result?.name).toBe('sensitive'); // Higher priority rule should win
    });

    it('should fall back to default rule when no specific rules match', () => {
      const classification: RequestClassification = {
        complexity: 'medium',
        type: 'general',
        sensitive: false,
        estimatedTokens: 750, // Doesn't match any token rules
        requiresTools: false,
      };

      const result = ruleEngine.findMatchingRule(classification);
      expect(result?.name).toBe('default');
    });

    it('should handle edge cases in token comparisons', () => {
      const exactBoundary: RequestClassification = {
        complexity: 'low',
        type: 'general',
        sensitive: false,
        estimatedTokens: 500, // Exactly 500 - should NOT match "<500"
        requiresTools: false,
      };

      const result = ruleEngine.findMatchingRule(exactBoundary);
      expect(result?.name).toBe('default'); // Should fall back to default
    });
  });

  describe('Token Comparison', () => {
    it('should parse and evaluate less-than operators', () => {
      const rule: RoutingRule = {
        name: 'test',
        match: { estimatedTokens: '<1000' },
        model: 'test-model',
        priority: 10,
      };

      expect(ruleEngine.matchesRule({ estimatedTokens: 500 } as RequestClassification, rule)).toBe(true);
      expect(ruleEngine.matchesRule({ estimatedTokens: 1000 } as RequestClassification, rule)).toBe(false);
      expect(ruleEngine.matchesRule({ estimatedTokens: 1500 } as RequestClassification, rule)).toBe(false);
    });

    it('should parse and evaluate greater-than operators', () => {
      const rule: RoutingRule = {
        name: 'test',
        match: { estimatedTokens: '>500' },
        model: 'test-model',
        priority: 10,
      };

      expect(ruleEngine.matchesRule({ estimatedTokens: 300 } as RequestClassification, rule)).toBe(false);
      expect(ruleEngine.matchesRule({ estimatedTokens: 500 } as RequestClassification, rule)).toBe(false);
      expect(ruleEngine.matchesRule({ estimatedTokens: 800 } as RequestClassification, rule)).toBe(true);
    });

    it('should parse and evaluate less-than-or-equal operators', () => {
      const rule: RoutingRule = {
        name: 'test',
        match: { estimatedTokens: '<=1000' },
        model: 'test-model',
        priority: 10,
      };

      expect(ruleEngine.matchesRule({ estimatedTokens: 500 } as RequestClassification, rule)).toBe(true);
      expect(ruleEngine.matchesRule({ estimatedTokens: 1000 } as RequestClassification, rule)).toBe(true);
      expect(ruleEngine.matchesRule({ estimatedTokens: 1500 } as RequestClassification, rule)).toBe(false);
    });

    it('should parse and evaluate greater-than-or-equal operators', () => {
      const rule: RoutingRule = {
        name: 'test',
        match: { estimatedTokens: '>=500' },
        model: 'test-model',
        priority: 10,
      };

      expect(ruleEngine.matchesRule({ estimatedTokens: 300 } as RequestClassification, rule)).toBe(false);
      expect(ruleEngine.matchesRule({ estimatedTokens: 500 } as RequestClassification, rule)).toBe(true);
      expect(ruleEngine.matchesRule({ estimatedTokens: 800 } as RequestClassification, rule)).toBe(true);
    });
  });
});