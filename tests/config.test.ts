import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { loadConfig } from '../src/config/loader.js';
import { getDefaults } from '../src/config/defaults.js';
import { validateConfig } from '../src/config/validate.js';
import type { Config } from '../src/config/types.js';

const TEST_CONFIG_DIR = '/tmp/pearl-test-config';
const TEST_CONFIG_PATH = `${TEST_CONFIG_DIR}/pearl.yaml`;

describe('Config System', () => {
  // Store original environment variables to restore after tests
  let originalEnvVars: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Clean up any existing test config
    if (existsSync(TEST_CONFIG_DIR)) {
      rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    
    // Store original environment variables
    originalEnvVars = {
      TEST_API_KEY: process.env.TEST_API_KEY,
      PEARL_PORT: process.env.PEARL_PORT,
      PEARL_HOST: process.env.PEARL_HOST,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    };
    
    // Clear environment variables for clean test environment
    delete process.env.TEST_API_KEY;
    delete process.env.PEARL_PORT;
    delete process.env.PEARL_HOST;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(TEST_CONFIG_DIR)) {
      rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    }
    
    // Restore original environment variables
    Object.entries(originalEnvVars).forEach(([key, value]) => {
      if (value !== undefined) {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    });
  });

  describe('getDefaults()', () => {
    it('returns complete default configuration', () => {
      const defaults = getDefaults();

      expect(defaults).toEqual({
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
        sunrise: {
          enabled: false,
          transcriptPath: '~/.pearl/transcripts',
          model: 'ollama/llama3.2:3b',
          gapThresholdMs: 3600000,
          lookbackMs: 7200000,
          maxMessages: 100,
          minMessages: 2,
        },
      });
    });

    it('returns immutable config', () => {
      const defaults1 = getDefaults();
      const defaults2 = getDefaults();

      // Modify one copy
      defaults1.server.port = 9999;
      
      // Other copy should be unchanged
      expect(defaults2.server.port).toBe(8080);
    });
  });

  describe('validateConfig()', () => {
    it('validates valid config', () => {
      const config = getDefaults();
      
      expect(() => validateConfig(config)).not.toThrow();
    });

    it('throws for missing required sections', () => {
      const config = {} as Config;
      
      expect(() => validateConfig(config)).toThrow(/server.*required/i);
    });

    it('throws for invalid server port', () => {
      const config = getDefaults();
      config.server.port = -1;
      
      expect(() => validateConfig(config)).toThrow(/port.*between/i);
    });

    it('throws for invalid server port (too high)', () => {
      const config = getDefaults();
      config.server.port = 70000;
      
      expect(() => validateConfig(config)).toThrow(/port.*between/i);
    });

    it('validates valid server port', () => {
      const config = getDefaults();
      config.server.port = 3000;
      
      expect(() => validateConfig(config)).not.toThrow();
    });

    it('throws for invalid memory store type', () => {
      const config = getDefaults();
      config.memory.store = 'invalid' as any;
      
      expect(() => validateConfig(config)).toThrow(/store.*must be.*sqlite/i);
    });

    it('throws for invalid embedding dimensions', () => {
      const config = getDefaults();
      config.embedding.dimensions = 0;
      
      expect(() => validateConfig(config)).toThrow(/dimensions.*positive/i);
    });

    it('throws for invalid retrieval max_memories', () => {
      const config = getDefaults();
      config.retrieval.max_memories = -1;
      
      expect(() => validateConfig(config)).toThrow(/max_memories.*positive/i);
    });

    it('throws for invalid retrieval min_similarity', () => {
      const config = getDefaults();
      config.retrieval.min_similarity = 1.5;
      
      expect(() => validateConfig(config)).toThrow(/min_similarity.*between/i);
    });

    it('throws for invalid retrieval token_budget', () => {
      const config = getDefaults();
      config.retrieval.token_budget = 0;
      
      expect(() => validateConfig(config)).toThrow(/token_budget.*positive/i);
    });

    it('throws for invalid logging level', () => {
      const config = getDefaults();
      config.logging.level = 'invalid' as any;
      
      expect(() => validateConfig(config)).toThrow(/level.*must be one of/i);
    });

    it('validates all logging levels', () => {
      const config = getDefaults();
      const levels = ['error', 'warn', 'info', 'debug'];
      
      for (const level of levels) {
        config.logging.level = level as any;
        expect(() => validateConfig(config)).not.toThrow();
      }
    });
  });

  describe('loadConfig()', () => {
    it('loads default config when no file exists', async () => {
      const config = await loadConfig();
      const defaults = getDefaults();
      
      expect(config).toEqual(defaults);
    });

    it('loads config from default path pearl.yaml', async () => {
      const configData = `
server:
  port: 3000
  host: localhost
memory:
  path: /custom/path/memories.db
`;
      writeFileSync('pearl.yaml', configData);

      try {
        const config = await loadConfig();
        
        expect(config.server.port).toBe(3000);
        expect(config.server.host).toBe('localhost');
        expect(config.server.cors).toBe(true); // Default preserved
        expect(config.memory.path).toBe('/custom/path/memories.db');
        expect(config.memory.store).toBe('sqlite'); // Default preserved
      } finally {
        unlinkSync('pearl.yaml');
      }
    });

    it('loads config from specified path', async () => {
      const configData = `
server:
  port: 4000
logging:
  level: debug
`;
      writeFileSync(TEST_CONFIG_PATH, configData);

      const config = await loadConfig(TEST_CONFIG_PATH);
      
      expect(config.server.port).toBe(4000);
      expect(config.logging.level).toBe('debug');
      expect(config.server.host).toBe('0.0.0.0'); // Default preserved
    });

    it('performs environment variable substitution', async () => {
      process.env.TEST_API_KEY = 'sk-test-123';
      process.env.PEARL_PORT = '5000';
      process.env.PEARL_HOST = 'example.com';

      const configData = `
server:
  port: \${PEARL_PORT}
  host: \${PEARL_HOST}
backends:
  anthropic:
    api_key: \${TEST_API_KEY}
  openai:
    api_key: \${OPENAI_API_KEY:-default-key}
`;
      writeFileSync(TEST_CONFIG_PATH, configData);

      const config = await loadConfig(TEST_CONFIG_PATH);
      
      expect(config.server.port).toBe(5000);
      expect(config.server.host).toBe('example.com');
      expect(config.backends.anthropic.api_key).toBe('sk-test-123');
      expect(config.backends.openai.api_key).toBe('default-key'); // Default value
    });

    it('handles missing environment variables', async () => {
      const configData = `
backends:
  anthropic:
    api_key: \${MISSING_VAR}
`;
      writeFileSync(TEST_CONFIG_PATH, configData);

      const config = await loadConfig(TEST_CONFIG_PATH);
      
      // Should keep the placeholder when env var is missing
      expect(config.backends.anthropic.api_key).toBe('${MISSING_VAR}');
    });

    it('handles environment variables with default values', async () => {
      const configData = `
backends:
  anthropic:
    api_key: \${ANTHROPIC_API_KEY:-fallback-key}
  openai:
    api_key: \${OPENAI_API_KEY:-}
`;
      writeFileSync(TEST_CONFIG_PATH, configData);

      const config = await loadConfig(TEST_CONFIG_PATH);
      
      expect(config.backends.anthropic.api_key).toBe('fallback-key');
      expect(config.backends.openai.api_key).toBe(''); // Empty default
    });

    it('performs deep merge with defaults', async () => {
      const configData = `
server:
  port: 3000
  # host not specified, should use default
retrieval:
  max_memories: 20
  # other retrieval settings should use defaults
backends:
  anthropic:
    api_key: custom-key
    # other backends should use defaults
`;
      writeFileSync(TEST_CONFIG_PATH, configData);

      const config = await loadConfig(TEST_CONFIG_PATH);
      
      expect(config.server.port).toBe(3000);
      expect(config.server.host).toBe('0.0.0.0'); // Default
      expect(config.server.cors).toBe(true); // Default
      expect(config.retrieval.max_memories).toBe(20);
      expect(config.retrieval.min_similarity).toBe(0.7); // Default
      expect(config.retrieval.token_budget).toBe(500); // Default
      expect(config.backends.anthropic.api_key).toBe('custom-key');
      expect(config.backends.openai.api_key).toBe('${OPENAI_API_KEY}'); // Default
    });

    it('validates loaded config', async () => {
      const configData = `
server:
  port: -1  # Invalid port
`;
      writeFileSync(TEST_CONFIG_PATH, configData);

      await expect(loadConfig(TEST_CONFIG_PATH)).rejects.toThrow(/port.*between/i);
    });

    it('throws for invalid YAML syntax', async () => {
      const configData = `
server:
  port: 3000
  invalid yaml: [
`;
      writeFileSync(TEST_CONFIG_PATH, configData);

      await expect(loadConfig(TEST_CONFIG_PATH)).rejects.toThrow();
    });

    it('handles empty config file', async () => {
      writeFileSync(TEST_CONFIG_PATH, '');

      const config = await loadConfig(TEST_CONFIG_PATH);
      const defaults = getDefaults();
      
      expect(config).toEqual(defaults);
    });

    it('handles config file with only comments', async () => {
      const configData = `
# This is a comment
# server:
#   port: 3000
`;
      writeFileSync(TEST_CONFIG_PATH, configData);

      const config = await loadConfig(TEST_CONFIG_PATH);
      const defaults = getDefaults();
      
      expect(config).toEqual(defaults);
    });

    it('supports numeric environment variable substitution', async () => {
      process.env.PEARL_PORT = '8888';
      process.env.MAX_MEMORIES = '50';

      const configData = `
server:
  port: \${PEARL_PORT}
retrieval:
  max_memories: \${MAX_MEMORIES}
`;
      writeFileSync(TEST_CONFIG_PATH, configData);

      const config = await loadConfig(TEST_CONFIG_PATH);
      
      expect(config.server.port).toBe(8888);
      expect(config.retrieval.max_memories).toBe(50);
    });

    it('supports boolean environment variable substitution', async () => {
      process.env.ENABLE_CORS = 'false';
      process.env.ASYNC_EXTRACTION = 'true';

      const configData = `
server:
  cors: \${ENABLE_CORS}
extraction:
  async: \${ASYNC_EXTRACTION}
`;
      writeFileSync(TEST_CONFIG_PATH, configData);

      const config = await loadConfig(TEST_CONFIG_PATH);
      
      expect(config.server.cors).toBe(false);
      expect(config.extraction.async).toBe(true);
    });

    it('handles complex routing rules from config', async () => {
      const configData = `
routing:
  classifier: custom/classifier
  default_model: custom/default
  rules:
    - match: { sensitive: true, type: code }
      model: local/secure-model
    - match: { complexity: high }
      model: anthropic/claude-opus
`;
      writeFileSync(TEST_CONFIG_PATH, configData);

      const config = await loadConfig(TEST_CONFIG_PATH);
      
      expect(config.routing.classifier).toBe('custom/classifier');
      expect(config.routing.default_model).toBe('custom/default');
      expect(config.routing.rules).toEqual([
        { match: { sensitive: true, type: 'code' }, model: 'local/secure-model' },
        { match: { complexity: 'high' }, model: 'anthropic/claude-opus' },
      ]);
    });
  });

  describe('tilde expansion', () => {
    it('expands ~ in memory path', async () => {
      const configData = `
memory:
  path: ~/custom/pearl/memories.db
logging:
  file: ~/logs/pearl.log
`;
      writeFileSync(TEST_CONFIG_PATH, configData);

      const config = await loadConfig(TEST_CONFIG_PATH);
      
      expect(config.memory.path).toMatch(/^\/.*\/custom\/pearl\/memories\.db$/);
      expect(config.logging.file).toMatch(/^\/.*\/logs\/pearl\.log$/);
      expect(config.memory.path).not.toContain('~');
      expect(config.logging.file).not.toContain('~');
    });
  });

  describe('error handling', () => {
    it('provides meaningful error for file not found', async () => {
      await expect(loadConfig('/non/existent/config.yaml')).rejects.toThrow(/ENOENT/);
    });

    it('returns defaults when default path does not exist', async () => {
      // When no path specified and pearl.yaml doesn't exist, should return defaults
      const config = await loadConfig();
      const defaults = getDefaults();
      expect(config).toEqual(defaults);
    });

    it('provides meaningful error for permission denied', async () => {
      // This test might be platform-specific, skip if not applicable
      const restrictedPath = '/root/config.yaml';
      if (process.getuid && process.getuid() !== 0) {
        await expect(loadConfig(restrictedPath)).rejects.toThrow();
      }
    });
  });
});