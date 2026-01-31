/**
 * Anthropic Claude Backend Client
 * Implements OpenAI-compatible interface for Anthropic's Claude API
 */

import type { 
  BackendClient, 
  ChatRequest, 
  ChatChunk, 
  Model, 
  BackendConfig,
  ErrorRetryOptions,
  TokenUsage
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

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  system?: string;
}

interface AnthropicStreamEvent {
  type: 'message_start' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop';
  message?: {
    id: string;
    type: 'message';
    role: 'assistant';
    content: any[];
    model: string;
    stop_reason: string | null;
    stop_sequence: string | null;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
  content_block?: {
    type: 'text';
    text: string;
  };
  delta?: {
    type: 'text_delta';
    text: string;
    stop_reason?: string;
    stop_sequence?: string | null;
  };
  index?: number;
  usage?: {
    output_tokens: number;
  };
}

export class AnthropicClient implements BackendClient {
  private config: Required<BackendConfig>;
  private retryOptions: ErrorRetryOptions;

  constructor(config: BackendConfig) {
    this.config = {
      apiKey: config.apiKey || '',
      baseUrl: config.baseUrl || 'https://api.anthropic.com',
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
      throw new Error('Anthropic API key is required');
    }
  }

  async *chat(request: ChatRequest): AsyncGenerator<ChatChunk> {
    const anthropicRequest = this.convertToAnthropicFormat(request);
    
    let attempt = 0;
    while (attempt <= this.retryOptions.maxRetries) {
      try {
        if (anthropicRequest.stream) {
          yield* this.streamChat(anthropicRequest, request);
        } else {
          yield* this.nonStreamChat(anthropicRequest, request);
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

  private async *streamChat(anthropicRequest: AnthropicRequest, originalRequest: ChatRequest): AsyncGenerator<ChatChunk> {
    const response = await this.makeRequest('/v1/messages', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(anthropicRequest)
    });

    if (!response.body) {
      throw new BackendError('No response body received', 'NO_BODY');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    let messageId = '';
    let currentContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

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
              const event: AnthropicStreamEvent = JSON.parse(data);
              
              if (event.type === 'message_start' && event.message) {
                messageId = event.message.id;
                inputTokens = event.message.usage.input_tokens;
              } else if (event.type === 'content_block_delta' && event.delta) {
                currentContent += event.delta.text;
                
                const chunk: ChatChunk = {
                  id: messageId || generateRequestId(),
                  object: 'chat.completion.chunk',
                  created: createTimestamp(),
                  model: originalRequest.model,
                  choices: [{
                    index: 0,
                    delta: {
                      role: 'assistant',
                      content: event.delta.text
                    },
                    finishReason: null
                  }]
                };
                
                yield chunk;
              } else if (event.type === 'message_delta' && event.usage) {
                outputTokens = event.usage.output_tokens;
              } else if (event.type === 'message_stop') {
                // Final chunk with usage
                const finalChunk: ChatChunk = {
                  id: messageId || generateRequestId(),
                  object: 'chat.completion.chunk',
                  created: createTimestamp(),
                  model: originalRequest.model,
                  choices: [{
                    index: 0,
                    delta: {},
                    finishReason: 'stop'
                  }],
                  usage: {
                    promptTokens: inputTokens,
                    completionTokens: outputTokens,
                    totalTokens: inputTokens + outputTokens
                  }
                };
                
                yield finalChunk;
              }
            } catch (parseError) {
              console.warn('Failed to parse Anthropic event:', data);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async *nonStreamChat(anthropicRequest: AnthropicRequest, originalRequest: ChatRequest): AsyncGenerator<ChatChunk> {
    const response = await this.makeRequest('/v1/messages', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ ...anthropicRequest, stream: false })
    });

    const data = await response.json() as any;
    
    if (data.error) {
      throw this.handleError(data.error, response.status);
    }

    const usage: TokenUsage = {
      promptTokens: data.usage?.input_tokens || 0,
      completionTokens: data.usage?.output_tokens || 0,
      totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
    };

    const content = data.content?.[0]?.text || '';

    const chunk: ChatChunk = {
      id: data.id || generateRequestId(),
      object: 'chat.completion.chunk',
      created: createTimestamp(),
      model: originalRequest.model,
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          content: content
        },
        finishReason: 'stop'
      }],
      usage
    };

    yield chunk;
  }

  async models(): Promise<Model[]> {
    // Anthropic doesn't have a models endpoint, so we return known models
    const knownModels = [
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229', 
      'claude-3-haiku-20240307',
      'claude-3-5-sonnet-20240620',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022'
    ];

    return knownModels.map((modelId, index) => ({
      id: modelId,
      object: 'model',
      created: 1677610602 + index, // Base timestamp + offset
      ownedBy: 'anthropic'
    }));
  }

  async health(): Promise<boolean> {
    try {
      // Use a lightweight request to check health
      const response = await this.makeRequest('/v1/messages', {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }]
        })
      });

      return response.status < 500; // Consider client errors (4xx) as healthy but server errors (5xx) as unhealthy
    } catch (error) {
      return false;
    }
  }

  private convertToAnthropicFormat(request: ChatRequest): AnthropicRequest {
    const messages = normalizeMessages(request.messages);
    
    // Extract system message if present
    let system: string | undefined;
    const userMessages: AnthropicMessage[] = [];
    
    for (const msg of messages) {
      if (msg.role === 'system') {
        system = msg.content;
      } else if (msg.role === 'user' || msg.role === 'assistant') {
        userMessages.push({
          role: msg.role,
          content: msg.content
        });
      }
    }

    const anthropicRequest: AnthropicRequest = {
      model: request.model,
      max_tokens: request.maxTokens || 4096,
      messages: userMessages,
      stream: request.stream !== false, // Default to streaming
      ...this.config.defaultParams
    };

    if (system) {
      anthropicRequest.system = system;
    }

    if (request.temperature !== undefined) {
      anthropicRequest.temperature = request.temperature;
    }

    if (request.topP !== undefined) {
      anthropicRequest.top_p = request.topP;
    }

    return anthropicRequest;
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
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
      'User-Agent': 'OpenClaw-Pearl/1.0'
    };
  }

  private handleError(errorData: any, status: number): BackendError {
    const message = errorData.error?.message || errorData.message || 'Unknown error';
    
    switch (status) {
      case 401:
        return new AuthenticationError(message);
      case 429:
        const retryAfter = errorData.error?.retry_after;
        return new RateLimitError(message, retryAfter);
      case 400:
      case 403:
      case 404:
        return new BackendError(message, 'CLIENT_ERROR', status, false);
      case 500:
      case 502:
      case 503:
      case 504:
        return new BackendError(message, 'SERVER_ERROR', status, true);
      default:
        return new BackendError(message, 'UNKNOWN_ERROR', status, status >= 500);
    }
  }
}