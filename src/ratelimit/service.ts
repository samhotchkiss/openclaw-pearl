/**
 * Rate Limit Service
 * Unified service combining rate limit management, account failover, and retry execution
 */

import type { Provider } from '../accounts/types.js';
import type { AccountRegistry } from '../accounts/registry.js';
import type {
  IRateLimitService,
  RateLimitConfig,
  RateLimitState,
  RateLimitDetection,
  FailoverResult,
} from './types.js';
import { RateLimitManager } from './manager.js';
import { AccountFailover } from './failover.js';
import { RetryExecutor } from './retry-executor.js';
import { DEFAULT_RATE_LIMIT_CONFIG } from './types.js';

/**
 * Comprehensive rate limiting service
 */
export class RateLimitService implements IRateLimitService {
  private manager: RateLimitManager;
  private failover: AccountFailover;
  private executor: RetryExecutor;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    private registry: AccountRegistry,
    config?: Partial<RateLimitConfig>
  ) {
    const fullConfig = { ...DEFAULT_RATE_LIMIT_CONFIG, ...config };
    
    this.manager = new RateLimitManager(fullConfig);
    this.failover = new AccountFailover(registry, this.manager, fullConfig);
    this.executor = new RetryExecutor(this.manager, this.failover, fullConfig);

    // Set up periodic cleanup
    this.startCleanupTimer();
  }

  // IRateLimitManager methods
  detectRateLimit(error: Error, provider: Provider): RateLimitDetection {
    return this.manager.detectRateLimit(error, provider);
  }

  markRateLimited(accountId: string, provider: Provider, retryAfterSeconds?: number): void {
    this.manager.markRateLimited(accountId, provider, retryAfterSeconds);
  }

  isAccountAvailable(accountId: string): boolean {
    return this.manager.isAccountAvailable(accountId);
  }

  getState(accountId: string): RateLimitState | null {
    return this.manager.getState(accountId);
  }

  clearState(accountId: string): void {
    this.manager.clearState(accountId);
  }

  getUnavailableAccounts(): string[] {
    return this.manager.getUnavailableAccounts();
  }

  calculateDelay(attempt: number, retryAfterSeconds?: number): number {
    return this.manager.calculateDelay(attempt, retryAfterSeconds);
  }

  startCooldown(accountId: string): void {
    this.manager.startCooldown(accountId);
  }

  // IAccountFailover methods
  async findAlternativeAccount(
    primaryAccountId: string,
    provider: Provider,
    excludeAccounts?: string[]
  ): Promise<FailoverResult> {
    return this.failover.findAlternativeAccount(primaryAccountId, provider, excludeAccounts);
  }

  async getAvailableAccounts(provider: Provider): Promise<string[]> {
    return this.failover.getAvailableAccounts(provider);
  }

  // IRetryExecutor methods
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    accountId: string,
    provider: Provider,
    context?: { operation: string; metadata?: Record<string, unknown> }
  ): Promise<T> {
    return this.executor.executeWithRetry(fn, accountId, provider, context);
  }

  // IRateLimitService methods
  initialize(config: RateLimitConfig): void {
    this.manager.initialize(config);
    this.updateComponentsConfig(config);
  }

  updateConfig(config: Partial<RateLimitConfig>): void {
    const currentConfig = this.manager.getConfig();
    const newConfig = { ...currentConfig, ...config };
    
    this.manager.updateConfig(config);
    this.updateComponentsConfig(newConfig);
  }

  getConfig(): RateLimitConfig {
    return this.manager.getConfig();
  }

  cleanup(): void {
    this.manager.cleanup();
  }

  /**
   * Get comprehensive status of all accounts
   */
  getAccountsStatus(): Array<{
    accountId: string;
    provider?: Provider;
    isAvailable: boolean;
    state: RateLimitState | null;
  }> {
    const unavailableAccounts = this.getUnavailableAccounts();
    const allAccountIds = new Set([
      ...this.registry.getAll().map(a => a.id),
      ...unavailableAccounts,
    ]);

    return Array.from(allAccountIds).map(accountId => ({
      accountId,
      provider: this.getState(accountId)?.provider,
      isAvailable: this.isAccountAvailable(accountId),
      state: this.getState(accountId),
    }));
  }

  /**
   * Force reset rate limit state for an account
   */
  forceReset(accountId: string): void {
    this.clearState(accountId);
  }

  /**
   * Get statistics about rate limiting
   */
  getStatistics(): {
    totalAccounts: number;
    availableAccounts: number;
    rateLimitedAccounts: number;
    coolingDownAccounts: number;
    totalRateLimitHits: number;
  } {
    const allStates = this.registry.getAll().map(a => this.getState(a.id)).filter(Boolean) as RateLimitState[];
    
    const rateLimitedCount = allStates.filter(s => s.isRateLimited).length;
    const coolingDownCount = allStates.filter(s => s.isCoolingDown).length;
    const totalHits = allStates.reduce((sum, s) => sum + s.hitCount, 0);

    return {
      totalAccounts: this.registry.getAll().length,
      availableAccounts: this.registry.getAll().length - this.getUnavailableAccounts().length,
      rateLimitedAccounts: rateLimitedCount,
      coolingDownAccounts: coolingDownCount,
      totalRateLimitHits: totalHits,
    };
  }

  /**
   * Shutdown the service and cleanup resources
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.cleanup();
  }

  /**
   * Update configuration for all components
   */
  private updateComponentsConfig(config: RateLimitConfig): void {
    // Recreate components with new config
    this.failover = new AccountFailover(this.registry, this.manager, config);
    this.executor = new RetryExecutor(this.manager, this.failover, config);
  }

  /**
   * Start periodic cleanup timer
   */
  private startCleanupTimer(): void {
    // Clean up expired states every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);

    // Don't keep the process alive just for cleanup
    this.cleanupInterval.unref();
  }
}