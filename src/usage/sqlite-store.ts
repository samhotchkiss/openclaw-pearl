/**
 * SQLite store implementation for usage tracking
 */

import Database from 'better-sqlite3';
import type { 
  UsageStore, 
  UsageRecord, 
  UsageQuery, 
  UsageSummary 
} from './types.js';

/**
 * SQLite-based usage store
 */
export class SQLiteUsageStore implements UsageStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initializeSchema();
  }

  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    // Create usage_records table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_records (
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
        metadata_custom TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
    `);

    // Create indices for efficient querying
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_usage_account_timestamp 
      ON usage_records(account_id, timestamp DESC);
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_usage_agent_timestamp 
      ON usage_records(agent_id, timestamp DESC);
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_usage_provider_model 
      ON usage_records(provider, model);
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_usage_timestamp 
      ON usage_records(timestamp DESC);
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_usage_cost 
      ON usage_records(cost DESC);
    `);
  }

  /**
   * Save a usage record
   */
  async save(record: UsageRecord): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO usage_records (
        id, account_id, agent_id, model, provider,
        prompt_tokens, completion_tokens, total_tokens, cost, timestamp,
        metadata_type, metadata_complexity, metadata_sensitive,
        metadata_session_id, metadata_custom
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const timestampMs = record.timestamp.getTime();
    const metadataCustom = record.metadata ? 
      JSON.stringify(Object.fromEntries(
        Object.entries(record.metadata).filter(([key]) => 
          !['type', 'complexity', 'sensitive', 'sessionId'].includes(key)
        )
      )) : null;

    stmt.run(
      record.id,
      record.accountId,
      record.agentId,
      record.model,
      record.provider,
      record.usage.promptTokens,
      record.usage.completionTokens,
      record.usage.totalTokens,
      record.cost,
      timestampMs,
      record.metadata?.type,
      record.metadata?.complexity,
      record.metadata && record.metadata.hasOwnProperty('sensitive') ? (record.metadata.sensitive ? 1 : 0) : null,
      record.metadata?.sessionId,
      metadataCustom
    );
  }

  /**
   * Query usage records
   */
  async query(query: UsageQuery): Promise<UsageRecord[]> {
    let sql = 'SELECT * FROM usage_records WHERE 1=1';
    const params: any[] = [];

    // Build WHERE clause
    if (query.accountId) {
      sql += ' AND account_id = ?';
      params.push(query.accountId);
    }

    if (query.agentId) {
      sql += ' AND agent_id = ?';
      params.push(query.agentId);
    }

    if (query.provider) {
      sql += ' AND provider = ?';
      params.push(query.provider);
    }

    if (query.model) {
      sql += ' AND model = ?';
      params.push(query.model);
    }

    if (query.startDate) {
      sql += ' AND timestamp >= ?';
      params.push(query.startDate.getTime());
    }

    if (query.endDate) {
      sql += ' AND timestamp <= ?';
      params.push(query.endDate.getTime());
    }

    if (query.type) {
      sql += ' AND metadata_type = ?';
      params.push(query.type);
    }

    if (query.complexity) {
      sql += ' AND metadata_complexity = ?';
      params.push(query.complexity);
    }

    if (query.sensitive !== undefined) {
      sql += ' AND metadata_sensitive = ?';
      params.push(query.sensitive ? 1 : 0);
    }

    // Add ORDER BY
    const sortBy = query.sortBy || 'timestamp';
    const sortOrder = query.sortOrder || 'desc';
    
    let orderColumn = 'timestamp';
    if (sortBy === 'cost') orderColumn = 'cost';
    else if (sortBy === 'tokens') orderColumn = 'total_tokens';
    
    sql += ` ORDER BY ${orderColumn} ${sortOrder.toUpperCase()}`;

    // Add LIMIT/OFFSET
    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);

      if (query.offset) {
        sql += ' OFFSET ?';
        params.push(query.offset);
      }
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map(this.mapRowToRecord);
  }

  /**
   * Get aggregated usage summary
   */
  async getUsageSummary(
    query: Omit<UsageQuery, 'limit' | 'offset' | 'sortBy' | 'sortOrder'>
  ): Promise<UsageSummary> {
    let sql = `
      SELECT 
        COUNT(*) as request_count,
        SUM(total_tokens) as total_tokens,
        SUM(prompt_tokens) as prompt_tokens,
        SUM(completion_tokens) as completion_tokens,
        SUM(cost) as total_cost
      FROM usage_records 
      WHERE 1=1
    `;
    const params: any[] = [];

    // Build WHERE clause
    if (query.accountId) {
      sql += ' AND account_id = ?';
      params.push(query.accountId);
    }

    if (query.agentId) {
      sql += ' AND agent_id = ?';
      params.push(query.agentId);
    }

    if (query.provider) {
      sql += ' AND provider = ?';
      params.push(query.provider);
    }

    if (query.model) {
      sql += ' AND model = ?';
      params.push(query.model);
    }

    if (query.startDate) {
      sql += ' AND timestamp >= ?';
      params.push(query.startDate.getTime());
    }

    if (query.endDate) {
      sql += ' AND timestamp <= ?';
      params.push(query.endDate.getTime());
    }

    if (query.type) {
      sql += ' AND metadata_type = ?';
      params.push(query.type);
    }

    if (query.complexity) {
      sql += ' AND metadata_complexity = ?';
      params.push(query.complexity);
    }

    if (query.sensitive !== undefined) {
      sql += ' AND metadata_sensitive = ?';
      params.push(query.sensitive ? 1 : 0);
    }

    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params) as any;

    const requestCount = row.request_count || 0;
    const totalTokens = row.total_tokens || 0;
    const totalCost = row.total_cost || 0;

    return {
      totalTokens,
      promptTokens: row.prompt_tokens || 0,
      completionTokens: row.completion_tokens || 0,
      totalCost,
      requestCount,
      avgCostPerRequest: requestCount > 0 ? totalCost / requestCount : 0,
      avgTokensPerRequest: requestCount > 0 ? totalTokens / requestCount : 0
    };
  }

  /**
   * Delete usage records
   */
  async delete(query: UsageQuery): Promise<number> {
    let sql = 'DELETE FROM usage_records WHERE 1=1';
    const params: any[] = [];

    // Build WHERE clause
    if (query.accountId) {
      sql += ' AND account_id = ?';
      params.push(query.accountId);
    }

    if (query.agentId) {
      sql += ' AND agent_id = ?';
      params.push(query.agentId);
    }

    if (query.startDate) {
      sql += ' AND timestamp >= ?';
      params.push(query.startDate.getTime());
    }

    if (query.endDate) {
      sql += ' AND timestamp <= ?';
      params.push(query.endDate.getTime());
    }

    const stmt = this.db.prepare(sql);
    const result = stmt.run(...params);
    return result.changes;
  }

  /**
   * Get usage trends over time
   */
  async getTrends(query: UsageQuery & {
    granularity: 'hour' | 'day' | 'week' | 'month';
  }): Promise<Array<{
    period: string;
    summary: UsageSummary;
  }>> {
    let timeFormat: string;
    switch (query.granularity) {
      case 'hour':
        timeFormat = '%Y-%m-%d %H:00';
        break;
      case 'day':
        timeFormat = '%Y-%m-%d';
        break;
      case 'week':
        timeFormat = '%Y-W%W';
        break;
      case 'month':
        timeFormat = '%Y-%m';
        break;
      default:
        timeFormat = '%Y-%m-%d';
    }

    let sql = `
      SELECT 
        strftime('${timeFormat}', datetime(timestamp/1000, 'unixepoch')) as period,
        COUNT(*) as request_count,
        SUM(total_tokens) as total_tokens,
        SUM(prompt_tokens) as prompt_tokens,
        SUM(completion_tokens) as completion_tokens,
        SUM(cost) as total_cost
      FROM usage_records 
      WHERE 1=1
    `;
    const params: any[] = [];

    // Build WHERE clause (same as getUsageSummary)
    if (query.accountId) {
      sql += ' AND account_id = ?';
      params.push(query.accountId);
    }

    if (query.agentId) {
      sql += ' AND agent_id = ?';
      params.push(query.agentId);
    }

    if (query.provider) {
      sql += ' AND provider = ?';
      params.push(query.provider);
    }

    if (query.model) {
      sql += ' AND model = ?';
      params.push(query.model);
    }

    if (query.startDate) {
      sql += ' AND timestamp >= ?';
      params.push(query.startDate.getTime());
    }

    if (query.endDate) {
      sql += ' AND timestamp <= ?';
      params.push(query.endDate.getTime());
    }

    sql += ' GROUP BY period ORDER BY period ASC';

    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => {
      const requestCount = row.request_count || 0;
      const totalTokens = row.total_tokens || 0;
      const totalCost = row.total_cost || 0;

      return {
        period: row.period,
        summary: {
          totalTokens,
          promptTokens: row.prompt_tokens || 0,
          completionTokens: row.completion_tokens || 0,
          totalCost,
          requestCount,
          avgCostPerRequest: requestCount > 0 ? totalCost / requestCount : 0,
          avgTokensPerRequest: requestCount > 0 ? totalTokens / requestCount : 0
        }
      };
    });
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Map database row to UsageRecord
   */
  private mapRowToRecord(row: any): UsageRecord {
    const metadata: any = {};
    
    if (row.metadata_type) metadata.type = row.metadata_type;
    if (row.metadata_complexity) metadata.complexity = row.metadata_complexity;
    if (row.metadata_sensitive !== null) metadata.sensitive = row.metadata_sensitive === 1;
    if (row.metadata_session_id) metadata.sessionId = row.metadata_session_id;
    
    if (row.metadata_custom) {
      try {
        const custom = JSON.parse(row.metadata_custom);
        Object.assign(metadata, custom);
      } catch (e) {
        // Ignore invalid JSON
      }
    }

    const result: any = {
      id: row.id,
      accountId: row.account_id,
      model: row.model,
      provider: row.provider,
      usage: {
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        totalTokens: row.total_tokens
      },
      cost: row.cost,
      timestamp: new Date(row.timestamp)
    };

    // Only include agentId if it's not null
    if (row.agent_id !== null) {
      result.agentId = row.agent_id;
    }

    // Only include metadata if it has properties
    if (Object.keys(metadata).length > 0) {
      result.metadata = metadata;
    }

    return result as UsageRecord;
  }
}