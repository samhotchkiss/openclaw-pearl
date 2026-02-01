/**
 * Anthropic Claude Backend Client
 * Uses official SDK with full Claude Code stealth mode for OAuth tokens.
 * 
 * When using OAuth tokens (sk-ant-oat*), this backend mimics Claude Code's
 * exact authentication flow: headers, beta flags, user-agent, and system
 * prompt format — matching the pi-ai reference implementation.
 */

import Anthropic from '@anthropic-ai/sdk';
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

// Claude Code stealth mode constants (from pi-ai reference)
const CLAUDE_CODE_VERSION = '2.1.2';
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

// Token refresh constants
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

function isOAuthToken(apiKey: string): boolean {
  return apiKey.includes('sk-ant-oat');
}

/**
 * Refresh an expired OAuth access token using the refresh token.
 * Returns the new access token, refresh token, and expiry timestamp.
 */
async function refreshOAuthToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`,
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new AuthenticationError(`OAuth token refresh failed (${response.status}): ${error}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    // 5-minute buffer before actual expiry
    expiresAt: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
  };
}

export class AnthropicClient implements BackendClient {
  private config: Required<BackendConfig>;
  private client: Anthropic;
  private retryOptions: ErrorRetryOptions;
  private isOAuth: boolean;

  // Token refresh state
  private currentToken: string;
  private refreshToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private refreshPromise: Promise<void> | null = null;
  private credentialsFilePath: string | null = null;

