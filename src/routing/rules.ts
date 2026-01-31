/**
 * Rule Engine for Model Routing
 * Handles rule matching logic with priorities and conditions
 */

import type { RequestClassification } from './types.js';

export interface MatchConditions {
  default?: boolean;
  complexity?: 'low' | 'medium' | 'high';
  type?: 'general' | 'code' | 'creative' | 'analysis' | 'chat';
  sensitive?: boolean;
  estimatedTokens?: string; // e.g., "<500", ">1000", "<=1000", ">=500"
  requiresTools?: boolean;
}

export interface RoutingRule {
  name: string;
  match: MatchConditions;
  model: string;
  priority: number;
}

export class RuleEngine {
  private rules: RoutingRule[];

  constructor(rules: RoutingRule[]) {
    // Sort rules by priority (highest first)
    this.rules = [...rules].sort((a, b) => b.priority - a.priority);
  }

  /**
   * Find the first matching rule for the given classification
   * Returns the rule with the highest priority that matches
   */
  findMatchingRule(classification: RequestClassification): RoutingRule | null {
    for (const rule of this.rules) {
      if (this.matchesRule(classification, rule)) {
        return rule;
      }
    }
    
    // If no specific rules matched, try to find default rule
    const defaultRule = this.rules.find(rule => rule.match.default === true);
    return defaultRule || null;
  }

  /**
   * Check if a classification matches a specific rule
   */
  matchesRule(classification: RequestClassification, rule: RoutingRule): boolean {
    const { match } = rule;

    // Default rule matches everything
    if (match.default === true) {
      return true;
    }

    // Check each condition - all must match for the rule to match
    if (match.complexity !== undefined && match.complexity !== classification.complexity) {
      return false;
    }

    if (match.type !== undefined && match.type !== classification.type) {
      return false;
    }

    if (match.sensitive !== undefined && match.sensitive !== classification.sensitive) {
      return false;
    }

    if (match.requiresTools !== undefined && match.requiresTools !== classification.requiresTools) {
      return false;
    }

    // Handle token comparison operators
    if (match.estimatedTokens !== undefined) {
      if (!this.matchesTokenCondition(classification.estimatedTokens, match.estimatedTokens)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Parse and evaluate token comparison conditions
   * Supports: <value, >value, <=value, >=value
   */
  private matchesTokenCondition(actualTokens: number, condition: string): boolean {
    const trimmed = condition.trim();
    
    // Parse operator and value
    let operator: string;
    let threshold: number;

    if (trimmed.startsWith('<=')) {
      operator = '<=';
      threshold = parseInt(trimmed.substring(2), 10);
    } else if (trimmed.startsWith('>=')) {
      operator = '>=';
      threshold = parseInt(trimmed.substring(2), 10);
    } else if (trimmed.startsWith('<')) {
      operator = '<';
      threshold = parseInt(trimmed.substring(1), 10);
    } else if (trimmed.startsWith('>')) {
      operator = '>';
      threshold = parseInt(trimmed.substring(1), 10);
    } else {
      // Exact match or invalid format
      threshold = parseInt(trimmed, 10);
      return actualTokens === threshold;
    }

    // Apply comparison
    switch (operator) {
      case '<':
        return actualTokens < threshold;
      case '>':
        return actualTokens > threshold;
      case '<=':
        return actualTokens <= threshold;
      case '>=':
        return actualTokens >= threshold;
      default:
        return false;
    }
  }

  /**
   * Get all rules sorted by priority
   */
  getRules(): RoutingRule[] {
    return [...this.rules];
  }

  /**
   * Add a new rule
   */
  addRule(rule: RoutingRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Remove a rule by name
   */
  removeRule(name: string): boolean {
    const initialLength = this.rules.length;
    this.rules = this.rules.filter(rule => rule.name !== name);
    return this.rules.length < initialLength;
  }

  /**
   * Update an existing rule
   */
  updateRule(name: string, updatedRule: Partial<RoutingRule>): boolean {
    const index = this.rules.findIndex(rule => rule.name === name);
    if (index === -1) {
      return false;
    }

    this.rules[index] = { ...this.rules[index], ...updatedRule };
    this.rules.sort((a, b) => b.priority - a.priority);
    return true;
  }
}

/**
 * Create RoutingRule array from config
 */
export function createRulesFromConfig(
  rulesConfig: Array<{
    name: string;
    match: MatchConditions;
    model: string;
    priority: number;
  }>,
  defaultModel: string
): RoutingRule[] {
  const rules: RoutingRule[] = [];

  // Add configured rules
  for (const ruleConfig of rulesConfig) {
    rules.push({
      name: ruleConfig.name,
      match: ruleConfig.match,
      model: ruleConfig.model,
      priority: ruleConfig.priority,
    });
  }

  // Add default rule if not already present
  const hasDefaultRule = rules.some(rule => rule.match.default === true);
  if (!hasDefaultRule) {
    rules.push({
      name: 'default',
      match: { default: true },
      model: defaultModel,
      priority: 0, // Lowest priority
    });
  }

  return rules;
}