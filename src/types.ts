/**
 * Pearl configuration types
 */

// Re-export types needed by Pearl class
export type { 
  ChatRequest, 
  ChatChunk, 
  Message, 
  BackendClient 
} from './backends/types.js';
export type { 
  ScoredMemory 
} from './memory/retriever.js';
export type { 
  ExtractedMemory 
} from './memory/extractor.js';
export type { 
  AugmentResult,
  ChatMessage
} from './memory/augmenter.js';
export type { 
  RoutingResult 
} from './routing/router.js';

export interface PearlConfig {
  server: ServerConfig;
  memory: MemoryConfig;
  extraction: ExtractionConfig;
  embedding: EmbeddingConfig;
  retrieval: RetrievalConfig;
  routing: RoutingConfig;
  backends: BackendsConfig;
  logging?: LoggingConfig;
  sunrise?: SunriseConfig;
}

export interface SunriseConfig {
  enabled: boolean;
  transcriptPath: string;
  model: string;
  gapThresholdMs?: number;
  lookbackMs?: number;
  maxMessages?: number;
  minMessages?: number;
}

export interface ServerConfig {
  port: number;
  host: string;
  cors?: boolean;
}

export interface MemoryConfig {
  store: 'sqlite';
  path: string;
}

export interface ExtractionConfig {
  enabled: boolean;
  model: string;
  async: boolean;
  minConfidence: number;
  extractFromAssistant: boolean;
  dedupWindowSeconds: number;
}

export interface EmbeddingConfig {
  provider: 'ollama' | 'openai';
  model: string;
  dimensions: number;
}

export interface RetrievalConfig {
  maxMemories: number;
  minSimilarity: number;
  tokenBudget: number;
  recencyBoost: boolean;
  typeWeights?: Record<string, number>;
}

export interface RoutingConfig {
  classifier: string;
  defaultModel: string;
  rules: RoutingRuleConfig[];
  fallback?: Record<string, string[]>;
  agentOverrides?: Record<string, { defaultModel: string }>;
}

export interface RoutingRuleConfig {
  name: string;
  match: MatchConditions;
  model: string;
  priority: number;
}

export interface MatchConditions {
  default?: boolean;
  complexity?: 'low' | 'medium' | 'high';
  type?: string;
  sensitive?: boolean;
  estimatedTokens?: string;
}

export interface BackendsConfig {
  anthropic?: ProviderConfig;
  openai?: ProviderConfig;
  ollama?: OllamaConfig;
  openrouter?: ProviderConfig;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultParams?: Record<string, unknown>;
}

export interface OllamaConfig {
  baseUrl: string;
  defaultParams?: Record<string, unknown>;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  file?: string;
}
