/**
 * OpenAI Backend Client
 * Native OpenAI-compatible interface
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

interface OpenAIRequest {
  model: string;
  messages: Message[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  user?: string;
}

interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIModelsResponse {
  object: string;
  data: Model[];
}

export class OpenAIClient implements BackendClient {
  private config: Required<BackendConfig>;
  private retryOptions: ErrorRetryOptions;

  constructor(config: BackendConfig) {
    this.config = {
      apiKey: config.apiKey || '',
      baseUrl: config.baseUrl || 'https://api.openai.com/v1',
      defaultParams: config.defaultParams || {},
      timeout: config.timeout || 30000,
      retries: config.retries || 3
    };

    this.retryOptions = {
      maxRetries: this.config.retries,
      baseDelay: 1000,
      maxDelay: 10000,
      backoffFactor: 2
    };

    if (!this.config.apiKey) {
      throw new Error('OpenAI API key is required');
    }
  }

  async *chat(request: ChatRequest): AsyncGenerator<ChatChunk> {
    const openaiRequest = this.convertToOpenAIFormat(request);
    
    let attempt = 0;
    while (attempt <= this.retryOptions.maxRetries) {
      try {
        if (openaiRequest.stream) {
          yield* this.streamChat(openaiRequest, request);
        } else {
          yield* this.nonStreamChat(openaiRequest, request);
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

  private async *streamChat(openaiRequest: OpenAIRequest, originalRequest: ChatRequest): AsyncGenerator<ChatChunk> {
    const response = await this.makeRequest('/chat/completions', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(openaiRequest)
    });

    if (!response.body) {
      throw new BackendError('No response body received', 'NO_BODY');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const chunk: OpenAIStreamChunk = JSON.parse(data);
              
              // Convert to our standard format
              const standardChunk: ChatChunk = {
                id: chunk.id,
                object: chunk.object,
                created: chunk.created,
                model: originalRequest.model,
                choices: chunk.choices.map(choice => ({
                  index: choice.index,
                  delta: choice.delta,
                  finishReason: this.mapFinishReason(choice.finish_reason)
                })),
                usage: chunk.usage ? {
                  promptTokens: chunk.usage.prompt_tokens,
                  completionTokens: chunk.usage.completion_tokens,
                  totalTokens: chunk.usage.total_tokens
                } : undefined
              };
              
              yield standardChunk;
            } catch (parseError) {
              console.warn('Failed to parse OpenAI chunk:', data);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async *nonStreamChat(openaiRequest: OpenAIRequest, originalRequest: ChatRequest): AsyncGenerator<ChatChunk> {
    const response = await this.makeRequest('/chat/completions', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ ...openaiRequest, stream: false })
    });

    const data = await response.json() as OpenAIResponse;
    
    if ('error' in data) {
      throw this.handleError(data as any, response.status);
    }

    const usage: TokenUsage = {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens
    };

    const content = data.choices[0]?.message?.content || '';

    const chunk: ChatChunk = {
      id: data.id,
      object: 'chat.completion.chunk',
      created: data.created,
      model: originalRequest.model,
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          content: content
        },
        finishReason: this.mapFinishReason(data.choices[0]?.finish_reason)
      }],
      usage
    };

    yield chunk;
  }

  async models(): Promise<Model[]> {
    try {
      const response = await this.makeRequest('/models', {
        method: 'GET',
        headers: this.getHeaders()
      });

      const data = await response.json() as OpenAIModelsResponse;
      
      if ('error' in data) {
        throw this.handleError(data as any, response.status);
      }

      return data.data.sort((a, b) => b.created - a.created); // Sort by newest first
    } catch (error) {
      if (error instanceof BackendError) {
        throw error;
      }
      throw new BackendError(`Failed to fetch models: ${error instanceof Error ? error.message : 'Unknown error'}`, 'MODELS_ERROR');
    }
  }

  async health(): Promise<boolean> {
    try {
      // Use models endpoint as a simple health check
      const response = await this.makeRequest('/models', {
        method: 'GET',
        headers: this.getHeaders()
      });

      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  private convertToOpenAIFormat(request: ChatRequest): OpenAIRequest {
    const openaiRequest: OpenAIRequest = {
      model: request.model,
      messages: normalizeMessages(request.messages),
      stream: request.stream !== false, // Default to streaming
      ...this.config.defaultParams
    };

    if (request.maxTokens !== undefined) {
      openaiRequest.max_tokens = request.maxTokens;
    }

    if (request.temperature !== undefined) {
      openaiRequest.temperature = request.temperature;
    }

    if (request.topP !== undefined) {
      openaiRequest.top_p = request.topP;
    }

    // Add user ID if provided in metadata
    if (request.metadata?.agentId) {
      openaiRequest.user = request.metadata.agentId;
    }

    return openaiRequest;
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
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
      'User-Agent': 'OpenClaw-Pearl/1.0'
    };
  }

  private handleError(errorData: any, status: number): BackendError {
    const message = errorData.error?.message || errorData.message || 'Unknown error';
    const code = errorData.error?.code || 'unknown';
    
    switch (status) {
      case 401:
        return new AuthenticationError(message);
      case 429:
        const retryAfter = errorData.error?.retry_after;
        return new RateLimitError(message, retryAfter);
      case 400:
      case 403:
      case 404:
        return new BackendError(message, code.toUpperCase(), status, false);
      case 500:
      case 502:
      case 503:
      case 504:
        return new BackendError(message, 'SERVER_ERROR', status, true);
      default:
        return new BackendError(message, 'UNKNOWN_ERROR', status, status >= 500);
    }
  }

  private mapFinishReason(reason: string | null | undefined): 'stop' | 'length' | 'content_filter' | null {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
      case 'max_tokens':
        return 'length';
      case 'content_filter':
        return 'content_filter';
      default:
        return null;
    }
  }
}