/**
 * Shared types for backend client implementations
 */

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: Message[];
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  metadata?: {
    agentId?: string;
    sessionId?: string;
    forceSunrise?: boolean;
    [key: string]: unknown;
  };
}

export interface ChatChunk {
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
    finishReason?: 'stop' | 'length' | 'content_filter' | null;
  }>;
  usage?: TokenUsage;
}

export interface ChatResponse {
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
    finishReason: 'stop' | 'length' | 'content_filter';
  }>;
  usage: TokenUsage;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface Model {
  id: string;
  object: string;
  created: number;
  ownedBy: string;
  permission?: unknown[];
  root?: string;
  parent?: string;
}

export interface BackendClient {
  /**
   * Stream chat completion using async generator
   */
  chat(request: ChatRequest): AsyncGenerator<ChatChunk>;

  /**
   * Get available models from this backend
   */
  models(): Promise<Model[]>;

  /**
   * Check if backend is healthy/reachable
   */
  health(): Promise<boolean>;
}

export interface BackendConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultParams?: Record<string, unknown>;
  timeout?: number;
  retries?: number;
}

export interface ErrorRetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
}

export class BackendError extends Error {
  constructor(
    message: string,
    public code: string,
    public status?: number,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

export class RateLimitError extends BackendError {
  constructor(message: string, public retryAfter?: number) {
    super(message, 'RATE_LIMIT', 429, true);
    this.name = 'RateLimitError';
  }
}

export class AuthenticationError extends BackendError {
  constructor(message: string) {
    super(message, 'AUTHENTICATION', 401, false);
    this.name = 'AuthenticationError';
  }
}

export class NetworkError extends BackendError {
  constructor(message: string) {
    super(message, 'NETWORK', 0, true);
    this.name = 'NetworkError';
  }
}

/**
 * Utility function to convert messages to OpenAI format
 */
export function normalizeMessages(messages: Message[]): Message[] {
  return messages.map(msg => ({
    role: msg.role,
    content: msg.content
  }));
}

/**
 * Utility function to generate request ID
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Utility function to create timestamp
 */
export function createTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Utility function for exponential backoff
 */
export async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function exponentialBackoff(
  attempt: number,
  options: ErrorRetryOptions
): Promise<void> {
  const delay_ms = Math.min(
    options.baseDelay * Math.pow(options.backoffFactor, attempt),
    options.maxDelay
  );
  await delay(delay_ms);
}