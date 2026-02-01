/**
 * Pearl Memory Store
 * SQLite-based storage for agent memories with embeddings
 */

import Database from 'better-sqlite3';
import { uuidv7 } from 'uuidv7';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

// Types
export interface Memory {
  id: string;
  agent_id: string;
  type: MemoryType;
  content: string;
  tags?: string[];
  embedding?: number[];
  confidence?: number;
  created_at: number;
  updated_at: number;
  accessed_at?: number;
  access_count: number;
  expires_at?: number;
  source_session?: string;
  source_message_id?: string;
  // Scope detection fields
  scope?: 'global' | 'agent' | 'inferred';
  scope_confidence?: number;
  target_agent_id?: string;
  scope_reasoning?: string;
}

export type MemoryType =
  | 'fact'
  | 'preference'
  | 'rule'
  | 'decision'
  | 'health'
  | 'reminder'
  | 'relationship';

export interface MemoryInput {
  agent_id: string;
  type: MemoryType;
  content: string;
  tags?: string[];
  embedding?: number[];
  confidence?: number;
  expires_at?: number;
  source_session?: string;
  source_message_id?: string;
  // Scope detection fields
  scope?: 'global' | 'agent' | 'inferred';
  scope_confidence?: number;
  target_agent_id?: string;
  scope_reasoning?: string;
}

export interface MemoryUpdate {
  content?: string;
  tags?: string[];
  embedding?: number[];
  confidence?: number;
  expires_at?: number;
  // Scope detection fields
  scope?: 'global' | 'agent' | 'inferred';
  scope_confidence?: number;
  target_agent_id?: string;
  scope_reasoning?: string;
}

export interface MemoryQuery {
  agent_id: string;
  type?: MemoryType;
  types?: MemoryType[];
  tag?: string;
  search?: string;
  hasEmbedding?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: 'created_at' | 'accessed_at' | 'access_count';
  order?: 'asc' | 'desc';
}

export interface MemoryStats {
  totalMemories: number;
  byAgent: Record<string, number>;
  byType: Record<string, number>;
}

interface DbRow {
  id: string;
  agent_id: string;
  type: string;
  content: string;
  tags: string | null;
  embedding: Buffer | null;
  confidence: number | null;
  created_at: number;
  updated_at: number;
  accessed_at: number | null;
  access_count: number;
  expires_at: number | null;
  source_session: string | null;
  source_message_id: string | null;
  // Scope detection fields
  scope: string | null;
  scope_confidence: number | null;
  target_agent_id: string | null;
  scope_reasoning: string | null;
}

/**
 * Serialize embedding array to binary buffer
 */
function serializeEmbedding(embedding: number[]): Buffer {
  const float32Array = new Float32Array(embedding);
  return Buffer.from(float32Array.buffer);
}

/**
 * Deserialize binary buffer to embedding array
 */
function deserializeEmbedding(buffer: Buffer): number[] {
  // Create a proper Float32Array from the buffer
  const float32Array = new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.length / Float32Array.BYTES_PER_ELEMENT
  );
  return Array.from(float32Array);
}

/**
 * Convert database row to Memory object
 */
function rowToMemory(row: DbRow): Memory {
  const memory: Memory = {
    id: row.id,
    agent_id: row.agent_id,
    type: row.type as MemoryType,
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at,
    access_count: row.access_count,
  };

  if (row.tags) {
    memory.tags = JSON.parse(row.tags);
  }
  if (row.embedding) {
    memory.embedding = deserializeEmbedding(row.embedding);
  }
  if (row.confidence !== null) {
    memory.confidence = row.confidence;
  }
  if (row.accessed_at !== null) {
    memory.accessed_at = row.accessed_at;
  }
  if (row.expires_at !== null) {
    memory.expires_at = row.expires_at;
  }
  if (row.source_session) {
    memory.source_session = row.source_session;
  }
  if (row.source_message_id) {
    memory.source_message_id = row.source_message_id;
  }
  if (row.scope) {
    memory.scope = row.scope as 'global' | 'agent' | 'inferred';
  }
  if (row.scope_confidence !== null) {
    memory.scope_confidence = row.scope_confidence;
  }
  if (row.target_agent_id) {
    memory.target_agent_id = row.target_agent_id;
  }
  if (row.scope_reasoning) {
    memory.scope_reasoning = row.scope_reasoning;
  }

  return memory;
}

