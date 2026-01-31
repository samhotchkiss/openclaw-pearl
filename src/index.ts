/**
 * Pearl - Memory layer and intelligent model router for OpenClaw
 */

export { createServer } from './server/index.js';
export { MemoryStore } from './memory/store.js';
export { MemoryExtractor, createProvider } from './memory/extractor.js';
export { MemoryRetriever, estimateTokens } from './memory/retriever.js';
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

// Future exports (to be implemented):
// export { Pearl } from './pearl.js';
// export { Router } from './routing/router.js';
// export type { RoutingRule, Classification } from './routing/types.js';
