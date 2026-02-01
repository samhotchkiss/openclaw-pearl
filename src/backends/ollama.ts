/**
 * Ollama Backend Client
 * Implements OpenAI-compatible interface for local Ollama models
 */

import type { 
  BackendClient, 
  ChatRequest, 
  ChatChunk, 
  Model, 
  BackendConfig,
  ErrorRetryOptions,
  TokenUsage,
  Message
} from './types.js';
import { 
  BackendError, 
  RateLimitError, 
  AuthenticationError, 
  NetworkError,
  generateRequestId,
  createTimestamp,
  exponentialBackoff,
  normalizeMessages
} from './types.js';

interface OllamaMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface OllamaRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    num_predict?: number; // max_tokens equivalent
    num_ctx?: number; // context length
  };
}

interface OllamaStreamResponse {
  model: string;
  created_at: string;
  message: {
    role: 'assistant';
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaResponse {
  model: string;
  created_at: string;
  message: {
    role: 'assistant';
    content: string;
  };
  done: boolean;
  total_duration: number;
  load_duration: number;
  prompt_eval_count: number;
  prompt_eval_duration: number;
  eval_count: number;
  eval_duration: number;
}

interface OllamaModelsResponse {
  models: Array<{
    name: string;
    model: string;
    modified_at: string;
    size: number;
    digest: string;
    details?: {
      parent_model?: string;
      format?: string;
      family?: string;
      families?: string[];
      parameter_size?: string;
      quantization_level?: string;
    };
  }>;
}

export class OllamaClient implements BackendClient {
  private config: Required<BackendConfig>;
  private retryOptions: ErrorRetryOptions;

  constructor(config: BackendConfig) {
    this.config = {
      apiKey: config.apiKey || '', // Ollama doesn't use API keys but we keep it for consistency
      baseUrl: config.baseUrl || 'http://localhost:11434',
      defaultParams: config.defaultParams || {},
      timeout: config.timeout || 120000, // Longer timeout for local models
      retries: config.retries || 3
    };

    this.retryOptions = {
      maxRetries: this.config.retries,
      baseDelay: 2000, // Longer delay for local models
      maxDelay: 30000,
      backoffFactor: 2
    };
  }

  async *chat(request: ChatRequest): AsyncGenerator<ChatChunk> {
    const ollamaRequest = this.convertToOllamaFormat(request);
    
    let attempt = 0;
    while (attempt <= this.retryOptions.maxRetries) {
      try {
        if (ollamaRequest.stream) {
          yield* this.streamChat(ollamaRequest, request);
        } else {
          yield* this.nonStreamChat(ollamaRequest, request);
        }
        return; // Success, exit retry loop
      } catch (error) {
        if (error instanceof BackendError && error.retryable && attempt < this.retryOptions.maxRetries) {
          await exponentialBackoff(attempt, this.retryOptions);
          attempt++;
          continue;
        }
        throw error;
      }
    }
  }

  private async *streamChat(ollamaRequest: OllamaRequest, originalRequest: ChatRequest): AsyncGenerator<ChatChunk> {
    const response = await this.makeRequest('/api/chat', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(ollamaRequest)
    });

    if (!response.body) {
      throw new BackendError('No response body received', 'NO_BODY');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    let promptTokens = 0;
    let completionTokens = 0;
    const messageId = generateRequestId();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;

          try {
            const streamResponse: OllamaStreamResponse = JSON.parse(line);
            
            if (streamResponse.done) {
              // Final chunk with usage information
              promptTokens = streamResponse.prompt_eval_count || 0;
              completionTokens = streamResponse.eval_count || 0;
              
              const finalChunk: ChatChunk = {
                id: messageId,
                object: 'chat.completion.chunk',
                created: this.parseTimestamp(streamResponse.created_at),
                model: originalRequest.model,
                choices: [{
                  index: 0,
                  delta: {},
                  finishReason: 'stop'
                }],
                usage: {
                  promptTokens,
                  completionTokens,
                  totalTokens: promptTokens + completionTokens
                }
              };
              
              yield finalChunk;
            } else {
              // Content chunk
              const chunk: ChatChunk = {
                id: messageId,
                object: 'chat.completion.chunk',
                created: this.parseTimestamp(streamResponse.created_at),
                model: originalRequest.model,
                choices: [{
                  index: 0,
                  delta: {
                    role: 'assistant',
                    content: streamResponse.message.content
                  },
                  finishReason: null
                }]
              };
              
              yield chunk;
            }
          } catch (parseError) {
            console.warn('Failed to parse Ollama response:', line);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async *nonStreamChat(ollamaRequest: OllamaRequest, originalRequest: ChatRequest): AsyncGenerator<ChatChunk> {
    const response = await this.makeRequest('/api/chat', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ ...ollamaRequest, stream: false })
    });

    const data = await response.json() as OllamaResponse;
    
    if ('error' in data) {
      throw this.handleError(data as any, response.status);
    }

    const usage: TokenUsage = {
      promptTokens: data.prompt_eval_count || 0,
      completionTokens: data.eval_count || 0,
      totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
    };

    const chunk: ChatChunk = {
      id: generateRequestId(),
      object: 'chat.completion.chunk',
      created: this.parseTimestamp(data.created_at),
      model: originalRequest.model,
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          content: data.message.content
        },
        finishReason: 'stop'
      }],
      usage
    };

    yield chunk;
  }

  async models(): Promise<Model[]> {
    try {
      const response = await this.makeRequest('/api/tags', {
        method: 'GET',
        headers: this.getHeaders()
      });

      const data = await response.json() as OllamaModelsResponse;
      
      if ('error' in data) {
        throw this.handleError(data as any, response.status);
      }

      return data.models.map(model => ({
        id: model.name,
        object: 'model',
        created: Math.floor(new Date(model.modified_at).getTime() / 1000),
        ownedBy: 'ollama',
        // Add model details as permissions for compatibility
        permission: [{
          id: model.digest,
          object: 'model_permission',
          created: Math.floor(new Date(model.modified_at).getTime() / 1000),
          allow_create_engine: false,
          allow_sampling: true,
          allow_logprobs: true,
          allow_search_indices: false,
          allow_view: true,
          allow_fine_tuning: false,
          organization: 'ollama',
          group: null,
          is_blocking: false
        }]
      }));
    } catch (error) {
      if (error instanceof BackendError) {
        throw error;
      }
      throw new BackendError(`Failed to fetch models: ${error instanceof Error ? error.message : 'Unknown error'}`, 'MODELS_ERROR');
    }
  }

  async health(): Promise<boolean> {
    try {
      const response = await this.makeRequest('/api/tags', {
        method: 'GET',
        headers: this.getHeaders()
      });

      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  private convertToOllamaFormat(request: ChatRequest): OllamaRequest {
    // Strip 'ollama/' prefix if present
    const model = request.model.startsWith('ollama/') 
      ? request.model.slice(7) 
      : request.model;
    
    const ollamaRequest: OllamaRequest = {
      model,
      messages: normalizeMessages(request.messages) as OllamaMessage[],
      stream: request.stream !== false, // Default to streaming
      options: {
        ...this.config.defaultParams
      }
    };

    if (request.maxTokens !== undefined) {
      ollamaRequest.options!.num_predict = request.maxTokens;
    }

    if (request.temperature !== undefined) {
      ollamaRequest.options!.temperature = request.temperature;
    }

    if (request.topP !== undefined) {
      ollamaRequest.options!.top_p = request.topP;
    }

    return ollamaRequest;
  }

  private async makeRequest(endpoint: string, options: RequestInit): Promise<Response> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}${endpoint}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw this.handleError(errorData, response.status);
      }

      return response;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new NetworkError('Request timeout');
      }
      if (error instanceof BackendError) {
        throw error;
      }
      throw new NetworkError(`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'OpenClaw-Pearl/1.0'
    };

    // Ollama typically doesn't use auth, but if API key is provided, include it
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }

  private handleError(errorData: any, status: number): BackendError {
    const message = errorData.error || errorData.message || 'Unknown error';
    
    switch (status) {
      case 401:
        return new AuthenticationError(message);
      case 404:
        return new BackendError('Model not found or Ollama not running', 'MODEL_NOT_FOUND', status, false);
      case 400:
        return new BackendError(message, 'BAD_REQUEST', status, false);
      case 500:
      case 502:
      case 503:
      case 504:
        return new BackendError(message, 'SERVER_ERROR', status, true);
      default:
        // For Ollama, connection errors are common when service is down
        if (status === 0 || !status) {
          return new NetworkError('Ollama service appears to be down or unreachable');
        }
        return new BackendError(message, 'UNKNOWN_ERROR', status, status >= 500);
    }
  }

  private parseTimestamp(timestamp: string): number {
    try {
      return Math.floor(new Date(timestamp).getTime() / 1000);
    } catch {
      return createTimestamp();
    }
  }
}