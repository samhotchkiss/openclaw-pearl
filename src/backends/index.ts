/**
 * Backend Clients Entry Point
 * Exports all backend client implementations
 */

export { AnthropicClient } from './anthropic.js';
export { OpenAIClient } from './openai.js';
export { OllamaClient } from './ollama.js';
export { MockBackend } from './mock.js';

export * from './types.js';

// Factory function to create backend clients
import { AnthropicClient } from './anthropic.js';
import { OpenAIClient } from './openai.js';
import { OllamaClient } from './ollama.js';
import { MockBackend } from './mock.js';
import type { BackendClient } from './types.js';
import type { ProviderConfig } from '../config/types.js';

export function createBackendClient(provider: string, config: ProviderConfig): BackendClient {
  // Convert snake_case config to camelCase for backend clients
  const normalizedConfig = {
    ...config,
    apiKey: config.api_key ?? config.apiKey,
    baseUrl: config.base_url ?? config.baseUrl,
    credentialsFile: (config as any).credentials_file ?? (config as any).credentialsFile,
  };
  
  switch (provider.toLowerCase()) {
    case 'anthropic':
      return new AnthropicClient(normalizedConfig);
    case 'openai':
      return new OpenAIClient(normalizedConfig);
    case 'ollama':
      return new OllamaClient(normalizedConfig);
    case 'mock':
      return new MockBackend();
    default:
      throw new Error(`Unsupported backend provider: ${provider}`);
  }
}

/**
 * Parse model string to extract backend and model name
 * Examples:
 * "anthropic/claude-sonnet-4-20250514" -> { backend: "anthropic", model: "claude-sonnet-4-20250514" }
 * "openai/gpt-4" -> { backend: "openai", model: "gpt-4" }
 * "ollama/llama3.1:70b" -> { backend: "ollama", model: "llama3.1:70b" }
 */
export function parseModelString(modelString: string): { backend: string; model: string } {
  const parts = modelString.split('/');
  if (parts.length < 2) {
    throw new Error(`Invalid model string format: ${modelString}. Expected format: "backend/model"`);
  }
  
  const backend = parts[0];
  const model = parts.slice(1).join('/'); // In case model name contains slashes
  
  return { backend, model };
}