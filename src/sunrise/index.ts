/**
 * Pearl Sunrise Module
 * 
 * Session recovery through sunrise summaries.
 * 
 * When an agent session starts after a gap, Pearl reads conversation logs
 * and generates a summary to help the agent resume with context.
 */

export {
  TranscriptLogger,
  TranscriptReader,
  type TranscriptEntry,
  type TranscriptMessage,
  type ReadOptions,
} from './transcript.js';

export {
  SunriseSummarizer,
  formatSummary,
  OllamaSummaryProvider,
  AnthropicSummaryProvider,
  OpenAISummaryProvider,
  SUMMARY_SYSTEM_PROMPT,
  type SessionSummary,
  type SummaryProvider,
  type SummarizerConfig,
} from './summarizer.js';

export {
  SunriseDetector,
  type SunriseCheckResult,
  type SunriseCheckOptions,
  type SunriseDetectorConfig,
} from './detector.js';

import { TranscriptReader } from './transcript.js';
import { SunriseSummarizer, formatSummary, type SessionSummary } from './summarizer.js';
import { SunriseDetector, type SunriseCheckOptions } from './detector.js';
import type { ChatMessage } from '../memory/augmenter.js';

// ====== Types ======

/**
 * Sunrise service configuration
 */
export interface SunriseConfig {
  /** Transcript reader */
  reader: TranscriptReader;
  /** Summary generator */
  summarizer: SunriseSummarizer;
  /** Sunrise detector */
  detector: SunriseDetector;
  /** Lookback window for reading transcripts (default: 2 hours) */
  lookbackMs?: number;
  /** Maximum messages to read from transcript */
  maxMessages?: number;
}

/**
 * Result of handling a request
 */
export interface SunriseHandleResult {
  /** Augmented messages (with summary injected if needed) */
  messages: ChatMessage[];
  /** Whether a summary was injected */
  summaryInjected: boolean;
  /** The generated summary (if any) */
  summary?: SessionSummary;
}

// ====== Constants ======

const DEFAULT_LOOKBACK_MS = 7200000; // 2 hours
const DEFAULT_MAX_MESSAGES = 100;

const SUNRISE_BLOCK_START = '<pearl:sunrise>';
const SUNRISE_BLOCK_END = '</pearl:sunrise>';

// ====== SunriseService ======

/**
 * Main service for sunrise session recovery
 * 
 * Integrates detection, transcript reading, and summary generation
 * to provide seamless session recovery.
 * 
 * Usage:
 * ```typescript
 * const service = new SunriseService({
 *   reader: new TranscriptReader('/path/to/logs'),
 *   summarizer: new SunriseSummarizer({ provider: ollamaProvider }),
 *   detector: new SunriseDetector({ reader }),
 * });
 * 
 * const result = await service.handleRequest(agentId, sessionId, messages);
 * // result.messages contains augmented messages with summary if needed
 * ```
 */
export class SunriseService {
  private reader: TranscriptReader;
  private summarizer: SunriseSummarizer;
  private detector: SunriseDetector;
  private lookbackMs: number;
  private maxMessages: number;

  /**
   * Summary cache: "{agentId}:{sessionId}" -> SessionSummary
   */
  private summaryCache: Map<string, SessionSummary> = new Map();

  constructor(config: SunriseConfig) {
    this.reader = config.reader;
    this.summarizer = config.summarizer;
    this.detector = config.detector;
    this.lookbackMs = config.lookbackMs ?? DEFAULT_LOOKBACK_MS;
    this.maxMessages = config.maxMessages ?? DEFAULT_MAX_MESSAGES;
  }

  /**
   * Handle a request, injecting sunrise summary if needed
   */
  async handleRequest(
    agentId: string,
    sessionId: string,
    messages: ChatMessage[],
    options: SunriseCheckOptions = {}
  ): Promise<SunriseHandleResult> {
    // Check if sunrise recovery is needed
    const checkResult = await this.detector.check(agentId, sessionId, options);

    if (!checkResult.needsRecovery) {
      return {
        messages,
        summaryInjected: false,
      };
    }

    // Get or generate summary
    const summary = await this.getOrGenerateSummary(agentId, sessionId);

    if (!summary) {
      return {
        messages,
        summaryInjected: false,
      };
    }

    // Inject summary into messages
    const augmentedMessages = this.injectSummary(messages, summary);

    // Mark as recovered
    this.detector.markRecovered(agentId, sessionId);

    return {
      messages: augmentedMessages,
      summaryInjected: true,
      summary,
    };
  }

  /**
   * Get cached summary or generate a new one
   */
  private async getOrGenerateSummary(
    agentId: string,
    sessionId: string
  ): Promise<SessionSummary | null> {
    const cacheKey = `${agentId}:${sessionId}`;

    // Check cache first
    if (this.summaryCache.has(cacheKey)) {
      return this.summaryCache.get(cacheKey)!;
    }

    // Read transcript
    const transcript = await this.reader.readRecent(agentId, sessionId, {
      lookbackMs: this.lookbackMs,
      maxMessages: this.maxMessages,
    });

    // Generate summary
    const summary = await this.summarizer.summarize(transcript);

    if (summary) {
      // Cache the summary
      this.summaryCache.set(cacheKey, summary);
    }

    return summary;
  }

