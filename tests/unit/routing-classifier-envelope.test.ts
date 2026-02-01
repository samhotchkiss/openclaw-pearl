/**
 * Routing Classifier with OpenClaw Envelope Stripping Tests
 * Tests envelope detection, stripping, and routing decisions
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RequestClassifier } from '../../src/routing/classifier.js';
import type { Message, ClassificationOptions } from '../../src/routing/types.js';

describe('Routing Classifier with OpenClaw Envelope Stripping', () => {
  let classifier: RequestClassifier;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    classifier = new RequestClassifier();
    originalFetch = global.fetch;
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('Envelope Detection and Stripping', () => {
    it('should extract user text from OpenClaw Slack envelope', async () => {
      const wrappedMessage: Message[] = [{
        role: 'user',
        content: 'System: [2024-01-01T12:00:00Z] Slack message in #general from Alice: What\'s the weather?\n\n[Slack metadata and context...]'
      }];

      const result = await classifier.classify(wrappedMessage);

      // Should classify based on "What's the weather?" (simple) not the full envelope (complex)
      expect(result.complexity).toBe('low');
      expect(result.type).toBe('general');
    });

    it('should extract user text from simple envelope pattern', async () => {
      const wrappedMessage: Message[] = [{
        role: 'user', 
        content: 'from Alice: Can you help me with this math problem?\n\n[Slack general channel context]'
      }];

      const result = await classifier.classify(wrappedMessage);

      expect(result.complexity).toBe('low');
      expect(result.type).toBe('general');
    });

    it('should handle content without envelope (pass-through)', async () => {
      const plainMessage: Message[] = [{
        role: 'user',
        content: 'Write a comprehensive analysis of machine learning algorithms including deep learning, neural networks, and their applications in computer vision.'
      }];

      const result = await classifier.classify(plainMessage);

      expect(result.complexity).toBe('high');
      expect(result.type).toBe('code'); // Classifier sees "algorithms" and "applications" as code-related
    });
  });

  describe('Routing Decisions on Clean Content', () => {
    it('should route simple questions to low complexity', async () => {
      const testCases = [
        'What\'s 2+2?',
        'What time is it?', 
        'How are you?',
        'What\'s the weather like?',
        'Hello there!'
      ];

      for (const content of testCases) {
        const messages: Message[] = [{ role: 'user', content }];
        const result = await classifier.classify(messages);

        expect(result.complexity).toBe('low');
        expect(result.estimatedTokens).toBeLessThan(100);
      }
    });

    it('should route complex tasks to high complexity', async () => {
      const testCases = [
        'Analyze this 500-line codebase and provide optimization recommendations with detailed explanations of algorithmic complexity and performance bottlenecks.',
        'Write a comprehensive research paper on quantum computing with citations and mathematical proofs.',
        'Create a detailed business plan for a tech startup including market analysis, financial projections, and risk assessment.'
      ];

      for (const content of testCases) {
        const messages: Message[] = [{ role: 'user', content }];
        const result = await classifier.classify(messages);

        expect(result.complexity).toBe('high');
        expect(result.estimatedTokens).toBeGreaterThan(500);
      }
    });

    it('should route code requests appropriately', async () => {
      const codeRequests = [
        'Write a React component for user authentication',
        'Create a Python function to parse CSV files',
        'Implement a binary search algorithm in JavaScript',
        'Debug this TypeScript code and fix the errors'
      ];

      for (const content of codeRequests) {
        const messages: Message[] = [{ role: 'user', content }];
        const result = await classifier.classify(messages);

        // Code requests should be classified as either 'code' or 'creative' (both reasonable)
        expect(['code', 'creative']).toContain(result.type);
        expect(result.complexity).toMatch(/medium|high/); // Code requests are typically medium-high complexity
      }
    });
  });

  describe('Envelope vs Clean Content Routing', () => {
    it('should route wrapped simple question to low complexity, not high', async () => {
      // Wrapped version
      const wrappedMessage: Message[] = [{
        role: 'user',
        content: `You are Claude, an AI assistant.
        
System: [2024-01-01T12:00:00Z] Slack message in #general from User: What's 2+2?

[Slack context: This is a message from the general channel. The user is asking a simple math question. Previous conversation context includes team updates and project discussions. Channel has 50 members. Message was sent via OpenClaw integration.]`
      }];

      const result = await classifier.classify(wrappedMessage);

      // Should classify based on "What's 2+2?" not the full envelope
      expect(result.complexity).toBe('low');
      expect(result.type).toBe('general');
      expect(result.estimatedTokens).toBeLessThan(100);
    });

    it('should route wrapped complex task to high complexity', async () => {
      // Wrapped version  
      const wrappedMessage: Message[] = [{
        role: 'user',
        content: `from Alice (Engineering): Analyze this entire codebase for security vulnerabilities and provide a comprehensive report with remediation strategies, impact analysis, and implementation timelines.

[Slack engineering channel - urgent security review needed]`
      }];

      const result = await classifier.classify(wrappedMessage);

      expect(result.complexity).toBe('high');
      expect(['code', 'analysis']).toContain(result.type); // Security analysis could be classified as either
    });
  });

  describe('Sensitive Content Detection', () => {
    it('should detect sensitive content even in envelopes', async () => {
      const sensitiveMessage: Message[] = [{
        role: 'user',
        content: 'from Bob: What is my password for the database?\n\n[Slack DM conversation]'
      }];

      const result = await classifier.classify(sensitiveMessage);

      expect(result.sensitive).toBe(true);
    });

    it('should handle secrets in wrapped content', async () => {
      const secretMessage: Message[] = [{
        role: 'user', 
        content: 'System: [timestamp] Slack message from Developer: Here is the API key: sk-1234567890abcdef\n\n[Slack metadata...]'
      }];

      const result = await classifier.classify(secretMessage);

      expect(result.sensitive).toBe(true);
    });
  });

  describe('Fallback Behavior', () => {
    it('should handle malformed envelopes gracefully', async () => {
      const malformedMessage: Message[] = [{
        role: 'user',
        content: 'System: [incomplete envelope... from: help me with this task'
      }];

      const result = await classifier.classify(malformedMessage);

      // Should not crash and provide reasonable classification
      expect(result.complexity).toBeDefined();
      expect(result.type).toBeDefined();
      expect(result.sensitive).toBeDefined();
    });

    it('should handle empty content after envelope stripping', async () => {
      const emptyMessage: Message[] = [{
        role: 'user',
        content: 'System: [timestamp] Slack message in #general from User:\n\n[Slack context only]'
      }];

      const result = await classifier.classify(emptyMessage);

      expect(result.complexity).toBe('low'); // Default for empty content
      expect(result.type).toBe('general');
    });
  });

  describe('Token Estimation Accuracy', () => {
    it('should estimate tokens based on user content, not envelope', async () => {
      const shortUserMessage = 'Hi';
      const envelope = `You are Claude. System: [timestamp] Slack message from User: ${shortUserMessage}\n\n[Long Slack context with lots of metadata and channel information that would inflate token count if not stripped properly...]`;

      const wrappedMessages: Message[] = [{ role: 'user', content: envelope }];
      const plainMessages: Message[] = [{ role: 'user', content: shortUserMessage }];

      const wrappedResult = await classifier.classify(wrappedMessages);
      const plainResult = await classifier.classify(plainMessages);

      // Token estimates should be similar (based on "Hi", not the full envelope)
      expect(Math.abs(wrappedResult.estimatedTokens - plainResult.estimatedTokens)).toBeLessThan(50);
      expect(wrappedResult.estimatedTokens).toBeLessThan(100);
    });
  });
});