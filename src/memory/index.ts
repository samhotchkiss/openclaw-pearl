/**
 * Pearl Memory Module
 */

export {
  MemoryStore,
  type Memory,
  type MemoryType,
  type MemoryInput,
  type MemoryUpdate,
  type MemoryQuery,
  type MemoryStats,
} from './store.js';

export {
  MemoryExtractor,
  OllamaProvider,
  AnthropicProvider,
  OpenAIProvider,
  createProvider,
  type ExtractedMemory,
  type ExtractionResult,
  type LLMProvider,
  type LLMProviderConfig,
} from './extractor.js';

export {
  EmbeddingService,
  OllamaEmbeddingProvider,
  OpenAIEmbeddingProvider,
  createEmbeddingProvider,
  cosineSimilarity,
  type EmbeddingProvider,
  type EmbeddingProviderConfig,
  type OllamaProviderConfig,
  type OpenAIProviderConfig,
} from './embeddings.js';

export {
  MemoryRetriever,
  estimateTokens,
  type ScoredMemory,
  type RetrievalOptions,
  type RetrieverConfig,
} from './retriever.js';

export {
  PromptAugmenter,
  formatMemoriesForInjection,
  type AugmentOptions,
  type AugmentResult,
  type SessionStats,
  type ChatMessage,
  type MessageRole,
  type MemoryRetrieverInterface,
} from './augmenter.js';
