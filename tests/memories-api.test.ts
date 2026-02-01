/**
 * Memory API Tests - TDD for /v1/memories endpoints
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer } from '../src/server.js';
import type { PearlConfig, ScoredMemory } from '../src/types.js';
import { createTestConfig, mockExternalServices } from './setup/test-helpers.js';

// Import integration setup for comprehensive mocking
import './integration-setup.js';

describe('Memory API Endpoints', () => {
  let server: any;
  let baseUrl: string;

  beforeEach(async () => {
    mockExternalServices();
    
    const config = createTestConfig();
    // Override port for this test
    config.server.port = 8081;
    
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
    it('should return empty memories list for new agent', async () => {
      const response = await fetch(`${baseUrl}/v1/memories?agent=test-agent`);
      
      // Debug: Print response body 
      const responseBody = await response.text();
      console.log('Response status:', response.status);
      console.log('Response status:', response.status);
      console.log('Response body:', responseBody);
      
      if (response.status !== 200) {
        console.log('Error response details:', responseBody);
      }
      
      expect(response.status).toBe(200);
      
      const data = JSON.parse(responseBody);
      expect(data).toMatchObject({
        memories: [],
        total: 0,
        offset: 0,
        limit: 50,
      });
    });

    it('should support pagination parameters', async () => {
      const response = await fetch(`${baseUrl}/v1/memories?agent=test-agent&limit=20&offset=10`);
      
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.limit).toBe(20);
      expect(data.offset).toBe(10);
    });

    it('should require agent parameter', async () => {
      const response = await fetch(`${baseUrl}/v1/memories`);
      
      expect(response.status).toBe(400);
      
      const error = await response.json();
      expect(error.error).toContain('agent');
    });

    it('should support search filtering', async () => {
      const response = await fetch(`${baseUrl}/v1/memories?agent=test-agent&search=pizza`);
      
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.memories).toEqual([]);
    });

    it('should return memories with proper structure', async () => {
      // First add a memory, then retrieve it
      await fetch(`${baseUrl}/v1/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: 'test-agent',
          content: 'User likes pizza',
          type: 'preference',
          tags: ['food', 'pizza']
        })
      });

      const response = await fetch(`${baseUrl}/v1/memories?agent=test-agent`);
      const data = await response.json();

      expect(data.memories).toHaveLength(1);
      expect(data.memories[0]).toMatchObject({
        id: expect.any(String),
        content: 'User likes pizza',
        type: 'preference',
        tags: ['food', 'pizza'],
        agentId: 'test-agent',
        createdAt: expect.any(String),
        score: expect.any(Number),
      });
    });
  });

  describe('POST /v1/memories', () => {
    it('should create a new memory successfully', async () => {
      const memoryData = {
        agent: 'test-agent',
        content: 'User prefers dark theme',
        type: 'preference',
        tags: ['ui', 'theme']
      };

      const response = await fetch(`${baseUrl}/v1/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(memoryData)
      });

      expect(response.status).toBe(201);

      const result = await response.json();
      expect(result).toMatchObject({
        id: expect.any(String),
        created: expect.any(String),
        agent: 'test-agent',
        content: 'User prefers dark theme',
        type: 'preference',
      });
    });

    it('should require all mandatory fields', async () => {
      const response = await fetch(`${baseUrl}/v1/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: 'test-agent',
          // Missing content
          type: 'fact'
        })
      });

      expect(response.status).toBe(400);

      const error = await response.json();
      expect(error.error).toContain('content');
    });

    it('should validate memory type', async () => {
      const response = await fetch(`${baseUrl}/v1/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: 'test-agent',
          content: 'Some content',
          type: 'invalid-type'
        })
      });

      expect(response.status).toBe(400);

      const error = await response.json();
      expect(error.error).toContain('type');
    });

    it('should handle malformed JSON', async () => {
      const response = await fetch(`${baseUrl}/v1/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ invalid json'
      });

      expect(response.status).toBe(400);

      const error = await response.json();
      expect(error.error).toContain('JSON');
    });
  });

  describe('DELETE /v1/memories/:id', () => {
    it('should delete an existing memory', async () => {
      // First create a memory
      const createResponse = await fetch(`${baseUrl}/v1/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: 'test-agent',
          content: 'Temporary memory',
          type: 'fact'
        })
      });

      const created = await createResponse.json();
      const memoryId = created.id;

      // Now delete it
      const deleteResponse = await fetch(`${baseUrl}/v1/memories/${memoryId}`, {
        method: 'DELETE'
      });

      expect(deleteResponse.status).toBe(200);

      const result = await deleteResponse.json();
      expect(result).toMatchObject({
        deleted: true,
        id: memoryId,
      });
    });

    it('should return 404 for non-existent memory', async () => {
      const response = await fetch(`${baseUrl}/v1/memories/non-existent-id`, {
        method: 'DELETE'
      });

      expect(response.status).toBe(404);

      const error = await response.json();
      expect(error.error).toContain('not found');
    });

    it('should verify memory is actually deleted', async () => {
      // Create, delete, then verify deletion
      const createResponse = await fetch(`${baseUrl}/v1/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: 'test-agent',
          content: 'Will be deleted',
          type: 'fact'
        })
      });

      const created = await createResponse.json();
      
      // Delete
      await fetch(`${baseUrl}/v1/memories/${created.id}`, { method: 'DELETE' });

      // Verify it's gone
      const listResponse = await fetch(`${baseUrl}/v1/memories?agent=test-agent`);
      const data = await listResponse.json();
      
      expect(data.memories).not.toContain(
        expect.objectContaining({ id: created.id })
      );
    });
  });

  describe('Agent Isolation', () => {
    it('should isolate memories between different agents', async () => {
      // Create memory for agent A
      await fetch(`${baseUrl}/v1/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: 'agent-a',
          content: 'Agent A memory',
          type: 'fact'
        })
      });

      // Create memory for agent B
      await fetch(`${baseUrl}/v1/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: 'agent-b',
          content: 'Agent B memory',
          type: 'fact'
        })
      });

      // Agent A should only see their own memory
      const responseA = await fetch(`${baseUrl}/v1/memories?agent=agent-a`);
      const dataA = await responseA.json();
      
      expect(dataA.memories).toHaveLength(1);
      expect(dataA.memories[0].content).toBe('Agent A memory');

      // Agent B should only see their own memory
      const responseB = await fetch(`${baseUrl}/v1/memories?agent=agent-b`);
      const dataB = await responseB.json();
      
      expect(dataB.memories).toHaveLength(1);
      expect(dataB.memories[0].content).toBe('Agent B memory');
    });
  });
});