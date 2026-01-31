/**
 * Account Registry
 * Manages multiple LLM accounts and tracks usage/budgets
 */

import type {
  Account,
  AccountConfig,
  AccountsConfig,
  BudgetStatus,
} from './types.js';

/**
 * Registry for managing LLM accounts
 */
export class AccountRegistry {
  private accounts: Map<string, Account> = new Map();

  /**
   * Create an AccountRegistry from a config object
   */
  static fromConfig(config: AccountsConfig): AccountRegistry {
    const registry = new AccountRegistry();
    
    for (const [id, accountConfig] of Object.entries(config)) {
      registry.register({
        id,
        ...accountConfig,
      } as AccountConfig);
    }
    
    return registry;
  }

  /**
   * Register a new account
   */
  register(config: AccountConfig): Account {
    const account: Account = {
      ...config,
      usageCurrentMonthUsd: 0,
      enabled: true,
    };
    
    this.accounts.set(config.id, account);
    return account;
  }

  /**
   * Get an account by ID
   */
  get(id: string): Account | undefined {
    return this.accounts.get(id);
  }

  /**
   * List all accounts
   */
  list(): Account[] {
    return Array.from(this.accounts.values());
  }

  /**
   * List accounts by provider
   */
  listByProvider(provider: string): Account[] {
    return this.list().filter(account => account.provider === provider);
  }

  /**
   * Update an existing account
   */
  update(id: string, updates: Partial<AccountConfig>): boolean {
    const account = this.accounts.get(id);
    if (!account) {
      return false;
    }
    
    // Merge updates
    Object.assign(account, updates);
    return true;
  }

  /**
   * Remove an account
   */
  remove(id: string): boolean {
    return this.accounts.delete(id);
  }

  /**
   * Record usage for an account
   * @param id Account ID
   * @param amountUsd Amount in USD to add to current month usage
   */
  recordUsage(id: string, amountUsd: number): void {
    const account = this.accounts.get(id);
    if (!account) {
      throw new Error(`Account not found: ${id}`);
    }
    
    account.usageCurrentMonthUsd += amountUsd;
    account.lastUsedAt = new Date();
  }

  /**
   * Get budget status for an account
   */
  getBudgetStatus(id: string): BudgetStatus | undefined {
    const account = this.accounts.get(id);
    if (!account) {
      return undefined;
    }

    const used = account.usageCurrentMonthUsd;
    const budget = account.budgetMonthlyUsd;

    if (budget === undefined) {
      // No budget set - unlimited
      return {
        accountId: id,
        used,
        budget: undefined,
        remaining: undefined,
        percentUsed: undefined,
        isOverBudget: false,
        isNearBudget: false,
      };
    }

    const remaining = budget - used;
    const percentUsed = (used / budget) * 100;

    return {
      accountId: id,
      used,
      budget,
      remaining,
      percentUsed,
      isOverBudget: used > budget,
      isNearBudget: percentUsed >= 80,
    };
  }

  /**
   * Reset monthly usage for an account
   */
  resetMonthlyUsage(id: string): void {
    const account = this.accounts.get(id);
    if (!account) {
      throw new Error(`Account not found: ${id}`);
    }
    
    account.usageCurrentMonthUsd = 0;
  }

  /**
   * Reset monthly usage for all accounts
   */
  resetAllMonthlyUsage(): void {
    this.accounts.forEach(account => {
      account.usageCurrentMonthUsd = 0;
    });
  }

  /**
   * Check if an account is available (enabled and within budget)
   */
  isAvailable(id: string, respectBudget: boolean = true): boolean {
    const account = this.accounts.get(id);
    if (!account || !account.enabled) {
      return false;
    }

    if (!respectBudget) {
      return true;
    }

    const status = this.getBudgetStatus(id);
    return status ? !status.isOverBudget : true;
  }

  /**
   * Enable an account
   */
  enable(id: string): boolean {
    const account = this.accounts.get(id);
    if (!account) {
      return false;
    }
    account.enabled = true;
    return true;
  }

  /**
   * Disable an account
   */
  disable(id: string): boolean {
    const account = this.accounts.get(id);
    if (!account) {
      return false;
    }
    account.enabled = false;
    return true;
  }
}
