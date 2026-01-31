/**
 * Pearl Embedding Service
 * Generates embeddings for semantic memory search
 *
 * Supports multiple providers:
 * - Ollama (default, local) - nomic-embed-text (768 dims)
 * - OpenAI - text-embedding-3-small (1536 dims)
 */

// ====== Types ======

export interface EmbeddingProvider {
  /** Embedding vector dimensions */
  dimensions: number;

  /** Generate embedding for a single text */
  embed(text: string): Promise<Float32Array>;

  /** Generate embeddings for multiple texts (batch) */
  embedBatch(texts: string[]): Promise<Float32Array[]>;
}

export interface EmbeddingProviderConfig {
  provider?: 'ollama' | 'openai';
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  dimensions?: number;
}

interface OllamaEmbeddingResponse {
  embedding: number[];
}

interface OpenAIEmbeddingResponse {
  data: Array<{
    index?: number;
    embedding: number[];
  }>;
}

// ====== Utility Functions ======

/**
 * Calculate cosine similarity between two vectors
 * Returns value between -1 (opposite) and 1 (identical)
 */
export function cosineSimilarity(
  a: Float32Array | number[],
  b: Float32Array | number[]
): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);

  // Handle zero vectors
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

// ====== Ollama Provider ======

export interface OllamaProviderConfig {
  baseUrl?: string;
  model?: string;
  dimensions?: number;
}

/**
 * Ollama embedding provider
 * Uses local Ollama instance for embeddings (privacy-first)
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private baseUrl: string;
  private model: string;

  constructor(config: OllamaProviderConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
    this.model = config.model ?? 'nomic-embed-text';
    this.dimensions = config.dimensions ?? 768; // nomic-embed-text default
  }

  async embed(text: string): Promise<Float32Array> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = (await response.json()) as OllamaEmbeddingResponse;
    return new Float32Array(data.embedding);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    // Ollama doesn't have native batch support, so we call embed() for each
    // Could be parallelized with Promise.all for better performance
    return Promise.all(texts.map((text) => this.embed(text)));
  }
}

// ====== OpenAI Provider ======

export interface OpenAIProviderConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  dimensions?: number;
}

/**
 * OpenAI embedding provider
 * Uses OpenAI API for embeddings
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(config: OpenAIProviderConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.apiKey = config.apiKey;
    this.model = config.model ?? 'text-embedding-3-small';
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
    this.dimensions = config.dimensions ?? 1536; // text-embedding-3-small default
  }

  async embed(text: string): Promise<Float32Array> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = (await response.json()) as OpenAIEmbeddingResponse;
    return new Float32Array(data.data[0].embedding);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) {
      return [];
    }

    // OpenAI supports batch embeddings in a single request
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = (await response.json()) as OpenAIEmbeddingResponse;

    // Sort by index to ensure correct order (OpenAI may return out of order)
    const sorted = [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    return sorted.map((item) => new Float32Array(item.embedding));
  }
}

// ====== Provider Factory ======

/**
 * Create an embedding provider from config
 */
export function createEmbeddingProvider(
  config: EmbeddingProviderConfig
): EmbeddingProvider {
  switch (config.provider) {
    case 'openai':
      if (!config.apiKey) {
        throw new Error('OpenAI API key is required');
      }
      return new OpenAIEmbeddingProvider({
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
        dimensions: config.dimensions,
      });

    case 'ollama':
    default:
      return new OllamaEmbeddingProvider({
        baseUrl: config.baseUrl,
        model: config.model,
        dimensions: config.dimensions,
      });
  }
}

// ====== Embedding Service ======

/**
 * High-level embedding service
 * Wraps providers with consistent interface
 */
export class EmbeddingService {
  private provider: EmbeddingProvider;

  constructor(config: EmbeddingProviderConfig = {}, provider?: EmbeddingProvider) {
    this.provider = provider ?? createEmbeddingProvider(config);
  }

  /**
   * Generate embedding for a single text
   * @param text Text to embed
   * @returns Float32Array embedding vector
   */
  async embed(text: string): Promise<Float32Array> {
    return this.provider.embed(text);
  }

  /**
   * Generate embeddings for multiple texts
   * @param texts Array of texts to embed
   * @returns Array of Float32Array embedding vectors
   */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) {
      return [];
    }
    return this.provider.embedBatch(texts);
  }

  /**
   * Get embedding vector dimensions
   */
  getDimensions(): number {
    return this.provider.dimensions;
  }
}
