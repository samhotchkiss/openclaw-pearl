import type { Config } from './types.js';

/**
 * Validate a configuration object
 * Throws descriptive errors for invalid configurations
 */
export function validateConfig(config: Config): void {
  if (!config.server) {
    throw new Error('server section is required');
  }

  if (!config.memory) {
    throw new Error('memory section is required');
  }

  if (!config.extraction) {
    throw new Error('extraction section is required');
  }

  if (!config.embedding) {
    throw new Error('embedding section is required');
  }

  if (!config.retrieval) {
    throw new Error('retrieval section is required');
  }

  if (!config.routing) {
    throw new Error('routing section is required');
  }

  if (!config.backends) {
    throw new Error('backends section is required');
  }

  if (!config.logging) {
    throw new Error('logging section is required');
  }

  validateServer(config.server);
  validateMemory(config.memory);
  validateEmbedding(config.embedding);
  validateRetrieval(config.retrieval);
  validateLogging(config.logging);
}

function validateServer(server: Config['server']): void {
  if (typeof server.port !== 'number' || server.port < 1 || server.port > 65535) {
    throw new Error('server.port must be between 1 and 65535');
  }

  if (typeof server.host !== 'string' || server.host.length === 0) {
    throw new Error('server.host must be a non-empty string');
  }

  if (typeof server.cors !== 'boolean') {
    throw new Error('server.cors must be a boolean');
  }
}

function validateMemory(memory: Config['memory']): void {
  if (memory.store !== 'sqlite') {
    throw new Error('memory.store must be "sqlite"');
  }

  if (typeof memory.path !== 'string' || memory.path.length === 0) {
    throw new Error('memory.path must be a non-empty string');
  }
}

function validateEmbedding(embedding: Config['embedding']): void {
  if (typeof embedding.provider !== 'string' || embedding.provider.length === 0) {
    throw new Error('embedding.provider must be a non-empty string');
  }

  if (typeof embedding.model !== 'string' || embedding.model.length === 0) {
    throw new Error('embedding.model must be a non-empty string');
  }

  if (typeof embedding.dimensions !== 'number' || embedding.dimensions <= 0) {
    throw new Error('embedding.dimensions must be a positive number');
  }
}

function validateRetrieval(retrieval: Config['retrieval']): void {
  if (typeof retrieval.max_memories !== 'number' || retrieval.max_memories <= 0) {
    throw new Error('retrieval.max_memories must be a positive number');
  }

  if (
    typeof retrieval.min_similarity !== 'number' ||
    retrieval.min_similarity < 0 ||
    retrieval.min_similarity > 1
  ) {
    throw new Error('retrieval.min_similarity must be between 0 and 1');
  }

  if (typeof retrieval.token_budget !== 'number' || retrieval.token_budget <= 0) {
    throw new Error('retrieval.token_budget must be a positive number');
  }

  if (typeof retrieval.recency_boost !== 'boolean') {
    throw new Error('retrieval.recency_boost must be a boolean');
  }
}

function validateLogging(logging: Config['logging']): void {
  const validLevels = ['error', 'warn', 'info', 'debug'];
  if (!validLevels.includes(logging.level)) {
    throw new Error(`logging.level must be one of: ${validLevels.join(', ')}`);
  }

  if (typeof logging.file !== 'string' || logging.file.length === 0) {
    throw new Error('logging.file must be a non-empty string');
  }
}