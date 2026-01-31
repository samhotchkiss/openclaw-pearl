# Rate Limiting Implementation

This document describes the comprehensive rate limiting system implemented for OpenClaw Pearl. The system provides intelligent handling of API rate limits with automatic retries and account failover.

## Overview

The rate limiting system consists of several components working together:

1. **Rate Limit Detection** - Identifies rate limit errors from different providers
2. **Retry Strategy** - Implements exponential backoff with jitter
3. **Account Failover** - Automatically switches to fallback accounts when primary accounts are rate limited
4. **Rate Limit Manager** - Tracks and manages rate limit state across all accounts
5. **Backend Wrapper** - Integrates rate limiting into existing backend clients

## Configuration

Rate limiting is configured through the `rateLimit` section in your Pearl configuration:

```yaml
rateLimit:
  maxRetries: 3              # Maximum number of retries before giving up
  baseDelayMs: 1000          # Base delay for exponential backoff (1 second)
  maxDelayMs: 30000          # Maximum delay cap (30 seconds)
  failoverEnabled: true      # Enable automatic account failover
  cooldownMs: 60000          # How long to keep accounts in cooldown (1 minute)
  jitterFactor: 0.1          # Jitter factor for randomizing delays (10%)
```

## Components

### RateLimitManager

The core component that tracks rate limit state for all accounts.

**Key features:**
- Detects rate limit errors from Anthropic, OpenAI, Ollama, and other providers
- Tracks rate limit state per account including hit counts and retry-after times
- Implements exponential backoff with configurable jitter
- Manages cooldown periods for accounts

**Usage:**
```typescript
import { RateLimitManager } from './ratelimit';

const config = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  failoverEnabled: true,
  cooldownMs: 60000,
  jitterFactor: 0.1,
};

const manager = new RateLimitManager(config);

// Check if error is a rate limit
const detection = manager.detectRateLimit(error, 'anthropic');

// Mark account as rate limited
if (detection.isRateLimit) {
  manager.markRateLimited('account-1', 'anthropic', detection.retryAfterSeconds);
}

// Check if account is available
const isAvailable = manager.isAccountAvailable('account-1');
```

### AccountFailover

Handles automatic failover to alternative accounts when the primary account is rate limited.

**Key features:**
- Finds alternative accounts for the same provider
- Respects account budget limits and availability
- Prioritizes accounts by usage (selects accounts with lowest usage first)
- Integrates with AccountRegistry for account management

**Usage:**
```typescript
import { AccountFailover } from './ratelimit';

const failover = new AccountFailover(registry, rateLimitManager, config);

// Find alternative account
const result = await failover.findAlternativeAccount('primary-account', 'anthropic');

if (result.success) {
  console.log(`Failing over to: ${result.accountId}`);
} else {
  console.log(`No alternatives available: ${result.reason}`);
}
```

### RetryExecutor

Executes functions with intelligent retry logic and account failover.

**Key features:**
- Wraps any async function with retry logic
- Automatically detects retryable vs non-retryable errors
- Implements exponential backoff with jitter
- Integrates with failover system for seamless account switching
- Respects provider retry-after hints

**Usage:**
```typescript
import { RetryExecutor } from './ratelimit';

const executor = new RetryExecutor(rateLimitManager, accountFailover, config);

// Execute with retry logic
const result = await executor.executeWithRetry(
  () => backend.chat(request),
  'account-1',
  'anthropic',
  { operation: 'chat', metadata: { model: 'claude-3-sonnet' } }
);
```

### RateLimitService

Unified service that combines all rate limiting functionality.

**Key features:**
- Single interface for all rate limiting operations
- Automatic cleanup of expired state
- Configuration management
- Comprehensive monitoring and statistics

**Usage:**
```typescript
import { RateLimitService } from './ratelimit';

const service = new RateLimitService(accountRegistry, config);

// Use for retry execution
const result = await service.executeWithRetry(
  () => backend.chat(request),
  'account-1',
  'anthropic'
);

// Check account status
const status = service.getAccountsStatus();

// Get statistics
const stats = service.getStatistics();
```

### RateLimitedBackend

Wrapper that integrates rate limiting into existing backend clients.

**Key features:**
- Transparent integration with BackendClient interface
- Automatic retry and failover for all operations
- Maintains streaming support
- Preserves original functionality while adding rate limiting

**Usage:**
```typescript
import { RateLimitedBackend } from './ratelimit';

const rateLimitedBackend = new RateLimitedBackend(
  originalBackend,
  rateLimitService,
  'account-1',
  'anthropic'
);

// Use exactly like original backend
for await (const chunk of rateLimitedBackend.chat(request)) {
  console.log(chunk);
}
```

## Error Handling

The system recognizes several types of rate limit errors:

### Provider-Specific Detection

**Anthropic:**
- 429 status codes
- RateLimitError exceptions with retry-after headers

**OpenAI:**
- 429 status codes with "rate_limit_exceeded" error codes
- Quota exceeded errors

**Ollama:**
- 429 status codes
- Generic "too many requests" messages

**Generic Detection:**
- HTTP 429 status codes
- Error messages containing "rate limit", "too many requests", "quota exceeded"

### Retry Logic

The system implements intelligent retry logic:

