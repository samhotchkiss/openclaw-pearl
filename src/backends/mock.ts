/**
 * Mock Backend for Testing
 */

import type { BackendClient, ChatRequest, ChatChunk, Model } from './types.js';

/**
 * Mock backend implementation for testing
 * Provides realistic chat responses without external API calls
 */
export class MockBackend implements BackendClient {
  async* chat(request: ChatRequest): AsyncGenerator<ChatChunk> {
    const messageId = 'mock-' + Date.now();
    const timestamp = Math.floor(Date.now() / 1000);
    
    // First chunk with role
    yield {
      id: messageId,
      object: 'chat.completion.chunk',
      created: timestamp,
      model: request.model,
      choices: [{
        index: 0,
        delta: { role: 'assistant' },
        finishReason: null,
      }],
    };

    // Content chunks (simulate streaming)
    const content = this.generateMockResponse(request);
    const words = content.split(' ');
    
    for (let i = 0; i < words.length; i++) {
      const chunk = i === 0 ? words[i] : ' ' + words[i];
      yield {
        id: messageId,
        object: 'chat.completion.chunk',
        created: timestamp,
        model: request.model,
        choices: [{
          index: 0,
          delta: { content: chunk },
          finishReason: null,
        }],
      };
    }

    // Final chunk
    yield {
      id: messageId,
      object: 'chat.completion.chunk',
      created: timestamp,
      model: request.model,
      choices: [{
        index: 0,
        delta: {},
        finishReason: 'stop',
      }],
      usage: {
        promptTokens: this.estimateTokens(request.messages.map(m => m.content).join(' ')),
        completionTokens: this.estimateTokens(content),
        totalTokens: 0, // Will be calculated by usage
      },
    };
  }

  async models(): Promise<Model[]> {
    return [
      {
        id: 'mock/test-model',
        object: 'model',
        created: Date.now(),
        ownedBy: 'mock',
      },
      {
        id: 'test-model',
        object: 'model',
        created: Date.now(),
        ownedBy: 'mock',
      },
      {
        id: 'pearl',
        object: 'model',
        created: Date.now(),
        ownedBy: 'pearl',
      },
    ];
  }

  async health(): Promise<boolean> {
    return true;
  }

  /**
   * Generate mock response based on request
   */
  private generateMockResponse(request: ChatRequest): string {
    const lastMessage = request.messages[request.messages.length - 1];
    const content = lastMessage?.content || '';

    // Generate contextual mock responses
    if (content.toLowerCase().includes('hello')) {
      return 'Hello! This is a mock response for testing purposes.';
    }
    if (content.toLowerCase().includes('test')) {
      return 'Test response from mock backend. Everything is working correctly.';
    }
    if (content.toLowerCase().includes('error')) {
      return 'Mock backend is handling error scenarios gracefully.';
    }

    // Default response
    return `This is a mock response to: "${content}". The mock backend is functioning properly.`;
  }

  /**
   * Simple token estimation (roughly 4 chars = 1 token)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}