  /**
   * Inject summary into message array
   */
  private injectSummary(
    messages: ChatMessage[],
    summary: SessionSummary
  ): ChatMessage[] {
    const formattedSummary = formatSummary(summary);
    const wrappedSummary = `${SUNRISE_BLOCK_START}\n${formattedSummary}\n${SUNRISE_BLOCK_END}`;

    // Create a copy to avoid mutating original
    const result = messages.map(m => ({ ...m }));

    // Find system message
    const systemIndex = result.findIndex(m => m.role === 'system');

    if (systemIndex >= 0) {
      // Prepend summary to existing system message
      const original = result[systemIndex].content;
      result[systemIndex] = {
        ...result[systemIndex],
        content: `${wrappedSummary}\n\n${original}`,
      };
    } else {
      // Create new system message with summary
      result.unshift({
        role: 'system',
        content: wrappedSummary,
      });
    }

    return result;
  }

  /**
   * Clear cached summary for a session
   */
  clearCache(agentId: string, sessionId: string): void {
    const cacheKey = `${agentId}:${sessionId}`;
    this.summaryCache.delete(cacheKey);
    this.detector.clearRecovered(agentId, sessionId);
  }

  /**
   * Clear all cached summaries
   */
  clearAllCaches(): void {
    this.summaryCache.clear();
    this.detector.clearAllRecovered();
  }

  /**
   * Get cached summary (if any)
   */
  getCachedSummary(agentId: string, sessionId: string): SessionSummary | undefined {
    const cacheKey = `${agentId}:${sessionId}`;
    return this.summaryCache.get(cacheKey);
  }

  /**
   * Force regeneration of summary for a session
   */
  async regenerateSummary(
    agentId: string,
    sessionId: string
  ): Promise<SessionSummary | null> {
    const cacheKey = `${agentId}:${sessionId}`;
    
    // Clear existing cache
    this.summaryCache.delete(cacheKey);

    // Read transcript
    const transcript = await this.reader.readRecent(agentId, sessionId, {
      lookbackMs: this.lookbackMs,
      maxMessages: this.maxMessages,
    });

    // Generate new summary
    const summary = await this.summarizer.summarize(transcript);

    if (summary) {
      this.summaryCache.set(cacheKey, summary);
    }

    return summary;
  }
}

// ====== Factory Functions ======

/**
 * Create a complete sunrise service from configuration
 */
export interface CreateSunriseServiceOptions {
  /** Path to transcript storage */
  transcriptPath: string;
  /** Summary provider configuration */
  summary: {
    provider: 'ollama' | 'anthropic' | 'openai';
    model?: string;
    apiKey?: string;
    baseUrl?: string;
  };
  /** Gap threshold to trigger sunrise (default: 1 hour) */
  gapThresholdMs?: number;
  /** Lookback window for transcripts (default: 2 hours) */
  lookbackMs?: number;
  /** Maximum messages to read (default: 100) */
  maxMessages?: number;
  /** Minimum messages for summary (default: 2) */
  minMessages?: number;
}

import {
  OllamaSummaryProvider,
  AnthropicSummaryProvider,
  OpenAISummaryProvider,
} from './summarizer.js';

export function createSunriseService(options: CreateSunriseServiceOptions): SunriseService {
  const reader = new TranscriptReader(options.transcriptPath);

  // Create summary provider based on config
  let provider;
  switch (options.summary.provider) {
    case 'ollama':
      provider = new OllamaSummaryProvider(
        options.summary.baseUrl ?? 'http://localhost:11434',
        options.summary.model ?? 'llama3.2:3b'
      );
      break;
    case 'openai':
      if (!options.summary.apiKey) {
        throw new Error('OpenAI provider requires apiKey');
      }
      provider = new OpenAISummaryProvider(
        options.summary.apiKey,
        options.summary.model ?? 'gpt-4o-mini',
        options.summary.baseUrl ?? 'https://api.openai.com/v1'
      );
      break;
    case 'anthropic':
      if (!options.summary.apiKey) {
        throw new Error('Anthropic provider requires apiKey');
      }
      provider = new AnthropicSummaryProvider(
        options.summary.apiKey,
        options.summary.model ?? 'claude-3-5-haiku-20241022'
      );
      break;
    default:
      throw new Error(`Unknown provider: ${options.summary.provider}`);
  }

  const summarizer = new SunriseSummarizer({
    provider,
    minMessages: options.minMessages,
    maxMessages: options.maxMessages,
  });

  const detector = new SunriseDetector({
    reader,
    gapThresholdMs: options.gapThresholdMs,
  });

  return new SunriseService({
    reader,
    summarizer,
    detector,
    lookbackMs: options.lookbackMs,
    maxMessages: options.maxMessages,
  });
}
