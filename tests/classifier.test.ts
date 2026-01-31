import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RequestClassifier } from '../src/routing/classifier.js';
import type { Message, RequestClassification, ClassificationOptions } from '../src/routing/types.js';

describe('RequestClassifier', () => {
  let classifier: RequestClassifier;

  beforeEach(() => {
    classifier = new RequestClassifier();
  });

  describe('Basic Classification', () => {
    it('should classify simple greetings as low complexity, chat type', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello!' }
      ];

      const result = await classifier.classify(messages);

      expect(result.complexity).toBe('low');
      expect(result.type).toBe('chat');
      expect(result.sensitive).toBe(false);
      expect(result.requiresTools).toBe(false);
    });

    it('should classify code requests as code type', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Debug this JavaScript function that has async issues' }
      ];

      const result = await classifier.classify(messages);

      expect(result.type).toBe('code');
      expect(result.complexity).toBe('medium');
    });

    it('should classify creative writing requests as creative type', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Write a short story about a time traveler' }
      ];

      const result = await classifier.classify(messages);

      expect(result.type).toBe('creative');
      expect(result.complexity).toBe('medium');
    });

    it('should classify analysis requests as analysis type', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Analyze the pros and cons of different database architectures for a high-scale application' }
      ];

      const result = await classifier.classify(messages);

      expect(result.type).toBe('analysis');
      expect(result.complexity).toBe('high');
    });
  });

  describe('Complexity Detection', () => {
    it('should detect low complexity for short, simple queries', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'What time is it in Tokyo?' }
      ];

      const result = await classifier.classify(messages);

      expect(result.complexity).toBe('low');
      expect(result.estimatedTokens).toBeLessThan(100);
    });

    it('should detect medium complexity for moderate explanations', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Can you explain how blockchain technology works and its main use cases?' }
      ];

      const result = await classifier.classify(messages);

      expect(result.complexity).toBe('medium');
    });

    it('should detect high complexity for multi-step reasoning tasks', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'I need help designing a distributed system architecture that can handle 1 million concurrent users, with real-time notifications, data consistency across multiple regions, and fault tolerance. Please provide a detailed technical analysis including database choices, caching strategies, load balancing, and deployment considerations.' }
      ];

      const result = await classifier.classify(messages);

      expect(result.complexity).toBe('high');
      expect(result.estimatedTokens).toBeGreaterThan(500);
    });
  });

  describe('Sensitive Content Detection', () => {
    it('should detect SSN patterns as sensitive', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'My social security number is 123-45-6789' }
      ];

      const result = await classifier.classify(messages);

      expect(result.sensitive).toBe(true);
    });

    it('should detect credit card patterns as sensitive', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'My credit card is 4532 1234 5678 9012' }
      ];

      const result = await classifier.classify(messages);

      expect(result.sensitive).toBe(true);
    });

    it('should detect health-related content as sensitive', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'I was diagnosed with diabetes and need help with my medication dosage' }
      ];

      const result = await classifier.classify(messages);

      expect(result.sensitive).toBe(true);
    });

    it('should detect passwords and secrets as sensitive', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'My API key is abc123xyz and password is secret123' }
      ];

      const result = await classifier.classify(messages);

      expect(result.sensitive).toBe(true);
    });

    it('should not flag normal content as sensitive', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'How do I create a React component?' }
      ];

      const result = await classifier.classify(messages);

      expect(result.sensitive).toBe(false);
    });
  });

  describe('Type Detection', () => {
    it('should detect code-related keywords', async () => {
      const codeKeywords = [
        'function', 'debug', 'error', 'bug', 'api', 'class', 'method',
        'variable', 'syntax', 'compile', 'runtime', 'algorithm'
      ];

      for (const keyword of codeKeywords) {
        const messages: Message[] = [
          { role: 'user', content: `Help me fix this ${keyword} issue` }
        ];

        const result = await classifier.classify(messages);
        expect(result.type).toBe('code');
      }
    });

    it('should detect creative writing keywords', async () => {
      const creativeKeywords = [
        'write', 'story', 'poem', 'creative', 'imagine', 'character',
        'plot', 'narrative', 'fiction'
      ];

      for (const keyword of creativeKeywords) {
        const messages: Message[] = [
          { role: 'user', content: `Please ${keyword} something for me` }
        ];

        const result = await classifier.classify(messages);
        expect(result.type).toBe('creative');
      }
    });

    it('should detect analysis keywords', async () => {
      const analysisKeywords = [
        'analyze', 'compare', 'evaluate', 'assess', 'examine',
        'investigate', 'research', 'study'
      ];

      for (const keyword of analysisKeywords) {
        const messages: Message[] = [
          { role: 'user', content: `Can you ${keyword} this for me?` }
        ];

        const result = await classifier.classify(messages);
        expect(result.type).toBe('analysis');
      }
    });
  });

  describe('Heuristic Classification', () => {
    it('should use heuristics only when specified', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'This is an ambiguous request that could be many things' }
      ];

      const options: ClassificationOptions = {
        useHeuristicsOnly: true
      };

      const result = await classifier.classify(messages, options);

      // Should still return a valid classification
      expect(result.complexity).toMatch(/^(low|medium|high)$/);
      expect(result.type).toMatch(/^(general|code|creative|analysis|chat)$/);
      expect(typeof result.sensitive).toBe('boolean');
    });

    it('should provide fast classification for obvious cases', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hi' }
      ];

      const startTime = Date.now();
      const result = await classifier.classify(messages);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(50); // Should be very fast
      expect(result.complexity).toBe('low');
      expect(result.type).toBe('chat');
    });
  });

  describe('Token Estimation', () => {
    it('should estimate tokens reasonably for short content', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello world' }
      ];

      const result = await classifier.classify(messages);

      expect(result.estimatedTokens).toBeGreaterThan(0);
      expect(result.estimatedTokens).toBeLessThan(50);
    });

    it('should estimate tokens reasonably for long content', async () => {
      const longContent = 'word '.repeat(1000); // 1000 words
      const messages: Message[] = [
        { role: 'user', content: longContent }
      ];

      const result = await classifier.classify(messages);

      expect(result.estimatedTokens).toBeGreaterThan(500);
      expect(result.estimatedTokens).toBeLessThan(2000);
    });
  });

  describe('Multi-message Conversations', () => {
    it('should analyze the entire conversation context', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello! How can I help you?' },
        { role: 'user', content: 'I need help debugging this complex async race condition in my Node.js application' }
      ];

      const result = await classifier.classify(messages);

      expect(result.type).toBe('code');
      expect(result.complexity).toBe('high');
    });

    it('should focus on the latest user message for classification', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Write me a poem' },
        { role: 'assistant', content: 'Here is a poem...' },
        { role: 'user', content: 'Actually, just say hello' }
      ];

      const result = await classifier.classify(messages);

      // Should classify based on "just say hello", not "Write me a poem"
      expect(result.type).toBe('chat');
      expect(result.complexity).toBe('low');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty messages', async () => {
      const messages: Message[] = [
        { role: 'user', content: '' }
      ];

      const result = await classifier.classify(messages);

      expect(result.complexity).toBe('low');
      expect(result.type).toBe('general');
      expect(result.sensitive).toBe(false);
    });

    it('should handle messages with only whitespace', async () => {
      const messages: Message[] = [
        { role: 'user', content: '   \n\t   ' }
      ];

      const result = await classifier.classify(messages);

      expect(result.complexity).toBe('low');
      expect(result.type).toBe('general');
    });

    it('should handle no user messages', async () => {
      const messages: Message[] = [
        { role: 'assistant', content: 'Hello!' },
        { role: 'system', content: 'You are a helpful assistant' }
      ];

      const result = await classifier.classify(messages);

      expect(result.complexity).toBe('low');
      expect(result.type).toBe('general');
    });

    it('should handle very long messages', async () => {
      const veryLongContent = 'word '.repeat(10000); // 10,000 words
      const messages: Message[] = [
        { role: 'user', content: veryLongContent }
      ];

      const result = await classifier.classify(messages);

      expect(result.complexity).toBe('high');
      expect(result.estimatedTokens).toBeGreaterThan(5000);
    });
  });

  describe('Classification Options', () => {
    it('should accept custom model for LLM classification', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'This is a complex query' }
      ];

      const options: ClassificationOptions = {
        model: 'custom-model',
        useLLMClassification: true
      };

      // Should not throw error even with custom model (mock would handle this)
      const result = await classifier.classify(messages, options);
      expect(result).toBeDefined();
    });
  });

  describe('Mixed Content Detection', () => {
    it('should detect mixed sensitive and code content', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Here is my API key abc123xyz, can you help me debug this function?' }
      ];

      const result = await classifier.classify(messages);

      expect(result.sensitive).toBe(true);
      expect(result.type).toBe('code'); // Code should still be detected
    });

    it('should prioritize sensitivity over other classifications', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'My SSN is 123-45-6789. Write a creative story about data privacy.' }
      ];

      const result = await classifier.classify(messages);

      expect(result.sensitive).toBe(true);
      // Type could be either creative or general, sensitivity is the priority
    });
  });
});