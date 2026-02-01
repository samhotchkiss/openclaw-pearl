// Debug memory API test
import { createServer } from './src/server.js';

const createTestConfig = () => ({
  server: {
    port: 8081,
    host: '127.0.0.1',
  },
  memory: {
    store: 'sqlite',
    path: ':memory:',
  },
  extraction: {
    enabled: false,
    model: 'ollama/llama3.2:3b',
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
    minSimilarity: 0.7,
    tokenBudget: 500,
    recencyBoost: true,
  },
  routing: {
    classifier: 'ollama/llama3.2:3b',
    defaultModel: 'anthropic/claude-sonnet-4-20250514',
    rules: [],
  },
  backends: {
    anthropic: {
      api_key: 'test-key',
    },
    openai: {
      api_key: 'test-key',
    },
  },
  logging: {
    level: 'debug',
  },
});

async function debug() {
  try {
    const config = createTestConfig();
    console.log('Creating server...');
    const server = await createServer({ pearlConfig: config });
    
    console.log('Starting server...');
    await server.listen({ port: 8081, host: '127.0.0.1' });
    console.log('Server started on http://127.0.0.1:8081');
    
    console.log('Making test request...');
    const response = await fetch('http://127.0.0.1:8081/v1/memories?agent=test-agent');
    
    console.log('Status:', response.status);
    console.log('Headers:', response.headers);
    
    const text = await response.text();
    console.log('Response body:', text);
    
    await server.close();
    console.log('Server closed');
  } catch (error) {
    console.error('Debug error:', error);
  }
}

debug();