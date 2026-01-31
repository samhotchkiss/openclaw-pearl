/**
 * Pearl - Memory layer and intelligent model router for OpenClaw
 */

export { createServer } from './server/index.js';
export { MemoryStore } from './memory/store.js';
export { MemoryExtractor, createProvider } from './memory/extractor.js';
export { MemoryRetriever, estimateTokens } from './memory/retriever.js';
export {
  PromptAugmenter,
  formatMemoriesForInjection,
} from './memory/augmenter.js';
export {
  EmbeddingService,
  OllamaEmbeddingProvider,
  OpenAIEmbeddingProvider,
  createEmbeddingProvider,
  cosineSimilarity,
} from './memory/embeddings.js';

export type { PearlConfig, ServerConfig } from './types.js';
export type {
  Memory,
  MemoryType,
  MemoryInput,
  MemoryUpdate,
  MemoryQuery,
  MemoryStats,
} from './memory/store.js';
export type {
  ExtractedMemory,
  ExtractionResult,
  LLMProvider,
  LLMProviderConfig,
} from './memory/extractor.js';
export type {
  ScoredMemory,
  RetrievalOptions,
  RetrieverConfig,
} from './memory/retriever.js';
export type {
  EmbeddingProvider,
  EmbeddingProviderConfig,
} from './memory/embeddings.js';
export type {
  AugmentOptions,
  AugmentResult,
  SessionStats,
  ChatMessage,
  MessageRole,
  MemoryRetrieverInterface,
} from './memory/augmenter.js';

// Main Pearl orchestrator
export { Pearl } from './pearl.js';

// Routing exports
export { ModelRouter } from './routing/router.js';
export type { RoutingResult, RouterOptions } from './routing/router.js';
export type { RequestClassification, RoutingRule } from './routing/types.js';

// Optimization exports
export { PromptRewriter } from './optimization/rewriter.js';
export type {
  RewriteResult,
  RewriterStats,
  RewriterConfig,
  LLMProvider as RewriterLLMProvider,
} from './optimization/rewriter.js';
