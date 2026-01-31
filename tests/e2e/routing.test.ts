/**
 * E2E Tests - Model Routing
 * Tests the full routing flow: classify → apply rules → select model
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelRouter, type RouterOptions } from '../../src/routing/router.js';
import { RuleEngine } from '../../src/routing/rules.js';
import type { RoutingRule, RequestClassification } from '../../src/routing/types.js';

// Mock classifier that returns deterministic classifications
const createMockClassifier = () => ({
  classify: vi.fn().mockImplementation(async (messages: any[]): Promise<RequestClassification> => {
    const lastMessage = messages[messages.length - 1]?.content || '';
    const content = lastMessage.toLowerCase();
    
    // Determine complexity
    let complexity: 'low' | 'medium' | 'high' = 'medium';
    if (content.length < 50 && !content.includes('explain') && !content.includes('analyze')) {
      complexity = 'low';
    } else if (content.includes('complex') || content.includes('detailed') || content.includes('analyze')) {
      complexity = 'high';
    }
    
    // Determine type
    let type: 'general' | 'code' | 'creative' | 'analysis' | 'chat' = 'general';
    if (content.includes('code') || content.includes('function') || content.includes('bug') || content.includes('typescript')) {
      type = 'code';
    } else if (content.includes('story') || content.includes('creative') || content.includes('write')) {
      type = 'creative';
    } else if (content.includes('analyze') || content.includes('explain')) {
      type = 'analysis';
    }
    
    // Determine sensitivity
    const sensitive = /\b\d{3}-\d{2}-\d{4}\b/.test(content) || // SSN pattern
                     content.includes('password') ||
                     content.includes('secret') ||
                     content.includes('confidential');
    
    return {
      complexity,
      type,
      sensitive,
      estimatedTokens: content.length / 4,
      requiresTools: content.includes('search') || content.includes('browse'),
    };
  }),
});

describe('E2E: Model Routing Flow', () => {
  let router: ModelRouter;
  let ruleEngine: RuleEngine;
  
  const defaultModel = 'anthropic/claude-sonnet-4-20250514';
  
  const createRouter = (rules: RoutingRule[], options?: Partial<RouterOptions>) => {
    ruleEngine = new RuleEngine(rules);
    router = new ModelRouter(ruleEngine, {
      classificationOptions: {
        classifier: createMockClassifier() as any,
      },
      ...options,
    });
    return router;
  };

  describe('complexity-based routing', () => {
    beforeEach(() => {
      const rules: RoutingRule[] = [
        {
          name: 'simple-to-haiku',
          match: { complexity: 'low' },
          model: 'anthropic/claude-3-5-haiku-20241022',
          priority: 10,
        },
        {
          name: 'complex-to-opus',
          match: { complexity: 'high' },
          model: 'anthropic/claude-opus-4-20250514',
          priority: 10,
        },
        {
          name: 'default',
          match: { default: true },
          model: defaultModel,
          priority: 0,
        },
      ];
      createRouter(rules);
    });

    it('should route simple queries to Haiku', async () => {
      const messages = [{ role: 'user' as const, content: 'Hi there!' }];
      
      const result = await router.route(messages);
      
      expect(result.model).toBe('anthropic/claude-3-5-haiku-20241022');
      expect(result.rule).toBe('simple-to-haiku');
    });

    it('should route complex queries to Opus', async () => {
      const messages = [{ 
        role: 'user' as const, 
        content: 'Please provide a detailed analysis of the complex architectural decisions involved' 
      }];
      
      const result = await router.route(messages);
      
      expect(result.model).toBe('anthropic/claude-opus-4-20250514');
      expect(result.rule).toBe('complex-to-opus');
    });

    it('should route medium complexity to default', async () => {
      const messages = [{ 
        role: 'user' as const, 
        content: 'What is the capital of France and why is it historically significant?' 
      }];
      
      const result = await router.route(messages);
      
      expect(result.model).toBe(defaultModel);
    });
  });

  describe('type-based routing', () => {
    beforeEach(() => {
      const rules: RoutingRule[] = [
        {
          name: 'code-to-sonnet',
          match: { type: 'code' },
          model: 'anthropic/claude-sonnet-4-20250514',
          priority: 10,
        },
        {
          name: 'creative-to-opus',
          match: { type: 'creative' },
          model: 'anthropic/claude-opus-4-20250514',
          priority: 10,
        },
        {
          name: 'default',
          match: { default: true },
          model: 'anthropic/claude-3-5-haiku-20241022',
          priority: 0,
        },
      ];
      createRouter(rules);
    });

    it('should route code questions to Sonnet', async () => {
      const messages = [{ 
        role: 'user' as const, 
        content: 'Can you help me fix this bug in my TypeScript code?' 
      }];
      
      const result = await router.route(messages);
      
      expect(result.model).toBe('anthropic/claude-sonnet-4-20250514');
      expect(result.classification.type).toBe('code');
    });

    it('should route creative requests to Opus', async () => {
      const messages = [{ 
        role: 'user' as const, 
        content: 'Write me a creative story about a robot' 
      }];
      
      const result = await router.route(messages);
      
      expect(result.model).toBe('anthropic/claude-opus-4-20250514');
      expect(result.classification.type).toBe('creative');
    });
  });

  describe('sensitivity-based routing', () => {
    beforeEach(() => {
      const rules: RoutingRule[] = [
        {
          name: 'sensitive-to-local',
          match: { sensitive: true },
          model: 'ollama/llama3.1:70b',
          priority: 100, // High priority
        },
        {
          name: 'default',
          match: { default: true },
          model: defaultModel,
          priority: 0,
        },
      ];
      createRouter(rules);
    });

    it('should route sensitive content to local model', async () => {
      const messages = [{ 
        role: 'user' as const, 
        content: 'My SSN is 123-45-6789, can you verify it?' 
      }];
      
      const result = await router.route(messages);
      
      expect(result.model).toBe('ollama/llama3.1:70b');
      expect(result.classification.sensitive).toBe(true);
    });

    it('should route password-related content to local model', async () => {
      const messages = [{ 
        role: 'user' as const, 
        content: 'My password is abc123, is it secure?' 
      }];
      
      const result = await router.route(messages);
      
      expect(result.model).toBe('ollama/llama3.1:70b');
    });

    it('should route non-sensitive content to default', async () => {
      const messages = [{ 
        role: 'user' as const, 
        content: 'What is the weather like today?' 
      }];
      
      const result = await router.route(messages);
      
      expect(result.model).toBe(defaultModel);
      expect(result.classification.sensitive).toBe(false);
    });
  });

  describe('agent overrides', () => {
    beforeEach(() => {
      const rules: RoutingRule[] = [
        {
          name: 'default',
          match: { default: true },
          model: defaultModel,
          priority: 0,
        },
      ];
      createRouter(rules, {
        agentOverrides: {
          'premium-agent': 'anthropic/claude-opus-4-20250514',
          'budget-agent': 'anthropic/claude-3-5-haiku-20241022',
        },
      });
    });

    it('should apply agent-specific model override', async () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];
      
      const result = await router.route(messages, 'premium-agent');
      
      expect(result.model).toBe('anthropic/claude-opus-4-20250514');
    });

    it('should use default for agents without override', async () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];
      
      const result = await router.route(messages, 'regular-agent');
      
      expect(result.model).toBe(defaultModel);
    });
  });

  describe('fallback chains', () => {
    beforeEach(() => {
      const rules: RoutingRule[] = [
        {
          name: 'primary',
          match: { default: true },
          model: 'anthropic/claude-opus-4-20250514',
          priority: 0,
        },
      ];
      createRouter(rules, {
        fallbackChains: {
          'anthropic/claude-opus-4-20250514': [
            'anthropic/claude-sonnet-4-20250514',
            'anthropic/claude-3-5-haiku-20241022',
          ],
        },
      });
    });

    it('should include fallback models in result', async () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];
      
      const result = await router.route(messages);
      
      expect(result.model).toBe('anthropic/claude-opus-4-20250514');
      expect(result.fallbacks).toEqual([
        'anthropic/claude-sonnet-4-20250514',
        'anthropic/claude-3-5-haiku-20241022',
      ]);
    });
  });

  describe('rule priority', () => {
    it('should apply higher priority rules first', async () => {
      const rules: RoutingRule[] = [
        {
          name: 'low-priority',
          match: { type: 'code' },
          model: 'anthropic/claude-3-5-haiku-20241022',
          priority: 1,
        },
        {
          name: 'high-priority',
          match: { type: 'code' },
          model: 'anthropic/claude-sonnet-4-20250514',
          priority: 10,
        },
      ];
      createRouter(rules);
      
      const messages = [{ role: 'user' as const, content: 'Fix this code bug' }];
      const result = await router.route(messages);
      
      expect(result.model).toBe('anthropic/claude-sonnet-4-20250514');
      expect(result.rule).toBe('high-priority');
    });
  });
});