  constructor(config: BackendConfig) {
    this.config = {
      apiKey: config.apiKey || '',
      baseUrl: config.baseUrl || 'https://api.anthropic.com',
      defaultParams: config.defaultParams || {},
      timeout: config.timeout || 120000,
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

    this.isOAuth = isOAuthToken(this.config.apiKey);
    this.currentToken = this.config.apiKey;

    // Resolve credentials file path from config or default
    if (this.isOAuth) {
      const credFile = (config as any).credentialsFile || (config.defaultParams as any)?.credentials_file;
      if (credFile) {
        const os = require('os');
        this.credentialsFilePath = credFile.replace('~', os.homedir());
        console.log(`[Anthropic] Using credentials file: ${this.credentialsFilePath}`);
      } else {
        // Default: shared credentials file
        const path = require('path');
        const os = require('os');
        this.credentialsFilePath = path.join(os.homedir(), '.claude', '.credentials.json');
      }
      this.loadFromCredentialsFile();
    }

    this.client = this.createClient(this.currentToken);
  }

  /**
   * Load current access token, refresh token, and expiry from the credentials file.
   * Uses configurable path (defaults to ~/.claude/.credentials.json).
   */
  private loadFromCredentialsFile(): void {
    if (!this.credentialsFilePath) return;
    try {
      const fs = require('fs');
      if (!fs.existsSync(this.credentialsFilePath)) {
        console.log(`[Anthropic] Credentials file not found: ${this.credentialsFilePath}, using config token`);
        return;
      }
      const data = JSON.parse(fs.readFileSync(this.credentialsFilePath, 'utf-8'));
      const oauth = data.claudeAiOauth;
      if (oauth) {
        // Use the token from the credentials file if present (it may be newer)
        if (oauth.accessToken) {
          this.currentToken = oauth.accessToken;
        }
        this.refreshToken = oauth.refreshToken || null;
        this.tokenExpiresAt = oauth.expiresAt || 0;
        console.log(`[Anthropic] Loaded credentials from ${this.credentialsFilePath} (token: ${this.currentToken.slice(0, 20)}...)`);
      }
    } catch (err) {
      console.warn(`[Anthropic] Could not load ${this.credentialsFilePath}, using config token`);
    }
  }

  /**
   * Save updated tokens back to the credentials file.
   */
  private saveTokens(accessToken: string, refreshToken: string, expiresAt: number): void {
    if (!this.credentialsFilePath) return;
    try {
      const fs = require('fs');
      const path = require('path');
      let data: any = {};
      if (fs.existsSync(this.credentialsFilePath)) {
        data = JSON.parse(fs.readFileSync(this.credentialsFilePath, 'utf-8'));
      }
      const dir = path.dirname(this.credentialsFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (!data.claudeAiOauth) data.claudeAiOauth = {};
      data.claudeAiOauth.accessToken = accessToken;
      data.claudeAiOauth.refreshToken = refreshToken;
      data.claudeAiOauth.expiresAt = expiresAt;
      fs.writeFileSync(this.credentialsFilePath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`[Anthropic] Saved refreshed tokens to ${this.credentialsFilePath}`);
    } catch (err) {
      console.warn(`[Anthropic] Could not save tokens to ${this.credentialsFilePath}:`, err);
    }
  }

  /**
   * Ensure the OAuth token is valid.
   * First re-reads credentials file (another process may have refreshed).
   * Only refreshes ourselves as a last resort.
   * Coalesces concurrent refresh attempts.
   */
  private async ensureValidToken(): Promise<void> {
    if (!this.isOAuth) return;

    // Always re-read credentials file first — OpenClaw may have refreshed the token
    const prevToken = this.currentToken;
    this.loadFromCredentialsFile();

    // If the token changed (another process refreshed), recreate the client
    if (this.currentToken !== prevToken) {
      console.log('[Anthropic] Token updated from credentials file (external refresh detected)');
      this.client = this.createClient(this.currentToken);
    }

    // If token is still valid, we're good
    if (Date.now() < this.tokenExpiresAt) return;

    // No refresh token available — can't refresh ourselves
    if (!this.refreshToken) return;

    // Coalesce concurrent refreshes
    if (this.refreshPromise) {
      await this.refreshPromise;
      return;
    }

    console.log('[Anthropic] OAuth token expired (no external refresh found), refreshing ourselves...');
    this.refreshPromise = (async () => {
      try {
        const result = await refreshOAuthToken(this.refreshToken!);
        this.currentToken = result.accessToken;
        this.refreshToken = result.refreshToken;
        this.tokenExpiresAt = result.expiresAt;

        // Recreate client with new token
        this.client = this.createClient(this.currentToken);

        // Persist to disk so other processes can use it
        this.saveTokens(result.accessToken, result.refreshToken, result.expiresAt);

        console.log('[Anthropic] Token refreshed successfully');
      } catch (err) {
        console.error('[Anthropic] Token refresh failed:', err);
        throw err;
      } finally {
        this.refreshPromise = null;
      }
    })();

    await this.refreshPromise;
  }

  /**
   * Create an Anthropic SDK client with appropriate headers.
   * OAuth tokens get full Claude Code stealth mode.
   */
  private createClient(token: string): Anthropic {
    if (isOAuthToken(token)) {
      // Full Claude Code stealth mode
      const defaultHeaders: Record<string, string> = {
        'accept': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
        'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14',
        'user-agent': `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`,
        'x-app': 'cli',
      };

      console.log('[Anthropic] Creating OAuth client with Claude Code stealth headers');

      return new Anthropic({
        apiKey: null as any,
        authToken: token,
        baseURL: this.config.baseUrl,
        defaultHeaders,
        dangerouslyAllowBrowser: true,
        timeout: this.config.timeout,
        maxRetries: this.config.retries,
      });
    }

    // Standard API key mode
    console.log('[Anthropic] Creating standard API key client');
    return new Anthropic({
      apiKey: token,
      baseURL: this.config.baseUrl,
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
        'accept': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      timeout: this.config.timeout,
      maxRetries: this.config.retries,
    });
  }

  async *chat(request: ChatRequest): AsyncGenerator<ChatChunk> {
    // Ensure token is fresh before making the request
    await this.ensureValidToken();

    const { system, messages, model } = this.prepareRequest(request);
    
    let attempt = 0;
    while (attempt <= this.retryOptions.maxRetries) {
      try {
        if (request.stream !== false) {
          yield* this.streamChat(model, messages, system, request);
        } else {
          yield* this.nonStreamChat(model, messages, system, request);
        }
        return;
      } catch (error) {
        // On 401, try refreshing the token once
        if (error instanceof Anthropic.AuthenticationError && this.isOAuth && this.refreshToken && attempt === 0) {
          console.log('[Anthropic] Got 401, attempting token refresh...');
          this.tokenExpiresAt = 0; // Force refresh
          try {
            await this.ensureValidToken();
            attempt++;
            continue;
          } catch (refreshErr) {
            throw new AuthenticationError('OAuth token refresh failed after 401');
          }
        }

        if (error instanceof BackendError && error.retryable && attempt < this.retryOptions.maxRetries) {
          await exponentialBackoff(attempt, this.retryOptions);
          attempt++;
          continue;
        }
        // Convert SDK errors to our error types
        if (error instanceof Anthropic.AuthenticationError) {
          throw new AuthenticationError(error.message);
        }
        if (error instanceof Anthropic.RateLimitError) {
          throw new RateLimitError(error.message);
        }
        if (error instanceof Anthropic.APIError) {
          throw new BackendError(
            error.message, 
            'API_ERROR', 
            error.status ?? 500, 
            (error.status ?? 500) >= 500
          );
        }
        throw error;
      }
    }
  }

  private async *streamChat(
    model: string, 
    messages: Anthropic.MessageParam[], 
    system: string | Anthropic.TextBlockParam[] | undefined, 
    originalRequest: ChatRequest
  ): AsyncGenerator<ChatChunk> {
    const params: any = {
      model,
      max_tokens: originalRequest.maxTokens || 4096,
      messages,
      stream: true,
    };

    if (system) params.system = system;
    if (originalRequest.temperature !== undefined) params.temperature = originalRequest.temperature;
    if (originalRequest.topP !== undefined) params.top_p = originalRequest.topP;

    const stream = this.client.messages.stream(params);
    let messageId = '';
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const event of stream) {
      if (event.type === 'message_start') {
        messageId = event.message.id;
        inputTokens = event.message.usage.input_tokens;
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield {
          id: messageId || generateRequestId(),
          object: 'chat.completion.chunk',
          created: createTimestamp(),
          model: originalRequest.model,
          choices: [{
            index: 0,
            delta: { role: 'assistant', content: event.delta.text },
            finishReason: null
          }]
        };
      } else if (event.type === 'message_delta') {
        outputTokens = event.usage.output_tokens;
      } else if (event.type === 'message_stop') {
        yield {
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
      }
    }
  }

  private async *nonStreamChat(
    model: string, 
    messages: Anthropic.MessageParam[], 
    system: string | Anthropic.TextBlockParam[] | undefined, 
    originalRequest: ChatRequest
  ): AsyncGenerator<ChatChunk> {
    const params: any = {
      model,
      max_tokens: originalRequest.maxTokens || 4096,
      messages,
    };

    if (system) params.system = system;
    if (originalRequest.temperature !== undefined) params.temperature = originalRequest.temperature;
    if (originalRequest.topP !== undefined) params.top_p = originalRequest.topP;

    const response = await this.client.messages.create(params);

    const content = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('');

    yield {
      id: response.id || generateRequestId(),
      object: 'chat.completion.chunk',
      created: createTimestamp(),
      model: originalRequest.model,
      choices: [{
        index: 0,
        delta: { role: 'assistant', content },
        finishReason: 'stop'
      }],
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens
      }
    };
  }

  async models(): Promise<Model[]> {
    const knownModels = [
      'claude-opus-4-20250514',
      'claude-sonnet-4-20250514',
      'claude-3-5-haiku-20241022',
    ];

    return knownModels.map((modelId, index) => ({
      id: modelId,
      object: 'model',
      created: 1677610602 + index,
      ownedBy: 'anthropic'
    }));
  }

  async health(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }]
      });
      return true;
    } catch {
      return false;
    }
  }

  private prepareRequest(request: ChatRequest): {
    system: string | Anthropic.TextBlockParam[] | undefined;
    messages: Anthropic.MessageParam[];
    model: string;
  } {
    const normalized = normalizeMessages(request.messages);
    
    let systemText: string | undefined;
    const messages: Anthropic.MessageParam[] = [];
    
    for (const msg of normalized) {
      if (msg.role === 'system') {
        systemText = systemText ? `${systemText}\n\n${msg.content}` : msg.content;
      } else if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // For OAuth tokens, use Claude Code system prompt format:
    // Array of content blocks with cache_control (matching pi-ai exactly)
    let system: string | Anthropic.TextBlockParam[] | undefined;
    
    if (this.isOAuth) {
      const blocks: any[] = [
        {
          type: 'text',
          text: CLAUDE_CODE_IDENTITY,
          cache_control: { type: 'ephemeral' },
        },
      ];
      
      if (systemText) {
        blocks.push({
          type: 'text',
          text: systemText,
          cache_control: { type: 'ephemeral' },
        });
      }
      
      system = blocks;
    } else {
      system = systemText;
    }

    // Strip 'anthropic/' or 'anthropic-max/' prefix
    let model = request.model;
    if (model.startsWith('anthropic-max/')) {
      model = model.slice(14);
    } else if (model.startsWith('anthropic/')) {
      model = model.slice(10);
    }

    return { system, messages, model };
  }
}
