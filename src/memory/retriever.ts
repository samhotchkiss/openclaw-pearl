/**
 * Pearl Memory Retriever
 * Semantic search and retrieval of relevant memories
 */

import type { Memory, MemoryType, MemoryStore } from './store.js';
import type { EmbeddingService } from './embeddings.js';
import { cosineSimilarity } from './embeddings.js';

// ====== Types ======

/**
 * Memory with relevance score attached
 */
export interface ScoredMemory extends Memory {
  /** Relevance score (0-1, higher is more relevant) */
  score: number;
}

/**
 * Options for memory retrieval
 */
export interface RetrievalOptions {
  /** Maximum number of memories to return (default: 10) */
  limit?: number;

  /** Minimum similarity score threshold (default: 0.3) */
  minScore?: number;

  /** Filter to specific memory types */
  types?: MemoryType[];

  /** Weight multipliers for different memory types */
  typeWeights?: Partial<Record<MemoryType, number>>;

  /** Apply recency boost (default: true) */
  recencyBoost?: boolean;

  /** Half-life for recency decay in hours (default: 168 = 1 week) */
  recencyHalfLifeHours?: number;

  /** Maximum token budget for returned memories */
  tokenBudget?: number;

  /** Record access to retrieved memories (default: true) */
  recordAccess?: boolean;
}

/**
 * Default retrieval configuration
 */
export interface RetrieverConfig {
  limit?: number;
  minScore?: number;
  recencyBoost?: boolean;
  recencyHalfLifeHours?: number;
  typeWeights?: Partial<Record<MemoryType, number>>;
}

// ====== Constants ======

const DEFAULT_CONFIG: Required<RetrieverConfig> = {
  limit: 10,
  minScore: 0.3,
  recencyBoost: true,
  recencyHalfLifeHours: 168, // 1 week
  typeWeights: {
    rule: 1.5,
    decision: 1.3,
    preference: 1.2,
    fact: 1.0,
    health: 1.0,
    relationship: 1.0,
    reminder: 0.8,
  },
};

// ====== Utility Functions ======

/**
 * Estimate token count for text (rough approximation: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculate recency decay factor using exponential decay
 * @param ageMs Age of memory in milliseconds
 * @param halfLifeHours Half-life in hours
 * @returns Decay factor (0-1, where 1 = brand new)
 */
function calculateRecencyFactor(ageMs: number, halfLifeHours: number): number {
  const halfLifeMs = halfLifeHours * 60 * 60 * 1000;
  // Exponential decay: e^(-ln(2) * age / halfLife) = 2^(-age/halfLife)
  return Math.pow(2, -ageMs / halfLifeMs);
}

// ====== Memory Retriever ======

/**
 * Memory retrieval service for semantic search
 * 
 * Features:
 * - Semantic search using embeddings + cosine similarity
 * - Type filtering and weighting
 * - Recency boost for newer memories
 * - Token budgeting to control output size
 * - Access tracking for analytics
 */
export class MemoryRetriever {
  private store: MemoryStore;
  private embeddings: EmbeddingService;
  private config: Required<RetrieverConfig>;

