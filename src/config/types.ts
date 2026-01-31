/**
 * Configuration types for Pearl
 */

export interface ServerConfig {
  port: number;
  host: string;
  cors: boolean;
}

export interface MemoryConfig {
  store: 'sqlite';
  path: string;
}

export interface ExtractionConfig {
  enabled: boolean;
  model: string;
  async: boolean;
  extract_from_assistant: boolean;
}

export interface EmbeddingConfig {
  provider: string;
  model: string;
  dimensions: number;
}

export interface RetrievalConfig {
  max_memories: number;
  min_similarity: number;
  token_budget: number;
  recency_boost: boolean;
}

export interface RoutingMatch {
  sensitive?: boolean;
  type?: string;
  complexity?: string;
  [key: string]: any;
}

export interface RoutingRule {
  match: RoutingMatch;
  model: string;
}

export interface RoutingConfig {
  classifier: string;
  default_model: string;
  rules: RoutingRule[];
}

export interface BackendConfig {
  api_key?: string;
  base_url?: string;
  [key: string]: any;
}

export interface BackendsConfig {
  anthropic: BackendConfig;
  openai: BackendConfig;
  ollama: BackendConfig;
  [key: string]: BackendConfig;
}

export interface LoggingConfig {
  level: 'error' | 'warn' | 'info' | 'debug';
  file: string;
}

export interface Config {
  server: ServerConfig;
  memory: MemoryConfig;
  extraction: ExtractionConfig;
  embedding: EmbeddingConfig;
  retrieval: RetrievalConfig;
  routing: RoutingConfig;
  backends: BackendsConfig;
  logging: LoggingConfig;
}