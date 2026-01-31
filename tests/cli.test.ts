/**
 * CLI Tests
 * Tests for the Pearl CLI commands
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { MemoryStore } from '../src/memory/store.js';

// Mock modules - factory must not reference outside variables
vi.mock('../src/server/index.js', () => {
  const mockListen = vi.fn().mockResolvedValue('http://localhost:8080');
  const mockClose = vi.fn().mockResolvedValue(undefined);
  const mockServer = { listen: mockListen, close: mockClose };
  return {
    createServer: vi.fn().mockResolvedValue(mockServer),
  };
});

// Import after mocking
import { runServe } from '../src/cli/serve.js';
import { runMemoryList, runMemoryAdd, runMemoryDelete } from '../src/cli/memory.js';
import { runStats } from '../src/cli/stats.js';
import { createServer } from '../src/server/index.js';

describe('CLI', () => {
  let tempDir: string;
  let configPath: string;
  let dbPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create temp directory for test files
    tempDir = mkdtempSync(join(tmpdir(), 'pearl-cli-test-'));
    dbPath = join(tempDir, 'test.db');
    configPath = join(tempDir, 'pearl.yaml');
    
    // Create test config
    const config = `
server:
  port: 8080
  host: 0.0.0.0

memory:
  store: sqlite
  path: ${dbPath}

extraction:
  enabled: false
  model: ollama/llama3.2:3b
  async: false
  minConfidence: 0.7
  extractFromAssistant: false
  dedupWindowSeconds: 300

embedding:
  provider: ollama
  model: nomic-embed-text
  dimensions: 768

retrieval:
  maxMemories: 10
  minSimilarity: 0.7
  tokenBudget: 500
  recencyBoost: true

routing:
  classifier: ollama/llama3.2:3b
  defaultModel: anthropic/claude-sonnet-4-20250514
  rules: []

backends:
  anthropic:
    apiKey: test-key
`;
    writeFileSync(configPath, config);
  });

  afterEach(() => {
    // Clean up temp directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('serve command', () => {
    it('should start server with config', async () => {
      // runServe will set up signal handlers and not return until shutdown
      // For testing, we just verify it calls createServer correctly
      const servePromise = runServe({ config: configPath });
      
      // Wait for server to start
      await vi.waitFor(() => {
        expect(createServer).toHaveBeenCalled();
      });
      
      // Get the mock server that was created
      const mockServer = await (createServer as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(mockServer.listen).toHaveBeenCalledWith({
        port: 8080,
        host: '0.0.0.0',
      });
    });

    it('should apply CLI port override', async () => {
      const servePromise = runServe({ config: configPath, port: '9090' });
      
      await vi.waitFor(() => {
        expect(createServer).toHaveBeenCalled();
      });
      
      const mockServer = await (createServer as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(mockServer.listen).toHaveBeenCalledWith(
        expect.objectContaining({ port: 9090 })
      );
    });

    it('should apply CLI host override', async () => {
      const servePromise = runServe({ config: configPath, host: '127.0.0.1' });
      
      await vi.waitFor(() => {
        expect(createServer).toHaveBeenCalled();
      });
      
      const mockServer = await (createServer as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(mockServer.listen).toHaveBeenCalledWith(
        expect.objectContaining({ host: '127.0.0.1' })
      );
    });

    it('should use defaults when no config file exists', async () => {
      const servePromise = runServe({ config: '/nonexistent/pearl.yaml' });
      
      await vi.waitFor(() => {
        expect(createServer).toHaveBeenCalled();
      });
      
      const mockServer = await (createServer as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(mockServer.listen).toHaveBeenCalledWith({
        port: 8080,
        host: '0.0.0.0',
      });
    });
  });

  describe('memory commands', () => {
    it('should list memories for an agent', async () => {
      // First add a memory
      const store = new MemoryStore(dbPath);
      store.create({
        agent_id: 'test-agent',
        type: 'fact',
        content: 'Test fact memory',
        tags: ['test'],
      });
      store.close();

      // Mock console.log to capture output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(String(msg));

      try {
        await runMemoryList({
          agent: 'test-agent',
          config: configPath,
        });

        expect(logs.some(l => l.includes('test-agent'))).toBe(true);
        expect(logs.some(l => l.includes('Test fact memory'))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    it('should list memories filtered by type', async () => {
      // Add memories of different types
      const store = new MemoryStore(dbPath);
      store.create({
        agent_id: 'test-agent',
        type: 'fact',
        content: 'Fact memory',
      });
      store.create({
        agent_id: 'test-agent',
        type: 'preference',
        content: 'Preference memory',
      });
      store.close();

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(String(msg));

      try {
        await runMemoryList({
          agent: 'test-agent',
          type: 'fact',
          config: configPath,
        });

        expect(logs.some(l => l.includes('Fact memory'))).toBe(true);
        expect(logs.some(l => l.includes('Preference memory'))).toBe(false);
      } finally {
        console.log = originalLog;
      }
    });

    it('should add a memory', async () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(String(msg));

      try {
        await runMemoryAdd({
          agent: 'test-agent',
          type: 'rule',
          content: 'Always be helpful',
          tags: 'important,rule',
          config: configPath,
        });

        expect(logs.some(l => l.includes('Memory created successfully'))).toBe(true);
        expect(logs.some(l => l.includes('Always be helpful'))).toBe(true);
      } finally {
        console.log = originalLog;
      }

      // Verify memory was created
      const store = new MemoryStore(dbPath);
      const memories = store.query({ agent_id: 'test-agent' });
      store.close();

      expect(memories).toHaveLength(1);
      expect(memories[0].content).toBe('Always be helpful');
      expect(memories[0].type).toBe('rule');
      expect(memories[0].tags).toEqual(['important', 'rule']);
    });

    it('should reject invalid memory type', async () => {
      await expect(
        runMemoryAdd({
          agent: 'test-agent',
          type: 'invalid-type',
          content: 'Test content',
          config: configPath,
        })
      ).rejects.toThrow('Invalid memory type');
    });

    it('should delete a memory', async () => {
      // First add a memory
      const store = new MemoryStore(dbPath);
      const memory = store.create({
        agent_id: 'test-agent',
        type: 'fact',
        content: 'To be deleted',
      });
      store.close();

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(String(msg));

      try {
        await runMemoryDelete(memory.id, { config: configPath });

        expect(logs.some(l => l.includes('deleted successfully'))).toBe(true);
      } finally {
        console.log = originalLog;
      }

      // Verify memory was deleted
      const store2 = new MemoryStore(dbPath);
      const deleted = store2.get(memory.id);
      store2.close();

      expect(deleted).toBeUndefined();
    });

    it('should handle deleting non-existent memory', async () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(String(msg));

      try {
        await runMemoryDelete('non-existent-id', { config: configPath });

        expect(logs.some(l => l.includes('not found'))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    it('should show empty list message when no memories', async () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(String(msg));

      try {
        await runMemoryList({
          agent: 'empty-agent',
          config: configPath,
        });

        expect(logs.some(l => l.includes('No memories found'))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe('stats command', () => {
    it('should display statistics', async () => {
      // Add some memories
      const store = new MemoryStore(dbPath);
      store.create({
        agent_id: 'agent1',
        type: 'fact',
        content: 'Fact 1',
      });
      store.create({
        agent_id: 'agent1',
        type: 'preference',
        content: 'Preference 1',
      });
      store.create({
        agent_id: 'agent2',
        type: 'rule',
        content: 'Rule 1',
      });
      store.close();

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(String(msg));

      try {
        await runStats({ config: configPath });

        expect(logs.some(l => l.includes('Pearl Statistics'))).toBe(true);
        expect(logs.some(l => l.includes('Total Memories: 3'))).toBe(true);
        expect(logs.some(l => l.includes('Total Agents: 2'))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    it('should show empty stats', async () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(String(msg));

      try {
        await runStats({ config: configPath });

        expect(logs.some(l => l.includes('Total Memories: 0'))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe('command registration', () => {
    it('should export all command functions', async () => {
      expect(typeof runServe).toBe('function');
      expect(typeof runMemoryList).toBe('function');
      expect(typeof runMemoryAdd).toBe('function');
      expect(typeof runMemoryDelete).toBe('function');
      expect(typeof runStats).toBe('function');
    });
  });
});
