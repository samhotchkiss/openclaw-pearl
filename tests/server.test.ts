import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from '../src/server/index.js';
import type { FastifyInstance } from 'fastify';
import { createTestConfig, mockExternalServices } from './setup/test-helpers.js';

describe('Pearl HTTP Server', () => {
  let server: FastifyInstance;

  beforeEach(() => {
    mockExternalServices();
  });

  beforeAll(async () => {
    const testConfig = createTestConfig();
    server = await createServer({ 
      serverConfig: { port: 0, host: '127.0.0.1' },
      pearlConfig: testConfig 
    });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  describe('GET /v1/health', () => {
    it('returns healthy status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('healthy');
      expect(body.version).toBeDefined();
    });
  });

  describe('POST /v1/chat/completions', () => {
    it('returns a valid OpenAI-format response', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: {
          model: 'pearl',
          messages: [
            { role: 'user', content: 'Hello!' },
          ],
        },
      });

      if (response.statusCode !== 200) {
        console.log('Error response:', response.body);
      }
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Validate OpenAI response format
      expect(body.id).toMatch(/^chatcmpl-/);
      expect(body.object).toBe('chat.completion');
      expect(body.created).toBeTypeOf('number');
      expect(body.model).toBeDefined();
      expect(body.choices).toHaveLength(1);
      expect(body.choices[0].index).toBe(0);
      expect(body.choices[0].message.role).toBe('assistant');
      expect(body.choices[0].message.content).toBeTypeOf('string');
      expect(body.choices[0].finish_reason).toBe('stop');
      expect(body.usage).toBeDefined();
      expect(body.usage.prompt_tokens).toBeTypeOf('number');
      expect(body.usage.completion_tokens).toBeTypeOf('number');
      expect(body.usage.total_tokens).toBeTypeOf('number');
    });

    it('echoes back the user message in mock mode', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: {
          model: 'pearl',
          messages: [
            { role: 'user', content: 'What is 2+2?' },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      // Mock response should acknowledge the message
      expect(body.choices[0].message.content).toContain('mock');
    });

    it('accepts agent metadata', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: {
          model: 'pearl',
          messages: [
            { role: 'user', content: 'Hello!' },
          ],
          metadata: {
            agent_id: 'test-agent',
            session_id: 'test-session',
          },
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('accepts X-Pearl-Agent-Id header', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          'X-Pearl-Agent-Id': 'header-agent',
        },
        payload: {
          model: 'pearl',
          messages: [
            { role: 'user', content: 'Hello!' },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 400 for missing messages', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: {
          model: 'pearl',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.type).toBe('invalid_request_error');
    });

    it('returns 400 for missing model', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: {
          messages: [
            { role: 'user', content: 'Hello!' },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.type).toBe('invalid_request_error');
    });

    it('returns 400 for empty messages array', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: {
          model: 'pearl',
          messages: [],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
    });

    it('returns 400 for invalid message format', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: {
          model: 'pearl',
          messages: [
            { content: 'Missing role' },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
    });
  });

  describe('GET /v1/models', () => {
    it('returns list of available models', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/models',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.object).toBe('list');
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBeGreaterThan(0);
      
      // Should include the pearl model
      const pearlModel = body.data.find((m: { id: string }) => m.id === 'pearl');
      expect(pearlModel).toBeDefined();
      expect(pearlModel.object).toBe('model');
    });
  });

  describe('404 handling', () => {
    it('returns 404 for unknown routes', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/unknown/route',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.type).toBe('not_found_error');
    });
  });
});
