/**
 * Pearl Prompt Augmenter
 *
 * Injects relevant memories into prompts transparently.
 * The agent doesn't know it's being augmented - memories appear
 * as additional context in the system message.
 *
 * Features:
 * - Semantic retrieval of relevant memories
 * - Session tracking to avoid duplicate injection
 * - Token budget management
 * - OpenAI message format compatibility
 */

import type { MemoryType } from './store.js';
import type { ScoredMemory, RetrievalOptions } from './retriever.js';

// ====== Types ======

/**
 * Message role (OpenAI-compatible)
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool' | 'function';

/**
 * Chat message (OpenAI-compatible format)
 */
export interface ChatMessage {
  role: MessageRole;
  content: string;
  name?: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

/**
 * Memory retriever interface
 * Defines what the augmenter needs from the retriever
 */
export interface MemoryRetrieverInterface {
  retrieve(
    agentId: string,
    query: string,
    options?: RetrievalOptions
  ): Promise<ScoredMemory[]>;
}

/**
 * Options for prompt augmentation
 */
export interface AugmentOptions {
  /** Session ID for tracking injected memories (prevents duplicates within session) */
  sessionId?: string;

  /** Maximum tokens to use for memory injection (default: 500) */
  tokenBudget?: number;

  /** Maximum number of memories to inject (default: 10) */
  maxMemories?: number;

  /** Minimum relevance score for memories (default: 0.3) */
  minScore?: number;

  /** Filter to specific memory types */
  types?: MemoryType[];

  /** Type weights for retrieval scoring */
  typeWeights?: Partial<Record<MemoryType, number>>;

  /** Number of recent user messages to include in query context (default: 1) */
  queryContextMessages?: number;

  /** Skip session tracking (always inject even if seen before) */
  skipSessionTracking?: boolean;
}

/**
 * Result of prompt augmentation
 */
export interface AugmentResult {
  /** Augmented messages with memories injected */
  messages: ChatMessage[];

  /** IDs of memories that were injected (new this call) */
  injectedMemories: string[];

  /** Estimated tokens used by injected memories */
  tokensUsed: number;
}

/**
 * Session statistics
 */
export interface SessionStats {
  /** Number of unique memories injected in this session */
  injectedCount: number;

  /** List of memory IDs injected */
  memoryIds: string[];
}

// ====== Constants ======

const DEFAULT_TOKEN_BUDGET = 500;
const DEFAULT_MAX_MEMORIES = 10;
const DEFAULT_MIN_SCORE = 0.3;
const DEFAULT_QUERY_CONTEXT_MESSAGES = 1;

const MEMORY_BLOCK_START = '<pearl:memories>';
const MEMORY_BLOCK_END = '</pearl:memories>';

/**
 * Memory types that get a prefix label when injected
 */
const LABELED_TYPES: Set<MemoryType> = new Set([
  'decision',
  'rule',
  'health',
  'reminder',
]);

// ====== Utility Functions ======

/**
 * Estimate token count for text (rough: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Get label prefix for memory type (for context)
 */
function getTypeLabel(type: MemoryType): string | null {
  switch (type) {
    case 'decision':
      return '[Decision]';
    case 'rule':
      return '[Rule]';
    case 'health':
      return '[Health]';
    case 'reminder':
      return '[Reminder]';
    default:
      return null;
  }
}

/**
 * Format a single memory for injection
 */
function formatMemory(memory: ScoredMemory): string {
  const label = getTypeLabel(memory.type);
  if (label) {
    return `- ${label} ${memory.content}`;
  }
  return `- ${memory.content}`;
}

/**
 * Format memories into a block for system prompt injection
 */
export function formatMemoriesForInjection(memories: ScoredMemory[]): string {
  if (memories.length === 0) {
    return '';
  }

  const lines = memories.map(formatMemory);

  return `${MEMORY_BLOCK_START}
## Relevant Context
${lines.join('\n')}
${MEMORY_BLOCK_END}`;
}

/**
 * Extract user messages from conversation for query building
 */
function extractUserMessages(
  messages: ChatMessage[],
  count: number
): string[] {
  const userMessages = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content);

  // Return last N user messages
  return userMessages.slice(-count);
}

/**
 * Build retrieval query from user messages
 */
function buildRetrievalQuery(
  messages: ChatMessage[],
  contextCount: number
): string {
  const userTexts = extractUserMessages(messages, contextCount);

  if (userTexts.length === 0) {
    // Fallback: use any message content
    const anyContent = messages.find((m) => m.content)?.content;
    return anyContent || '';
  }

  // Join with newline for context
  return userTexts.join('\n');
}

/**
 * Select memories within token budget
 */
function selectWithinBudget(
  memories: ScoredMemory[],
  budget: number
): { selected: ScoredMemory[]; tokensUsed: number } {
  const selected: ScoredMemory[] = [];
  let tokensUsed = 0;

  // Account for wrapper overhead
  const wrapperOverhead = estimateTokens(
    MEMORY_BLOCK_START + MEMORY_BLOCK_END + '## Relevant Context\n'
  );

  let availableBudget = budget - wrapperOverhead;
  if (availableBudget < 0) availableBudget = 0;

  for (const memory of memories) {
    const memoryTokens = estimateTokens(formatMemory(memory));

    if (tokensUsed + memoryTokens > availableBudget) {
      break;
    }

    selected.push(memory);
    tokensUsed += memoryTokens;
  }

  return { selected, tokensUsed };
}

