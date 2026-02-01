/**
 * Config Normalization
 * Converts snake_case config to camelCase for internal use
 */

import type { Config } from './types.js';
import type { PearlConfig, ProviderConfig as InternalProviderConfig, OllamaConfig } from '../types.js';

/**
 * Normalize config from file format (snake_case) to internal format (camelCase)
 */
export function normalizeConfig(config: Config): PearlConfig {
  return {
    server: {
      port: config.server.port,
      host: config.server.host,
      cors: config.server.cors,
    },
    memory: {
      store: config.memory.store,
      path: config.memory.path,
    },
    extraction: {
      enabled: config.extraction.enabled,
      model: config.extraction.model,
      async: config.extraction.async,
      minConfidence: 0.7, // Default value
      extractFromAssistant: config.extraction.extract_from_assistant,
      dedupWindowSeconds: 300, // Default value: 5 minutes
    },
    embedding: {
      provider: config.embedding.provider as 'ollama' | 'openai',
      model: config.embedding.model,
      dimensions: config.embedding.dimensions,
    },
    retrieval: {
      maxMemories: config.retrieval.max_memories,
      minSimilarity: config.retrieval.min_similarity,
      tokenBudget: config.retrieval.token_budget,
      recencyBoost: config.retrieval.recency_boost,
    },
    routing: {
      classifier: config.routing.classifier,
      defaultModel: config.routing.default_model,
      rules: config.routing.rules.map(rule => ({
        name: rule.match.type || 'unnamed',
        match: {
          complexity: rule.match.complexity as 'low' | 'medium' | 'high' | undefined,
          type: rule.match.type as 'general' | 'code' | 'creative' | 'analysis' | 'chat' | undefined,
          sensitive: rule.match.sensitive,
        },
        model: rule.model,
        priority: 1, // Default priority
      })),
      fallback: undefined,
      agentOverrides: undefined,
    },
    backends: {
      anthropic: config.backends.anthropic ? {
        apiKey: config.backends.anthropic.api_key,
        baseUrl: config.backends.anthropic.base_url,
        defaultParams: {},
      } as InternalProviderConfig : undefined,
      openai: config.backends.openai ? {
        apiKey: config.backends.openai.api_key,
        baseUrl: config.backends.openai.base_url,
        defaultParams: {},
      } as InternalProviderConfig : undefined,
      ollama: {
        baseUrl: config.backends.ollama?.base_url || 'http://localhost:11434',
        defaultParams: {},
      } as OllamaConfig,
    },
    logging: config.logging,
    sunrise: config.sunrise,
  };
}