1. **Immediate retry** for transient network errors
2. **Exponential backoff** for rate limit errors
3. **Respect retry-after headers** when provided by the API
4. **Account failover** when retries are exhausted
5. **Give up** when all accounts are exhausted and max retries reached

## Account Management Integration

The rate limiting system integrates seamlessly with Pearl's account management:

### Account States

Accounts can be in one of several states:
- **Available** - Ready to use
- **Rate Limited** - Currently rate limited with optional retry-after time
- **Cooling Down** - Temporarily unavailable after a successful failover
- **Disabled** - Manually disabled in configuration
- **Over Budget** - Exceeded monthly budget limits

### Failover Priority

When selecting failover accounts, the system considers:
1. **Provider match** - Must be same provider (anthropic, openai, etc.)
2. **Availability** - Account must be enabled and not rate limited
3. **Budget status** - Account must not be over budget
4. **Usage priority** - Prefers accounts with lower current usage

## Monitoring and Observability

The system provides comprehensive monitoring capabilities:

### Account Status

```typescript
// Get status of all accounts
const status = service.getAccountsStatus();
// Returns array of { accountId, provider, isAvailable, state }

// Get unavailable accounts
const unavailable = service.getUnavailableAccounts();
// Returns array of account IDs that are currently unavailable
```

### Statistics

```typescript
// Get comprehensive statistics
const stats = service.getStatistics();
// Returns:
// {
//   totalAccounts: number,
//   availableAccounts: number,
//   rateLimitedAccounts: number,
//   coolingDownAccounts: number,
//   totalRateLimitHits: number
// }
```

### Rate Limit State

```typescript
// Get detailed state for specific account
const state = service.getState('account-1');
// Returns RateLimitState or null
```

## Configuration Examples

### Basic Configuration

```yaml
rateLimit:
  maxRetries: 3
  baseDelayMs: 1000
  maxDelayMs: 30000
  failoverEnabled: true
  cooldownMs: 60000
```

### Conservative Configuration (Lower Retry Frequency)

```yaml
rateLimit:
  maxRetries: 2
  baseDelayMs: 2000
  maxDelayMs: 60000
  failoverEnabled: true
  cooldownMs: 120000
  jitterFactor: 0.2
```

### Aggressive Configuration (Faster Retries)

```yaml
rateLimit:
  maxRetries: 5
  baseDelayMs: 500
  maxDelayMs: 15000
  failoverEnabled: true
  cooldownMs: 30000
  jitterFactor: 0.1
```

### Failover Disabled

```yaml
rateLimit:
  maxRetries: 3
  baseDelayMs: 1000
  maxDelayMs: 30000
  failoverEnabled: false
  cooldownMs: 60000
```

## Best Practices

### Account Setup

1. **Multiple accounts per provider** - Set up 2-3 accounts per provider for effective failover
2. **Budget distribution** - Distribute budget across accounts to avoid all accounts hitting limits simultaneously
3. **Monitor usage** - Regularly check account usage and adjust budgets as needed

### Configuration Tuning

1. **Start conservative** - Begin with higher delays and fewer retries, then optimize based on usage patterns
2. **Monitor hit rates** - Track rate limit hits and adjust configuration accordingly
3. **Provider-specific tuning** - Different providers may require different configurations

### Integration

1. **Use RateLimitedBackend** - Wrap all backend clients for consistent behavior
2. **Handle errors gracefully** - Always handle the case where all retries and failovers are exhausted
3. **Monitor actively** - Set up alerts for high rate limit hit rates or account unavailability

## Testing

The implementation includes comprehensive tests:

- **Unit tests** for each component
- **Integration tests** for end-to-end workflows
- **Error simulation** tests for various failure scenarios
- **Configuration tests** for different settings

Run tests with:
```bash
npm test -- ratelimit
```

## Architecture Decisions

### Why Separate Components?

The rate limiting system is broken into separate, focused components to:
- **Single Responsibility** - Each component has a clear, focused purpose
- **Testability** - Components can be tested in isolation
- **Flexibility** - Components can be used independently or together
- **Maintainability** - Changes to one component don't affect others

### Why Wrapper Pattern?

The `RateLimitedBackend` wrapper pattern:
- **Preserves Interface** - Existing code doesn't need to change
- **Transparent Integration** - Rate limiting "just works" without code changes
- **Streaming Support** - Maintains async generator support for streaming responses
- **Backwards Compatibility** - Original backend remains accessible if needed

### Why State Tracking?

Persistent state tracking enables:
- **Cross-Request Learning** - System remembers previous rate limit encounters
- **Intelligent Timing** - Avoids unnecessary retries during known rate limit periods
- **Account Health** - Tracks which accounts are problematic
- **Optimization** - System gets smarter about retry timing over time

## Future Enhancements

Potential future improvements:

1. **Persistent State** - Store rate limit state across application restarts
2. **Provider-Specific Logic** - Customize retry logic per provider
3. **Adaptive Timing** - Learn optimal retry timing from success/failure patterns
4. **Circuit Breaker** - Temporarily disable problematic accounts
5. **Metrics Export** - Export metrics to monitoring systems
6. **Rate Limit Prediction** - Predict when accounts will hit limits based on usage patterns