/**
 * Memory API Endpoints Tests
 * Simple test without vitest compatibility issues
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../../src/server.js';
import type { PearlConfig } from '../../src/types.js';

/**
 * Create test config for memory API tests
 */
function createMemoryApiConfig(): PearlConfig {
  return {
    server: { port: 8081, host: '127.0.0.1', cors: true },
    memory: { store: 'sqlite', path: ':memory:' },
    extraction: {
      enabled: false, // Disable for API tests
      model: 'mock/test-model',
      async: false,
      minConfidence: 0.7,
      extractFromAssistant: false,
      dedupWindowSeconds: 300,
    },
    embedding: {
      provider: 'ollama',
      model: 'nomic-embed-text', 
      dimensions: 768,
    },
    retrieval: {
      maxMemories: 10,
      minSimilarity: 0.5,
      tokenBudget: 500,
      recencyBoost: true,
    },
    routing: {
      classifier: 'mock/test-model',
      defaultModel: 'mock/test-model',
      rules: [{
        name: 'default',
        match: { default: true },
        model: 'mock/test-model',
        priority: 1,
      }],
    },
    backends: {
      mock: { enabled: true }, // Enable mock backend for testing
    },
    logging: { level: 'error', file: '/dev/null' },
  };
}

describe('Memory API Endpoints', () => {
  let server: any;
  let baseUrl: string;

  beforeEach(async () => {
    const config = createMemoryApiConfig();
    
    server = await createServer({ pearlConfig: config });
    await server.listen({ port: 8081, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:8081`;
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  describe('GET /v1/memories', () => {
    it('should require agent parameter', async () => {
      const response = await fetch(`${baseUrl}/v1/memories`);
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.error).toContain('Missing required parameter: agent');
    });

    it('should return empty list for new agent', async () => {
      const response = await fetch(`${baseUrl}/v1/memories?agent=test-agent`);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.memories).toEqual([]);
      expect(data.total).toBe(0);
    });
  });

  describe('POST /v1/memories', () => {
    it('should require agent field', async () => {
      const response = await fetch(`${baseUrl}/v1/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Test memory' }),
      });
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.error).toContain('Missing required field: agent');
    });

    it('should require content field', async () => {
      const response = await fetch(`${baseUrl}/v1/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'test-agent' }),
      });
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.error).toContain('Missing required field: content');
    });

    it('should create memory with valid data', async () => {
      const response = await fetch(`${baseUrl}/v1/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: 'test-agent',
          content: 'User prefers coffee over tea',
          type: 'preference',
          tags: ['drinks', 'preference'],
        }),
      });
      
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.id).toBeDefined();
      expect(data.agent).toBe('test-agent');
      expect(data.content).toBe('User prefers coffee over tea');
      expect(data.type).toBe('preference');
    });
  });

  describe('DELETE /v1/memories/:id', () => {
    it('should return 404 for non-existent memory', async () => {
      const response = await fetch(`${baseUrl}/v1/memories/non-existent-id`, {
        method: 'DELETE',
      });
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.error).toContain('Memory not found');
    });
  });
});