export class MemoryStore {
  private db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    // Create parent directory if it doesn't exist (unless using in-memory database)
    if (dbPath !== ':memory:') {
      const parentDir = dirname(dbPath);
      mkdirSync(parentDir, { recursive: true });
    }
    
    this.db = new Database(dbPath);
    this.initialize();
  }

  /**
   * Initialize database schema
   */
  private initialize(): void {
    // Enable WAL mode for better concurrent performance
    this.db.pragma('journal_mode = WAL');

    // Create memories table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT,
        embedding BLOB,
        confidence REAL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        accessed_at INTEGER,
        access_count INTEGER DEFAULT 0,
        expires_at INTEGER,
        source_session TEXT,
        source_message_id TEXT,
        scope TEXT,
        scope_confidence REAL,
        target_agent_id TEXT,
        scope_reasoning TEXT
      )
    `);

    // Create indexes for efficient queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id);
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(agent_id, type);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(agent_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_accessed ON memories(agent_id, accessed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_expires ON memories(expires_at) WHERE expires_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, target_agent_id);
    `);
  }

  /**
   * Create a new memory
   */
  create(input: MemoryInput): Memory {
    const now = Date.now();
    const id = uuidv7();

    const stmt = this.db.prepare(`
      INSERT INTO memories (
        id, agent_id, type, content, tags, embedding, confidence,
        created_at, updated_at, access_count, expires_at,
        source_session, source_message_id, scope, scope_confidence,
        target_agent_id, scope_reasoning
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, 0, ?,
        ?, ?, ?, ?,
        ?, ?
      )
    `);

    stmt.run(
      id,
      input.agent_id,
      input.type,
      input.content,
      input.tags ? JSON.stringify(input.tags) : null,
      input.embedding ? serializeEmbedding(input.embedding) : null,
      input.confidence ?? null,
      now,
      now,
      input.expires_at ?? null,
      input.source_session ?? null,
      input.source_message_id ?? null,
      input.scope ?? null,
      input.scope_confidence ?? null,
      input.target_agent_id ?? null,
      input.scope_reasoning ?? null
    );

    return this.get(id)!;
  }

  /**
   * Get a memory by ID
   */
  get(id: string): Memory | undefined {
    const stmt = this.db.prepare('SELECT * FROM memories WHERE id = ?');
    const row = stmt.get(id) as DbRow | undefined;

    if (!row) return undefined;
    return rowToMemory(row);
  }

  /**
   * Update a memory
   */
  update(id: string, updates: MemoryUpdate): Memory | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;

    const now = Date.now();
    const fields: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];

    if (updates.content !== undefined) {
      fields.push('content = ?');
      values.push(updates.content);
    }
    if (updates.tags !== undefined) {
      fields.push('tags = ?');
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.embedding !== undefined) {
      fields.push('embedding = ?');
      values.push(serializeEmbedding(updates.embedding));
    }
    if (updates.confidence !== undefined) {
      fields.push('confidence = ?');
      values.push(updates.confidence);
    }
    if (updates.expires_at !== undefined) {
      fields.push('expires_at = ?');
      values.push(updates.expires_at);
    }
    if (updates.scope !== undefined) {
      fields.push('scope = ?');
      values.push(updates.scope);
    }
    if (updates.scope_confidence !== undefined) {
      fields.push('scope_confidence = ?');
      values.push(updates.scope_confidence);
    }
    if (updates.target_agent_id !== undefined) {
      fields.push('target_agent_id = ?');
      values.push(updates.target_agent_id);
    }
    if (updates.scope_reasoning !== undefined) {
      fields.push('scope_reasoning = ?');
      values.push(updates.scope_reasoning);
    }

    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE memories SET ${fields.join(', ')} WHERE id = ?
    `);
    stmt.run(...values);

    return this.get(id);
  }

  /**
   * Delete a memory
   */
  delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM memories WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Query memories with filters
   */
  query(query: MemoryQuery): Memory[] {
    const conditions: string[] = ['agent_id = ?'];
    const values: unknown[] = [query.agent_id];

    // Type filter
    if (query.type) {
      conditions.push('type = ?');
      values.push(query.type);
    } else if (query.types && query.types.length > 0) {
      const placeholders = query.types.map(() => '?').join(', ');
      conditions.push(`type IN (${placeholders})`);
      values.push(...query.types);
    }

    // Tag filter (search in JSON array)
    if (query.tag) {
      conditions.push('tags LIKE ?');
      values.push(`%"${query.tag}"%`);
    }

    // Text search
    if (query.search) {
      conditions.push('content LIKE ?');
      values.push(`%${query.search}%`);
    }

    // Has embedding filter
    if (query.hasEmbedding) {
      conditions.push('embedding IS NOT NULL');
    }

    // Build ORDER BY
    const orderBy = query.orderBy ?? 'created_at';
    const order = query.order ?? 'desc';

    // Build query
    let sql = `SELECT * FROM memories WHERE ${conditions.join(' AND ')} ORDER BY ${orderBy} ${order.toUpperCase()}`;

    // Apply limit
    if (query.limit) {
      sql += ` LIMIT ${query.limit}`;
    }
    if (query.offset) {
      sql += ` OFFSET ${query.offset}`;
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...values) as DbRow[];

    return rows.map(rowToMemory);
  }

  /**
   * Record access to memories (updates accessed_at and access_count)
   */
  recordAccess(ids: string[]): void {
    if (ids.length === 0) return;

    const now = Date.now();
    const placeholders = ids.map(() => '?').join(', ');

    const stmt = this.db.prepare(`
      UPDATE memories 
      SET accessed_at = ?, access_count = access_count + 1
      WHERE id IN (${placeholders})
    `);

    stmt.run(now, ...ids);
  }

  /**
   * Get recent memories for deduplication checking
   */
  getRecentForDedup(
    agentId: string,
    windowSeconds: number,
    limit: number = 50
  ): Array<{ id: string; embedding: number[] }> {
    const cutoff = Date.now() - windowSeconds * 1000;

    const stmt = this.db.prepare(`
      SELECT id, embedding FROM memories
      WHERE agent_id = ? AND created_at > ? AND embedding IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(agentId, cutoff, limit) as Array<{
      id: string;
      embedding: Buffer | null;
    }>;

    return rows
      .filter((r) => r.embedding !== null)
      .map((r) => ({
        id: r.id,
        embedding: deserializeEmbedding(r.embedding!),
      }));
  }

  /**
   * Prune expired memories
   */
  pruneExpired(): number {
    const now = Date.now();
    const stmt = this.db.prepare(
      'DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?'
    );
    const result = stmt.run(now);
    return result.changes;
  }

  /**
   * Get statistics about stored memories
   */
  getStats(): MemoryStats {
    const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM memories');
    const totalRow = totalStmt.get() as { count: number };

    const byAgentStmt = this.db.prepare(
      'SELECT agent_id, COUNT(*) as count FROM memories GROUP BY agent_id'
    );
    const byAgentRows = byAgentStmt.all() as Array<{
      agent_id: string;
      count: number;
    }>;

    const byTypeStmt = this.db.prepare(
      'SELECT type, COUNT(*) as count FROM memories GROUP BY type'
    );
    const byTypeRows = byTypeStmt.all() as Array<{ type: string; count: number }>;

    const byAgent: Record<string, number> = {};
    for (const row of byAgentRows) {
      byAgent[row.agent_id] = row.count;
    }

    const byType: Record<string, number> = {};
    for (const row of byTypeRows) {
      byType[row.type] = row.count;
    }

    return {
      totalMemories: totalRow.count,
      byAgent,
      byType,
    };
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}