// ====== PromptAugmenter Class ======

/**
 * Prompt augmentation service
 *
 * Retrieves relevant memories and injects them into the system prompt
 * in a way that's transparent to the agent.
 *
 * Usage:
 * ```typescript
 * const augmenter = new PromptAugmenter(retriever);
 * const result = await augmenter.augment('agent-id', messages, {
 *   sessionId: 'session-123',
 *   tokenBudget: 500,
 * });
 * // result.messages contains augmented conversation
 * ```
 */
export class PromptAugmenter {
  private retriever: MemoryRetrieverInterface;

  /**
   * Session tracking: sessionId -> Set of injected memory IDs
   */
  private sessionMemories: Map<string, Set<string>> = new Map();

  constructor(retriever: MemoryRetrieverInterface) {
    this.retriever = retriever;
  }

  /**
   * Augment messages with relevant memories
   *
   * @param agentId Agent namespace for memory retrieval
   * @param messages OpenAI-format message array
   * @param options Augmentation options
   * @returns Augmented messages and injection metadata
   */
  async augment(
    agentId: string,
    messages: ChatMessage[],
    options: AugmentOptions = {}
  ): Promise<AugmentResult> {
    // Handle empty messages
    if (messages.length === 0) {
      return {
        messages: [],
        injectedMemories: [],
        tokensUsed: 0,
      };
    }

    // Extract options with defaults
    const {
      sessionId,
      tokenBudget = DEFAULT_TOKEN_BUDGET,
      maxMemories = DEFAULT_MAX_MEMORIES,
      minScore = DEFAULT_MIN_SCORE,
      types,
      typeWeights,
      queryContextMessages = DEFAULT_QUERY_CONTEXT_MESSAGES,
      skipSessionTracking = false,
    } = options;

    // Build query from user messages
    const query = buildRetrievalQuery(messages, queryContextMessages);

    // Retrieve relevant memories
    const retrievalOptions: RetrievalOptions = {
      limit: maxMemories,
      minScore,
      types,
      typeWeights,
      tokenBudget,
    };

    let memories = await this.retriever.retrieve(
      agentId,
      query,
      retrievalOptions
    );

    // Filter out already-injected memories for this session
    if (sessionId && !skipSessionTracking) {
      const injected = this.sessionMemories.get(sessionId);
      if (injected) {
        memories = memories.filter((m) => !injected.has(m.id));
      }
    }

    // Apply token budget
    const { selected, tokensUsed } = selectWithinBudget(memories, tokenBudget);

    // Track newly injected memories
    const injectedIds = selected.map((m) => m.id);
    if (sessionId && !skipSessionTracking && injectedIds.length > 0) {
      const existing = this.sessionMemories.get(sessionId) || new Set();
      injectedIds.forEach((id) => existing.add(id));
      this.sessionMemories.set(sessionId, existing);
    }

    // If no memories to inject, return original messages
    if (selected.length === 0) {
      return {
        messages: [...messages],
        injectedMemories: [],
        tokensUsed: 0,
      };
    }

    // Format memories for injection
    const memoryBlock = formatMemoriesForInjection(selected);

    // Inject into messages
    const augmentedMessages = this.injectMemories(messages, memoryBlock);

    return {
      messages: augmentedMessages,
      injectedMemories: injectedIds,
      tokensUsed,
    };
  }

  /**
   * Inject memory block into message array
   *
   * Strategy: Prepend to system message, or create one if missing
   */
  private injectMemories(
    messages: ChatMessage[],
    memoryBlock: string
  ): ChatMessage[] {
    // Create a copy to avoid mutating original
    const result = messages.map((m) => ({ ...m }));

    // Find system message
    const systemIndex = result.findIndex((m) => m.role === 'system');

    if (systemIndex >= 0) {
      // Prepend memory block to existing system message
      const original = result[systemIndex].content;
      result[systemIndex] = {
        ...result[systemIndex],
        content: `${memoryBlock}\n\n${original}`,
      };
    } else {
      // Create new system message with memories
      result.unshift({
        role: 'system',
        content: memoryBlock,
      });
    }

    return result;
  }

  /**
   * Clear tracked memories for a session
   *
   * Useful when you want to allow re-injection of previously seen memories
   */
  clearSession(sessionId: string): void {
    this.sessionMemories.delete(sessionId);
  }

  /**
   * Clear all session tracking
   */
  clearAllSessions(): void {
    this.sessionMemories.clear();
  }

  /**
   * Get statistics for a session
   */
  getSessionStats(sessionId: string): SessionStats {
    const injected = this.sessionMemories.get(sessionId);

    if (!injected) {
      return {
        injectedCount: 0,
        memoryIds: [],
      };
    }

    return {
      injectedCount: injected.size,
      memoryIds: Array.from(injected),
    };
  }

  /**
   * Get all active session IDs
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessionMemories.keys());
  }
}
