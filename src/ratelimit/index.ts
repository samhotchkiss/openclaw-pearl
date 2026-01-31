/**
 * Rate Limiting Module
 * 
 * This module provides comprehensive rate limiting functionality including:
 * - Rate limit detection and tracking
 * - Exponential backoff with jitter
 * - Account failover when rate limited
 * - Intelligent retry execution
 * - Cooldown management
 */

export * from './types.js';
export { RateLimitManager } from './manager.js';
export { AccountFailover } from './failover.js';
export { RetryExecutor } from './retry-executor.js';
export { RateLimitService } from './service.js';
export { RateLimitedBackend } from './backend-wrapper.js';

// Re-export key types for convenience
export type {
  RateLimitConfig,
  RateLimitState,
  RateLimitDetection,
  RetryStrategy,
  RetryAttempt,
  FailoverResult,
  IRateLimitManager,
  IAccountFailover,
  IRetryExecutor,
  IRateLimitService,
} from './types.js';

// Re-export default configuration
export { DEFAULT_RATE_LIMIT_CONFIG } from './types.js';