/**
 * Rate-Limited Backend Wrapper
 * Wraps backend clients to automatically apply rate limiting and failover
 */

import type { BackendClient, ChatRequest, ChatChunk } from '../backends/types.js';
import type { Provider } from '../accounts/types.js';
import type { IRateLimitService } from './types.js';

/**
 * Wraps a backend client with rate limiting capabilities
 */
export class RateLimitedBackend implements BackendClient {
  constructor(
    private backend: BackendClient,
    private rateLimitService: IRateLimitService,
    private accountId: string,
    private provider: Provider
  ) {}

  /**
   * Execute chat with rate limiting and retry logic
   */
  async *chat(request: ChatRequest): AsyncGenerator<ChatChunk> {
    const operation = async (): Promise<ChatChunk[]> => {
      const chunks: ChatChunk[] = [];
      
      for await (const chunk of this.backend.chat(request)) {
        chunks.push(chunk);
      }
      
      return chunks;
    };

    const context = {
      operation: 'chat',
      metadata: {
        model: request.model,
        messageCount: request.messages.length,
        streaming: request.stream,
        agentId: request.metadata?.agentId,
        sessionId: request.metadata?.sessionId,
      },
    };

    try {
      const chunks = await this.rateLimitService.executeWithRetry(
        operation,
        this.accountId,
        this.provider,
        context
      );

      // Yield all the chunks we collected
      for (const chunk of chunks) {
        yield chunk;
      }
    } catch (error) {
      // If we still get an error after all retries and failover, re-throw it
      throw error;
    }
  }

  /**
   * Get models with rate limiting
   */
  async models() {
    const operation = async () => this.backend.models();

    const context = {
      operation: 'models',
      metadata: {},
    };

    return this.rateLimitService.executeWithRetry(
      operation,
      this.accountId,
      this.provider,
      context
    );
  }

  /**
   * Health check with rate limiting
   */
  async health() {
    const operation = async () => this.backend.health();

    const context = {
      operation: 'health',
      metadata: {},
    };

    try {
      return await this.rateLimitService.executeWithRetry(
        operation,
        this.accountId,
        this.provider,
        context
      );
    } catch (error) {
      // Health checks shouldn't fail completely due to rate limits
      // Return false if we can't determine health due to rate limiting
      return false;
    }
  }

  /**
   * Get the underlying backend (for direct access if needed)
   */
  getBackend(): BackendClient {
    return this.backend;
  }

  /**
   * Get rate limit service (for monitoring/debugging)
   */
  getRateLimitService(): IRateLimitService {
    return this.rateLimitService;
  }

  /**
   * Get account and provider info
   */
  getAccountInfo(): { accountId: string; provider: Provider } {
    return {
      accountId: this.accountId,
      provider: this.provider,
    };
  }
}