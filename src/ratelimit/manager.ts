/**
 * Rate Limit Manager
 * Handles detection, tracking, and management of rate limits across accounts
 */

import type { Provider } from '../accounts/types.js';
import type {
  IRateLimitManager,
  RateLimitConfig,
  RateLimitState,
  RateLimitDetection,
} from './types.js';
import { RateLimitError, BackendError } from '../backends/types.js';

/**
 * Manages rate limit state and retry logic for all accounts
 */
export class RateLimitManager implements IRateLimitManager {
  private config: RateLimitConfig;
  private states = new Map<string, RateLimitState>();

  constructor(config: RateLimitConfig) {
    this.config = { ...config };
  }

  /**
   * Detect if an error indicates a rate limit
   */
  detectRateLimit(error: Error, provider: Provider): RateLimitDetection {
    // Handle RateLimitError specifically
    if (error instanceof RateLimitError) {
      return {
        isRateLimit: true,
        retryAfterSeconds: error.retryAfter,
        errorCode: error.code,
        message: error.message,
      };
    }

    // Handle BackendError with rate limit indicators
    if (error instanceof BackendError) {
      if (error.status === 429 || error.code === 'RATE_LIMIT') {
        return {
          isRateLimit: true,
          errorCode: error.code,
          message: error.message,
        };
      }
    }

    // Check for generic 429 status or rate limit keywords in message
    const message = error.message.toLowerCase();
    const isRateLimit = 
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('quota exceeded') ||
      message.includes('requests per');

    return {
      isRateLimit,
      message: error.message,
    };
  }

  /**
   * Mark an account as rate limited
   */
  markRateLimited(accountId: string, provider: Provider, retryAfterSeconds?: number): void {
    const now = new Date();
    const existing = this.states.get(accountId);

    let retryAfter: Date | undefined;
    if (retryAfterSeconds) {
      retryAfter = new Date(now.getTime() + retryAfterSeconds * 1000);
    }

    const state: RateLimitState = {
      accountId,
      provider,
      isRateLimited: true,
      retryAfter,
      hitCount: (existing?.hitCount || 0) + 1,
      lastHit: now,
      isCoolingDown: existing?.isCoolingDown || false,
      cooldownUntil: existing?.cooldownUntil,
    };

    this.states.set(accountId, state);
  }

  /**
   * Check if an account is available (not rate limited or cooling down)
   */
  isAccountAvailable(accountId: string): boolean {
    const state = this.states.get(accountId);
    if (!state) {
      return true; // Unknown accounts are considered available
    }

    const now = new Date();

    // Check rate limit status
    if (state.isRateLimited) {
      // If no retry-after time is specified, use a default cooldown period
      if (!state.retryAfter) {
        // Use the base delay as a minimum rate limit period
        const defaultRetryAfter = new Date(state.lastHit!.getTime() + this.config.baseDelayMs);
        if (now < defaultRetryAfter) {
          return false;
        }
      } else if (now < state.retryAfter) {
        return false;
      }
    }

    // Check cooldown status
    if (state.isCoolingDown && state.cooldownUntil && now < state.cooldownUntil) {
      return false;
    }

    // If rate limit or cooldown has expired, update state
    const isRateLimitExpired = state.isRateLimited && (
      !state.retryAfter ? 
        now >= new Date(state.lastHit!.getTime() + this.config.baseDelayMs) :
        now >= state.retryAfter
    );
    const isCooldownExpired = state.isCoolingDown && state.cooldownUntil && now >= state.cooldownUntil;

    if (isRateLimitExpired || isCooldownExpired) {
      if (isRateLimitExpired) {
        state.isRateLimited = false;
        state.retryAfter = undefined;
      }
      if (isCooldownExpired) {
        state.isCoolingDown = false;
        state.cooldownUntil = undefined;
      }
    }

    return !state.isRateLimited && !state.isCoolingDown;
  }

  /**
   * Get rate limit state for an account
   */
  getState(accountId: string): RateLimitState | null {
    return this.states.get(accountId) || null;
  }

  /**
   * Clear rate limit state for an account
   */
  clearState(accountId: string): void {
    this.states.delete(accountId);
  }

  /**
   * Get all accounts that are currently unavailable
   */
  getUnavailableAccounts(): string[] {
    const unavailable: string[] = [];

    for (const [accountId] of this.states) {
      if (!this.isAccountAvailable(accountId)) {
        unavailable.push(accountId);
      }
    }

    return unavailable;
  }

  /**
   * Calculate delay for retry attempt with exponential backoff and jitter
   */
  calculateDelay(attempt: number, retryAfterSeconds?: number): number {
    // Use retry-after hint if provided
    if (retryAfterSeconds) {
      const retryAfterMs = retryAfterSeconds * 1000;
      return this.addJitter(retryAfterMs);
    }

    // Calculate exponential backoff
    const delay = Math.min(
      this.config.baseDelayMs * Math.pow(2, attempt),
      this.config.maxDelayMs
    );

    return this.addJitter(delay);
  }

  /**
   * Start cooldown period for an account
   */
  startCooldown(accountId: string): void {
    const now = new Date();
    const cooldownUntil = new Date(now.getTime() + this.config.cooldownMs);

    const existing = this.states.get(accountId);
    const state: RateLimitState = existing || {
      accountId,
      provider: 'anthropic', // Default, will be updated when actual provider is known
      isRateLimited: false,
      hitCount: 0,
      isCoolingDown: false,
    };

    state.isCoolingDown = true;
    state.cooldownUntil = cooldownUntil;

    this.states.set(accountId, state);
  }

  /**
   * Clean up expired state entries
   */
  cleanup(): void {
    const now = new Date();

    for (const [accountId, state] of this.states) {
      const isRateLimitExpired = state.isRateLimited && (
        state.retryAfter ? 
          now >= state.retryAfter :
          state.lastHit && now >= new Date(state.lastHit.getTime() + this.config.baseDelayMs)
      );
      const isCooldownExpired = state.cooldownUntil && now >= state.cooldownUntil;

      if (
        (!state.isRateLimited || isRateLimitExpired) &&
        (!state.isCoolingDown || isCooldownExpired)
      ) {
        this.states.delete(accountId);
      }
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): RateLimitConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Initialize the manager (for interface compatibility)
   */
  initialize(config: RateLimitConfig): void {
    this.config = { ...config };
  }

  /**
   * Add jitter to a delay value
   */
  private addJitter(delayMs: number): number {
    const jitterFactor = this.config.jitterFactor || 0.1;
    const jitterRange = delayMs * jitterFactor;
    const jitter = (Math.random() - 0.5) * 2 * jitterRange;
    // Ensure the result doesn't exceed max delay
    const result = Math.max(0, delayMs + jitter);
    return Math.min(result, this.config.maxDelayMs);
  }
}