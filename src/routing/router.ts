/**
 * Model Router with Rules Engine
 * Routes requests to optimal models based on classification and rules
 */

import { RequestClassifier } from './classifier.js';
import { RuleEngine, type RoutingRule } from './rules.js';
import type { Message, RequestClassification, ClassificationOptions } from './types.js';

export interface RouterOptions {
  agentOverrides?: Record<string, string>; // agent_id -> model
  fallbackChains?: Record<string, string[]>; // model -> fallback_models
  classificationOptions?: ClassificationOptions;
}

export interface RoutingResult {
  model: string;
  classification: RequestClassification;
  rule: string;
  fallbacks: string[];
  agentId?: string;
}

export class ModelRouter {
  private classifier: RequestClassifier;
  private ruleEngine: RuleEngine;
  private options: RouterOptions;

  constructor(ruleEngine: RuleEngine, options: RouterOptions = {}) {
    this.classifier = new RequestClassifier();
    this.ruleEngine = ruleEngine;
    this.options = {
      agentOverrides: {},
      fallbackChains: {},
      classificationOptions: {},
      ...options,
    };
  }

  /**
   * Complete routing workflow: classify then select model
   */
  async route(messages: Message[], agentId?: string): Promise<RoutingResult> {
    const classification = await this.classifier.classify(
      messages, 
      this.options.classificationOptions
    );

    const model = await this.selectModel(classification, agentId);
    const rule = this.getMatchedRule(classification, agentId);
    const fallbacks = this.getFallbackChain(model);

    return {
      model,
      classification,
      rule,
      fallbacks,
      agentId,
    };
  }

  /**
   * Select the optimal model for a given classification
   */
  async selectModel(classification: RequestClassification, agentId?: string): Promise<string> {
    // Check for agent-specific overrides first
    if (agentId && this.options.agentOverrides?.[agentId]) {
      return this.options.agentOverrides[agentId];
    }

    // Use rule engine to find matching rule
    const matchingRule = this.ruleEngine.findMatchingRule(classification);
    
    if (!matchingRule) {
      // Fallback to a sensible default if no rules match
      return 'anthropic/claude-sonnet-4-20250514';
    }

    return matchingRule.model;
  }

  /**
   * Get the name of the rule that would match the classification
   */
  private getMatchedRule(classification: RequestClassification, agentId?: string): string {
    // Check for agent override
    if (agentId && this.options.agentOverrides?.[agentId]) {
      return `agent-override:${agentId}`;
    }

    // Find matching rule
    const matchingRule = this.ruleEngine.findMatchingRule(classification);
    return matchingRule?.name || 'fallback-default';
  }

  /**
   * Get fallback chain for a model
   */
  getFallbackChain(model: string): string[] {
    return this.options.fallbackChains?.[model] || [];
  }

  /**
   * Update router rules
   */
  addRule(rule: RoutingRule): void {
    this.ruleEngine.addRule(rule);
  }

  /**
   * Remove a routing rule
   */
  removeRule(ruleName: string): boolean {
    return this.ruleEngine.removeRule(ruleName);
  }

  /**
   * Update an existing rule
   */
  updateRule(ruleName: string, updates: Partial<RoutingRule>): boolean {
    return this.ruleEngine.updateRule(ruleName, updates);
  }

  /**
   * Get all current rules
   */
  getRules(): RoutingRule[] {
    return this.ruleEngine.getRules();
  }

  /**
   * Update agent overrides
   */
  setAgentOverride(agentId: string, model: string): void {
    if (!this.options.agentOverrides) {
      this.options.agentOverrides = {};
    }
    this.options.agentOverrides[agentId] = model;
  }

  /**
   * Remove agent override
   */
  removeAgentOverride(agentId: string): boolean {
    if (!this.options.agentOverrides || !this.options.agentOverrides[agentId]) {
      return false;
    }
    delete this.options.agentOverrides[agentId];
    return true;
  }

  /**
   * Update fallback chains
   */
  setFallbackChain(model: string, fallbacks: string[]): void {
    if (!this.options.fallbackChains) {
      this.options.fallbackChains = {};
    }
    this.options.fallbackChains[model] = fallbacks;
  }

  /**
   * Remove fallback chain
   */
  removeFallbackChain(model: string): boolean {
    if (!this.options.fallbackChains || !this.options.fallbackChains[model]) {
      return false;
    }
    delete this.options.fallbackChains[model];
    return true;
  }

  /**
   * Get router statistics
   */
  getStats(): {
    totalRules: number;
    agentOverrides: number;
    fallbackChains: number;
  } {
    return {
      totalRules: this.ruleEngine.getRules().length,
      agentOverrides: Object.keys(this.options.agentOverrides || {}).length,
      fallbackChains: Object.keys(this.options.fallbackChains || {}).length,
    };
  }

  /**
   * Test what model would be selected for given messages
   * Useful for debugging and testing
   */
  async testRoute(messages: Message[], agentId?: string): Promise<{
    model: string;
    classification: RequestClassification;
    matchedRule: string;
    reasoning: string;
  }> {
    const classification = await this.classifier.classify(
      messages,
      this.options.classificationOptions
    );

    const model = await this.selectModel(classification, agentId);
    const matchedRule = this.getMatchedRule(classification, agentId);

    let reasoning = '';
    if (agentId && this.options.agentOverrides?.[agentId]) {
      reasoning = `Agent override: ${agentId} → ${model}`;
    } else {
      const rule = this.ruleEngine.findMatchingRule(classification);
      if (rule) {
        reasoning = `Rule match: ${rule.name} (priority ${rule.priority})`;
      } else {
        reasoning = 'No rules matched, using default fallback';
      }
    }

    return {
      model,
      classification,
      matchedRule,
      reasoning,
    };
  }
}

/**
 * Create a router with default rules from the documentation
 */
export function createDefaultRouter(options: RouterOptions = {}): ModelRouter {
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
      name: 'high-complexity',
      match: { complexity: 'high' },
      model: 'anthropic/claude-opus-4-5',
      priority: 40,
    },
    {
      name: 'simple-fast',
      match: { complexity: 'low', estimatedTokens: '<500' },
      model: 'anthropic/claude-3-5-haiku-20241022',
      priority: 30,
    },
    {
      name: 'creative-writing',
      match: { type: 'creative' },
      model: 'anthropic/claude-sonnet-4-20250514',
      priority: 25,
    },
    {
      name: 'analysis-tasks',
      match: { type: 'analysis' },
      model: 'anthropic/claude-opus-4-5',
      priority: 35,
    },
    {
      name: 'default',
      match: { default: true },
      model: 'anthropic/claude-sonnet-4-20250514',
      priority: 0,
    },
  ];

  const defaultFallbackChains = {
    'ollama/llama3.1:70b': ['ollama/llama3.2:3b', 'anthropic/claude-sonnet-4-20250514'],
    'anthropic/claude-opus-4-5': ['anthropic/claude-sonnet-4-20250514', 'anthropic/claude-3-5-haiku-20241022'],
    'anthropic/claude-sonnet-4-20250514': ['anthropic/claude-3-5-haiku-20241022'],
  };

  const mergedOptions = {
    ...options,
    fallbackChains: {
      ...defaultFallbackChains,
      ...options.fallbackChains,
    },
  };

  const ruleEngine = new RuleEngine(defaultRules);
  return new ModelRouter(ruleEngine, mergedOptions);
}