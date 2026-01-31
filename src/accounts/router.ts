/**
 * Account Router
 * Routes requests to the optimal account based on rules
 */

import type { AccountRegistry } from './registry.js';
import type {
  Account,
  RoutingRule,
  RoutingContext,
  RoutingOptions,
  RoutingResult,
  MatchConditions,
} from './types.js';

/**
 * Error thrown when no suitable account is available
 */
export class NoAccountAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoAccountAvailableError';
  }
}

/**
 * Router for selecting the optimal account for a request
 */
export class AccountRouter {
  private registry: AccountRegistry;
  private rules: RoutingRule[];

  constructor(registry: AccountRegistry, rules: RoutingRule[]) {
    this.registry = registry;
    // Sort rules by priority (highest first)
    this.rules = [...rules].sort((a, b) => b.priority - a.priority);
  }

  /**
   * Route a request to the optimal account
   */
  route(
    context: RoutingContext,
    options: RoutingOptions = {}
  ): RoutingResult {
    const { respectBudget = false, strict = false } = options;

    // Find matching rule
    const matchedRule = this.findMatchingRule(context);
    
    if (!matchedRule) {
      throw new NoAccountAvailableError('No routing rules matched the request context');
    }

    // Get primary account
    let account = this.registry.get(matchedRule.account);
    if (!account) {
      throw new NoAccountAvailableError(`Account not found: ${matchedRule.account}`);
    }

    // Get fallback account if defined
    const fallback = matchedRule.fallback 
      ? this.registry.get(matchedRule.fallback) 
      : undefined;

    // Check budget status
    const budgetStatus = this.registry.getBudgetStatus(matchedRule.account);
    let warning: string | undefined;
    let reason = `Matched rule: ${matchedRule.name}`;

    // Handle budget constraints
    if (respectBudget && budgetStatus?.isOverBudget) {
      // Try fallback
      if (fallback) {
        const fallbackStatus = this.registry.getBudgetStatus(fallback.id);
        if (!fallbackStatus?.isOverBudget) {
          account = fallback;
          reason = `${matchedRule.account} is over budget, using fallback ${fallback.id}`;
        } else if (strict) {
          throw new NoAccountAvailableError(
            `All accounts are over budget: ${matchedRule.account} and fallback ${fallback.id}`
          );
        } else {
          // Use fallback even if over budget, with warning
          account = fallback;
          reason = `${matchedRule.account} is over budget, fallback ${fallback.id} is also over budget`;
          warning = `All accounts are over budget`;
        }
      } else if (strict) {
        throw new NoAccountAvailableError(
          `Account ${matchedRule.account} is over budget and no fallback available`
        );
      } else {
        reason = `Account ${matchedRule.account} is over budget (no fallback)`;
        warning = `Account ${matchedRule.account} is over budget`;
      }
    } else if (budgetStatus?.isOverBudget) {
      // Over budget but not respecting budget limits
      warning = `Account ${matchedRule.account} is over budget (${budgetStatus.percentUsed?.toFixed(1)}% used)`;
    } else if (budgetStatus?.isNearBudget) {
      warning = `Account ${matchedRule.account} is approaching budget limit (${budgetStatus.percentUsed?.toFixed(1)}% used)`;
    }

    return {
      account,
      rule: matchedRule.name,
      fallback,
      reason,
      warning,
    };
  }

  /**
   * Find the first matching rule for the given context
   */
  private findMatchingRule(context: RoutingContext): RoutingRule | null {
    // First, try to find a specific rule match (not default)
    for (const rule of this.rules) {
      if (rule.match.default) {
        continue; // Skip default rules in first pass
      }
      if (this.matchesRule(context, rule.match)) {
        return rule;
      }
    }

    // If no specific rule matched, find default rule
    for (const rule of this.rules) {
      if (rule.match.default) {
        return rule;
      }
    }

    return null;
  }

  /**
   * Check if context matches rule conditions
   */
  private matchesRule(context: RoutingContext, match: MatchConditions): boolean {
    // Skip default rules - they're handled specially
    if (match.default) {
      return false;
    }

    // Check each condition - ALL must match
    
    // Sensitive match
    if (match.sensitive !== undefined) {
      if (match.sensitive !== context.sensitive) {
        return false;
      }
    }

    // Agent ID pattern match
    if (match.agentId !== undefined) {
      if (!this.matchesPattern(context.agentId || '', match.agentId)) {
        return false;
      }
    }

    // Type match
    if (match.type !== undefined) {
      if (match.type !== context.type) {
        return false;
      }
    }

    // Complexity match
    if (match.complexity !== undefined) {
      if (match.complexity !== context.complexity) {
        return false;
      }
    }

    // At least one non-default condition must be specified and matched
    const hasConditions = 
      match.sensitive !== undefined ||
      match.agentId !== undefined ||
      match.type !== undefined ||
      match.complexity !== undefined;

    return hasConditions;
  }

  /**
   * Match a value against a pattern (supports * wildcards)
   */
  private matchesPattern(value: string, pattern: string): boolean {
    // Convert pattern to regex
    // Escape special regex chars, then replace * with .*
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(value);
  }

  /**
   * Add a new routing rule
   */
  addRule(rule: RoutingRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Remove a routing rule by name
   */
  removeRule(name: string): boolean {
    const index = this.rules.findIndex(r => r.name === name);
    if (index === -1) {
      return false;
    }
    this.rules.splice(index, 1);
    return true;
  }

  /**
   * Get all routing rules
   */
  getRules(): RoutingRule[] {
    return [...this.rules];
  }

  /**
   * Update an existing rule
   */
  updateRule(name: string, updates: Partial<RoutingRule>): boolean {
    const rule = this.rules.find(r => r.name === name);
    if (!rule) {
      return false;
    }
    Object.assign(rule, updates);
    this.rules.sort((a, b) => b.priority - a.priority);
    return true;
  }
}
