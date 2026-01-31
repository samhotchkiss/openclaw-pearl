/**
 * Account Failover Manager
 * Handles automatic failover to alternative accounts when primary accounts are rate limited
 */

import type { Provider, Account } from '../accounts/types.js';
import type { AccountRegistry } from '../accounts/registry.js';
import type {
  IAccountFailover,
  IRateLimitManager,
  RateLimitConfig,
  FailoverResult,
} from './types.js';

/**
 * Manages account failover when primary accounts become unavailable
 */
export class AccountFailover implements IAccountFailover {
  constructor(
    private registry: AccountRegistry,
    private rateLimitManager: IRateLimitManager,
    private config: RateLimitConfig
  ) {}

  /**
   * Find alternative account when primary is rate limited
   */
  async findAlternativeAccount(
    primaryAccountId: string,
    provider: Provider,
    excludeAccounts: string[] = []
  ): Promise<FailoverResult> {
    // Check if failover is enabled
    if (!this.config.failoverEnabled) {
      return {
        success: false,
        reason: 'Account failover is disabled in configuration',
        consideredAccounts: [],
        skippedAccounts: [],
      };
    }

    try {
      // Get all accounts for the provider
      const allAccounts = await this.registry.getAllByProvider(provider);
      
      const consideredAccounts: string[] = [];
      const skippedAccounts: Array<{ accountId: string; reason: string }> = [];

      // Evaluate each account
      for (const account of allAccounts) {
        const accountId = account.id;

        // Skip the primary account
        if (accountId === primaryAccountId) {
          continue;
        }

        // Skip if explicitly excluded
        if (excludeAccounts.includes(accountId)) {
          skippedAccounts.push({
            accountId,
            reason: 'Explicitly excluded from consideration',
          });
          continue;
        }

        // Skip disabled accounts
        if (!account.enabled) {
          skippedAccounts.push({
            accountId,
            reason: 'Account is disabled',
          });
          continue;
        }

        // Skip if account is currently unavailable (rate limited or cooling down)
        if (!this.rateLimitManager.isAccountAvailable(accountId)) {
          skippedAccounts.push({
            accountId,
            reason: 'Account is unavailable (rate limited or cooling down)',
          });
          continue;
        }

        // Skip if account is over budget
        const budgetStatus = this.registry.getBudgetStatus(accountId);
        if (budgetStatus?.isOverBudget) {
          skippedAccounts.push({
            accountId,
            reason: `Account is over budget (${budgetStatus.percentUsed?.toFixed(1)}% used)`,
          });
          continue;
        }

        // This account is a valid candidate
        consideredAccounts.push(accountId);
      }

      // If no accounts are available
      if (consideredAccounts.length === 0) {
        return {
          success: false,
          reason: 'No alternative accounts available for failover',
          consideredAccounts: [],
          skippedAccounts,
        };
      }

      // Select the best account (lowest usage)
      const considerAccountObjects = consideredAccounts
        .map(id => allAccounts.find(a => a.id === id))
        .filter((account): account is Account => account !== undefined);
      
      const selectedAccountId = this.selectBestAccount(considerAccountObjects);

      return {
        success: true,
        accountId: selectedAccountId,
        reason: `Found alternative account for failover`,
        consideredAccounts,
        skippedAccounts,
      };

    } catch (error) {
      return {
        success: false,
        reason: `Error during failover: ${error instanceof Error ? error.message : 'Unknown error'}`,
        consideredAccounts: [],
        skippedAccounts: [],
      };
    }
  }

  /**
   * Get all available accounts for a provider
   */
  async getAvailableAccounts(provider: Provider): Promise<string[]> {
    try {
      const allAccounts = await this.registry.getAllByProvider(provider);
      const availableAccounts: string[] = [];

      for (const account of allAccounts) {
        // Skip disabled accounts
        if (!account.enabled) {
          continue;
        }

        // Skip unavailable accounts (rate limited or cooling down)
        if (!this.rateLimitManager.isAccountAvailable(account.id)) {
          continue;
        }

        // Skip over-budget accounts
        const budgetStatus = this.registry.getBudgetStatus(account.id);
        if (budgetStatus?.isOverBudget) {
          continue;
        }

        availableAccounts.push(account.id);
      }

      return availableAccounts;

    } catch (error) {
      console.warn(`Error getting available accounts for ${provider}:`, error);
      return [];
    }
  }

  /**
   * Select the best account from a list of candidates
   * Priority: lowest current usage
   */
  private selectBestAccount(accounts: Account[]): string {
    if (accounts.length === 0) {
      throw new Error('No accounts provided for selection');
    }

    if (accounts.length === 1) {
      return accounts[0].id;
    }

    // Sort by current usage (lowest first)
    const sortedAccounts = [...accounts].sort((a, b) => {
      const usageA = a.usageCurrentMonthUsd || 0;
      const usageB = b.usageCurrentMonthUsd || 0;
      
      if (usageA !== usageB) {
        return usageA - usageB;
      }

      // If usage is the same, sort by account ID for deterministic behavior
      return a.id.localeCompare(b.id);
    });

    return sortedAccounts[0].id;
  }
}