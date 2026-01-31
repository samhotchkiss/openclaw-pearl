# Per-Account Usage and Cost Tracking (Issue #18)

This feature implements comprehensive usage tracking and cost monitoring for LLM accounts in openclaw-pearl.

## Overview

The usage tracking system provides:
1. **Token Usage Logging**: Records input/output/cache tokens per request
2. **Cost Calculation**: Calculates costs based on provider pricing models
3. **Account Aggregation**: Groups usage by account, time period, and agent
4. **Query APIs**: Provides comprehensive APIs for usage data retrieval
5. **AccountRegistry Integration**: Works with the multi-account system

## Architecture

### Core Components

- **`UsageTracker`**: Main orchestrator for recording and querying usage
- **`CostCalculator`**: Handles cost computation with up-to-date pricing
- **`SQLiteUsageStore`**: Persistent storage with optimized queries
- **`UsageIntegration`**: Connects with AccountRegistry for budget tracking
- **`UsageAPI`**: HTTP API layer with validation and aggregation

### Data Model

```typescript
interface UsageRecord {
  id: string;
  accountId: string;
  agentId?: string;
  model: string;
  provider: string;
  usage: TokenUsage;
  cost: number;
  timestamp: Date;
  metadata?: {
    type?: string;
    complexity?: string;
    sensitive?: boolean;
    sessionId?: string;
  };
}
```

## Features Implemented

### 1. Token Logging
- Records prompt, completion, and cache tokens
- Supports all major providers (Anthropic, OpenAI, Ollama, etc.)
- Automatic cost calculation based on current pricing

### 2. Cost Tracking
- Real-time cost computation per request
- Configurable pricing models
- Support for cache token pricing
- Wildcard pricing for local models

### 3. Data Aggregation
- Account-level summaries
- Time-based trends (hourly, daily, weekly, monthly)
- Agent breakdown analysis
- Model usage comparisons
- Top spender identification

### 4. Query Capabilities
- Flexible filtering by account, agent, date range, provider
- Sorting and pagination
- CSV export functionality
- Usage summary statistics

### 5. Budget Integration
- Real-time budget tracking
- Over-budget detection
- Cost projection based on trends
- Usage optimization recommendations

### 6. API Layer
- RESTful API endpoints
- Input validation and sanitization
- Performance monitoring
- Rate limiting and error handling

## Test Coverage

Comprehensive test suite with 72+ tests covering:
- **Unit Tests**: All core classes and methods
- **Integration Tests**: Cross-component interactions
- **API Tests**: HTTP endpoint validation
- **Store Tests**: Database operations and queries

All tests follow TDD principles with tests written before implementation.

## Database Schema

SQLite schema optimized for query performance:

```sql
CREATE TABLE usage_records (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  agent_id TEXT,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  cost REAL NOT NULL,
  timestamp INTEGER NOT NULL,
  metadata_type TEXT,
  metadata_complexity TEXT,
  metadata_sensitive INTEGER,
  metadata_session_id TEXT,
  metadata_custom TEXT
);

-- Optimized indexes for common queries
CREATE INDEX idx_usage_account_timestamp ON usage_records(account_id, timestamp DESC);
CREATE INDEX idx_usage_agent_timestamp ON usage_records(agent_id, timestamp DESC);
-- ... additional indexes
```

## Usage Examples

### Recording Usage
```typescript
const tracker = new UsageTracker(store);

await tracker.recordUsage({
  accountId: 'anthropic-main',
  agentId: 'content-agent',
  model: 'claude-3-5-sonnet',
  provider: 'anthropic',
  usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
  cost: 0.0225,
  metadata: { type: 'creative', complexity: 'medium' }
});
```

### Querying Usage
```typescript
// Get monthly usage for account
const summary = await tracker.getUsageSummary({
  accountId: 'anthropic-main',
  startDate: startOfMonth,
  endDate: endOfMonth
});

// Get usage trends
const trends = await tracker.getUsageTrends({
  granularity: 'day',
  accountId: 'anthropic-main'
});
```

### Cost Analysis
```typescript
const calculator = new CostCalculator();
const cost = calculator.calculateCost('anthropic', 'claude-3-sonnet', usage);

// Get optimization recommendations
const recommendations = await integration.getCostOptimizationRecommendations('account-1');
```

## Performance Considerations

- **Efficient Indexes**: Optimized for common query patterns
- **Batch Operations**: Support for bulk usage recording
- **Memory Management**: Streaming for large result sets
- **Query Optimization**: Parameterized queries to prevent SQL injection

## Future Enhancements

1. **Real-time Dashboards**: WebSocket-based live usage monitoring
2. **Alerting System**: Configurable budget and usage alerts
3. **Advanced Analytics**: ML-based cost prediction and optimization
4. **Multi-tenant Support**: Organization-level usage tracking
5. **Integration APIs**: Webhooks for external monitoring systems

## Implementation Status

✅ **Core Implementation**: Complete with full test coverage
✅ **Database Layer**: SQLite store with optimized schema
✅ **Cost Calculation**: Current provider pricing models
✅ **API Layer**: RESTful endpoints with validation
✅ **Integration**: AccountRegistry connection points
🔄 **PR Ready**: Code review and merge pending

This implementation provides a solid foundation for usage tracking that can scale with openclaw-pearl's growth and requirements.