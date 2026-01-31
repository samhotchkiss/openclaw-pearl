import type { Config } from './types.js';

/**
 * Get default configuration for Pearl
 * Returns a deep copy to prevent mutation
 */
export function getDefaults(): Config {
  return {
    server: {
      port: 8080,
      host: '0.0.0.0',
      cors: true,
    },
    memory: {
      store: 'sqlite',
      path: '~/.pearl/memories.db',
    },
    extraction: {
      enabled: true,
      model: 'ollama/llama3.2:3b',
      async: true,
      extract_from_assistant: false,
    },
    embedding: {
      provider: 'ollama',
      model: 'nomic-embed-text',
      dimensions: 768,
    },
    retrieval: {
      max_memories: 10,
      min_similarity: 0.7,
      token_budget: 500,
      recency_boost: true,
    },
    routing: {
      classifier: 'ollama/llama3.2:3b',
      default_model: 'anthropic/claude-sonnet-4-20250514',
      rules: [
        {
          match: { sensitive: true },
          model: 'ollama/llama3.1:70b',
        },
        {
          match: { type: 'code' },
          model: 'anthropic/claude-sonnet-4-20250514',
        },
        {
          match: { complexity: 'low' },
          model: 'anthropic/claude-3-5-haiku-20241022',
        },
      ],
    },
    backends: {
      anthropic: {
        api_key: '${ANTHROPIC_API_KEY}',
      },
      openai: {
        api_key: '${OPENAI_API_KEY}',
      },
      ollama: {
        base_url: 'http://localhost:11434',
      },
    },
    logging: {
      level: 'info',
      file: '~/.pearl/pearl.log',
    },
  };
}