  constructor(
    store: MemoryStore,
    embeddings: EmbeddingService,
    config: RetrieverConfig = {}
  ) {
    this.store = store;
    this.embeddings = embeddings;
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      typeWeights: {
        ...DEFAULT_CONFIG.typeWeights,
        ...config.typeWeights,
      },
    };
  }

  /**
   * Retrieve relevant memories for a query
   * 
   * @param agentId Agent namespace to search within
   * @param query Search query (will be embedded for semantic search)
   * @param options Retrieval options
   * @returns Array of memories with relevance scores, sorted by score descending
   */
  async retrieve(
    agentId: string,
    query: string,
    options: RetrievalOptions = {}
  ): Promise<ScoredMemory[]> {
    // Merge options with defaults
    const opts = this.mergeOptions(options);

    // 1. Embed the query
    let queryEmbedding: Float32Array;
    try {
      queryEmbedding = await this.embeddings.embed(query);
    } catch (error) {
      console.warn('Failed to generate embedding for query:', error);
      // Return empty results when embedding fails
      return [];
    }

    // 2. Get all memories with embeddings for this agent
    const memories = this.store.query({
      agent_id: agentId,
      types: opts.types,
      hasEmbedding: true,
      limit: 1000, // Get all, we'll filter/sort ourselves
    });

    if (memories.length === 0) {
      return [];
    }

    // 3. Score each memory
    const now = Date.now();
    const scored: ScoredMemory[] = memories.map((memory) => {
      // Base similarity score
      const similarity = cosineSimilarity(
        queryEmbedding,
        memory.embedding!
      );

      // Apply type weight
      const typeWeight = opts.typeWeights?.[memory.type] ?? 1.0;

      // Apply recency boost
      let recencyFactor = 1.0;
      if (opts.recencyBoost) {
        const ageMs = now - memory.created_at;
        recencyFactor = calculateRecencyFactor(ageMs, opts.recencyHalfLifeHours!);
        // Blend recency with similarity (recency is a bonus, not a replacement)
        // Using sqrt to soften the recency effect
        recencyFactor = 0.7 + 0.3 * recencyFactor; // Range: 0.7 - 1.0
      }

      // Calculate final score
      const score = similarity * typeWeight * recencyFactor;

      return {
        ...memory,
        score,
      };
    });

    // 4. Filter by minimum score
    const filtered = scored.filter((m) => m.score >= opts.minScore!);

    // 5. Sort by score descending
    filtered.sort((a, b) => b.score - a.score);

    // 6. Apply limit
    let results = filtered.slice(0, opts.limit);

    // 7. Apply token budget if specified
    if (opts.tokenBudget !== undefined && opts.tokenBudget > 0) {
      results = this.applyTokenBudget(results, opts.tokenBudget);
    }

    // 8. Record access if enabled
    if (opts.recordAccess !== false && results.length > 0) {
      this.store.recordAccess(results.map((m) => m.id));
    }

    return results;
  }

  /**
   * Merge provided options with defaults
   */
  private mergeOptions(options: RetrievalOptions): Required<Omit<RetrievalOptions, 'tokenBudget' | 'types'>> & Pick<RetrievalOptions, 'tokenBudget' | 'types'> {
    return {
      limit: options.limit ?? this.config.limit,
      minScore: options.minScore ?? this.config.minScore,
      types: options.types,
      typeWeights: {
        ...this.config.typeWeights,
        ...options.typeWeights,
      },
      recencyBoost: options.recencyBoost ?? this.config.recencyBoost,
      recencyHalfLifeHours: options.recencyHalfLifeHours ?? this.config.recencyHalfLifeHours,
      tokenBudget: options.tokenBudget,
      recordAccess: options.recordAccess ?? true,
    };
  }

  /**
   * Apply token budget constraint, selecting memories within budget
   */
  private applyTokenBudget(memories: ScoredMemory[], budget: number): ScoredMemory[] {
    const selected: ScoredMemory[] = [];
    let tokensUsed = 0;

    for (const memory of memories) {
      const memoryTokens = estimateTokens(memory.content);

      // If this memory would exceed budget, check if we have any results yet
      if (tokensUsed + memoryTokens > budget) {
        // Include at least one result if possible
        if (selected.length === 0 && memoryTokens <= budget * 2) {
          selected.push(memory);
        }
        break;
      }

      selected.push(memory);
      tokensUsed += memoryTokens;
    }

    return selected;
  }

  /**
   * Update default configuration
   */
  setConfig(config: Partial<RetrieverConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      typeWeights: {
        ...this.config.typeWeights,
        ...config.typeWeights,
      },
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): Required<RetrieverConfig> {
    return { ...this.config };
  }
}
