import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MemoryExtractor,
  type ExtractedMemory,
  type ExtractionResult,
  type LLMProvider,
  type LLMProviderConfig,
} from '../src/memory/extractor.js';

/**
 * Mock LLM provider for testing
 */
function createMockProvider(
  response: ExtractionResult | (() => ExtractionResult)
): LLMProvider {
  return {
    async extract(_message: string): Promise<ExtractionResult> {
      return typeof response === 'function' ? response() : response;
    },
  };
}

describe('MemoryExtractor', () => {
  describe('construction', () => {
    it('creates with default config', () => {
      const extractor = new MemoryExtractor();
      expect(extractor).toBeDefined();
    });

    it('creates with custom config', () => {
      const extractor = new MemoryExtractor({
        provider: 'ollama',
        model: 'llama3.2:3b',
        minConfidence: 0.8,
      });
      expect(extractor).toBeDefined();
    });

    it('accepts custom LLM provider', () => {
      const mockProvider = createMockProvider({ memories: [] });
      const extractor = new MemoryExtractor({}, mockProvider);
      expect(extractor).toBeDefined();
    });
  });

  describe('extract()', () => {
    let extractor: MemoryExtractor;
    let mockProvider: LLMProvider;

    beforeEach(() => {
      mockProvider = createMockProvider({ memories: [] });
      extractor = new MemoryExtractor({}, mockProvider);
    });

    it('returns empty array for trivial messages', async () => {
      // Short messages shouldn't even call the LLM
      const result = await extractor.extract('ok');
      expect(result.memories).toEqual([]);
    });

    it('returns empty array for common greetings', async () => {
      const result = await extractor.extract('Hello there!');
      expect(result.memories).toEqual([]);
    });

    it('returns empty array for simple acknowledgments', async () => {
      const phrases = ['thanks', 'got it', 'sounds good', 'ok cool', 'perfect'];
      for (const phrase of phrases) {
        const result = await extractor.extract(phrase);
        expect(result.memories).toEqual([]);
      }
    });

    it('extracts preference from message', async () => {
      mockProvider = createMockProvider({
        memories: [
          {
            type: 'preference',
            content: 'User prefers dark mode',
            confidence: 0.9,
            tags: ['ui', 'appearance'],
          },
        ],
      });
      extractor = new MemoryExtractor({}, mockProvider);

      const result = await extractor.extract('I really prefer dark mode for all my apps');
      
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].type).toBe('preference');
      expect(result.memories[0].content).toBe('User prefers dark mode');
      expect(result.memories[0].confidence).toBe(0.9);
      expect(result.memories[0].tags).toContain('ui');
    });

    it('extracts facts from message', async () => {
      mockProvider = createMockProvider({
        memories: [
          {
            type: 'fact',
            content: 'User lives in Santa Fe, New Mexico',
            confidence: 0.95,
            tags: ['location', 'personal'],
          },
        ],
      });
      extractor = new MemoryExtractor({}, mockProvider);

      const result = await extractor.extract('I live in Santa Fe, New Mexico');
      
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].type).toBe('fact');
      expect(result.memories[0].content).toContain('Santa Fe');
    });

    it('extracts rules from message', async () => {
      mockProvider = createMockProvider({
        memories: [
          {
            type: 'rule',
            content: 'Always use bullet points in responses',
            confidence: 0.85,
            tags: ['formatting', 'style'],
          },
        ],
      });
      extractor = new MemoryExtractor({}, mockProvider);

      const result = await extractor.extract('Always use bullet points when listing things');
      
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].type).toBe('rule');
    });

    it('extracts decisions from message', async () => {
      mockProvider = createMockProvider({
        memories: [
          {
            type: 'decision',
            content: 'Decision to use SQLite because it requires no setup',
            confidence: 0.88,
            tags: ['database', 'architecture'],
          },
        ],
      });
      extractor = new MemoryExtractor({}, mockProvider);

      const result = await extractor.extract("We've decided to use SQLite because it requires no setup");
      
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].type).toBe('decision');
    });

    it('extracts health info from message', async () => {
      mockProvider = createMockProvider({
        memories: [
          {
            type: 'health',
            content: 'User is allergic to penicillin',
            confidence: 0.95,
            tags: ['medical', 'allergy'],
          },
        ],
      });
      extractor = new MemoryExtractor({}, mockProvider);

      const result = await extractor.extract("I'm allergic to penicillin");
      
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].type).toBe('health');
    });

    it('extracts reminders from message', async () => {
      mockProvider = createMockProvider({
        memories: [
          {
            type: 'reminder',
            content: 'Call dentist tomorrow at 2pm',
            confidence: 0.9,
            tags: ['appointment', 'health'],
          },
        ],
      });
      extractor = new MemoryExtractor({}, mockProvider);

      const result = await extractor.extract('Remind me to call the dentist tomorrow at 2pm');
      
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].type).toBe('reminder');
    });

    it('extracts relationship info from message', async () => {
      mockProvider = createMockProvider({
        memories: [
          {
            type: 'relationship',
            content: "User's son Noah is 8 years old",
            confidence: 0.92,
            tags: ['family', 'child'],
          },
        ],
      });
      extractor = new MemoryExtractor({}, mockProvider);

      const result = await extractor.extract('My son Noah is 8 years old');
      
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].type).toBe('relationship');
    });

    it('extracts multiple memories from single message', async () => {
      mockProvider = createMockProvider({
        memories: [
          {
            type: 'fact',
            content: 'User lives in Santa Fe',
            confidence: 0.9,
            tags: ['location'],
          },
          {
            type: 'preference',
            content: 'User prefers morning meetings',
            confidence: 0.85,
            tags: ['schedule'],
          },
        ],
      });
      extractor = new MemoryExtractor({}, mockProvider);

      const result = await extractor.extract(
        'I live in Santa Fe and prefer morning meetings'
      );
      
      expect(result.memories).toHaveLength(2);
    });

    it('filters out low confidence memories', async () => {
      mockProvider = createMockProvider({
        memories: [
          {
            type: 'preference',
            content: 'Might prefer dark mode',
            confidence: 0.5, // Below default threshold of 0.7
            tags: ['ui'],
          },
        ],
      });
      extractor = new MemoryExtractor({ minConfidence: 0.7 }, mockProvider);

      const result = await extractor.extract('I might like dark mode, not sure');
      
      expect(result.memories).toHaveLength(0);
    });

    it('keeps memories at or above confidence threshold', async () => {
      mockProvider = createMockProvider({
        memories: [
          {
            type: 'preference',
            content: 'User prefers dark mode',
            confidence: 0.7, // At threshold
            tags: ['ui'],
          },
        ],
      });
      extractor = new MemoryExtractor({ minConfidence: 0.7 }, mockProvider);

      const result = await extractor.extract('I prefer dark mode');
      
      expect(result.memories).toHaveLength(1);
    });
  });

  describe('trivial content detection', () => {
    let extractor: MemoryExtractor;
    const mockFn = vi.fn();

    beforeEach(() => {
      mockFn.mockClear();
      const mockProvider: LLMProvider = {
        async extract(_message: string): Promise<ExtractionResult> {
          mockFn();
          return { memories: [] };
        },
      };
      extractor = new MemoryExtractor({}, mockProvider);
    });

    it('skips LLM call for messages under minimum length', async () => {
      await extractor.extract('hi');
      expect(mockFn).not.toHaveBeenCalled();
    });

    it('skips LLM call for common greetings', async () => {
      const greetings = ['hello', 'hey there', 'hi!', 'good morning'];
      for (const greeting of greetings) {
        await extractor.extract(greeting);
      }
      expect(mockFn).not.toHaveBeenCalled();
    });

    it('skips LLM call for simple questions without facts', async () => {
      await extractor.extract('How are you?');
      expect(mockFn).not.toHaveBeenCalled();
    });

    it('skips LLM call for acknowledgments', async () => {
      const acks = ['okay', 'sure', 'yes', 'no', 'alright', 'fine', 'yep'];
      for (const ack of acks) {
        await extractor.extract(ack);
      }
      expect(mockFn).not.toHaveBeenCalled();
    });

    it('calls LLM for substantive messages', async () => {
      await extractor.extract('My favorite programming language is TypeScript because it has great type safety.');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('calls LLM for messages with personal info indicators', async () => {
      await extractor.extract('I live in Denver and work at Google.');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('returns empty array on LLM error', async () => {
      const failingProvider: LLMProvider = {
        async extract(_message: string): Promise<ExtractionResult> {
          throw new Error('LLM API error');
        },
      };
      const extractor = new MemoryExtractor({}, failingProvider);

      const result = await extractor.extract('My name is John and I live in NYC');
      
      expect(result.memories).toEqual([]);
      expect(result.error).toBe('LLM API error');
    });

    it('handles malformed LLM response gracefully', async () => {
      const badProvider: LLMProvider = {
        async extract(_message: string): Promise<ExtractionResult> {
          return { memories: 'not an array' as unknown as ExtractedMemory[] };
        },
      };
      const extractor = new MemoryExtractor({}, badProvider);

      const result = await extractor.extract('My name is John');
      
      // Should return empty instead of crashing
      expect(result.memories).toEqual([]);
    });

    it('handles missing fields in extracted memories', async () => {
      const incompleteProvider: LLMProvider = {
        async extract(_message: string): Promise<ExtractionResult> {
          return {
            memories: [
              { type: 'fact', content: 'Valid memory', confidence: 0.9, tags: [] },
              { type: 'fact' } as ExtractedMemory, // Missing content
              { content: 'Missing type', confidence: 0.8, tags: [] } as ExtractedMemory,
            ],
          };
        },
      };
      const extractor = new MemoryExtractor({}, incompleteProvider);

      // Use a message that will trigger LLM call (contains substantive indicators)
      const result = await extractor.extract('I live in Santa Fe and my name is John Smith');
      
      // Should only return valid memories
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].content).toBe('Valid memory');
    });
  });

  describe('content normalization', () => {
    it('normalizes memory content to third person', async () => {
      const mockProvider = createMockProvider({
        memories: [
          {
            type: 'preference',
            content: 'User prefers dark mode', // Already normalized
            confidence: 0.9,
            tags: ['ui'],
          },
        ],
      });
      const extractor = new MemoryExtractor({}, mockProvider);

      const result = await extractor.extract('I prefer dark mode');
      
      expect(result.memories[0].content).toContain('User');
    });

    it('preserves tags in normalized output', async () => {
      const mockProvider = createMockProvider({
        memories: [
          {
            type: 'fact',
            content: 'User lives in Santa Fe',
            confidence: 0.9,
            tags: ['location', 'residence'],
          },
        ],
      });
      const extractor = new MemoryExtractor({}, mockProvider);

      const result = await extractor.extract('I live in Santa Fe');
      
      expect(result.memories[0].tags).toEqual(['location', 'residence']);
    });
  });

  describe('extraction prompt', () => {
    it('uses configurable extraction prompt', async () => {
      let receivedMessage = '';
      const trackingProvider: LLMProvider = {
        async extract(message: string): Promise<ExtractionResult> {
          receivedMessage = message;
          return { memories: [] };
        },
      };
      const extractor = new MemoryExtractor({}, trackingProvider);

      await extractor.extract('I prefer dark mode and my name is John');
      
      // The provider should receive the full message for analysis
      expect(receivedMessage).toBe('I prefer dark mode and my name is John');
    });
  });

  describe('getExtractionPrompt()', () => {
    it('returns the extraction system prompt', () => {
      const extractor = new MemoryExtractor();
      const prompt = extractor.getExtractionPrompt();
      
      expect(prompt).toContain('memory extraction');
      expect(prompt).toContain('fact');
      expect(prompt).toContain('preference');
      expect(prompt).toContain('rule');
      expect(prompt).toContain('decision');
      expect(prompt).toContain('health');
      expect(prompt).toContain('reminder');
      expect(prompt).toContain('relationship');
      expect(prompt).toContain('JSON');
    });
  });
});

describe('LLM Provider Configuration', () => {
  describe('provider config validation', () => {
    it('accepts anthropic provider config', () => {
      const config: LLMProviderConfig = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKey: 'test-key',
      };
      const extractor = new MemoryExtractor(config);
      expect(extractor).toBeDefined();
    });

    it('accepts ollama provider config', () => {
      const config: LLMProviderConfig = {
        provider: 'ollama',
        model: 'llama3.2:3b',
        baseUrl: 'http://localhost:11434',
      };
      const extractor = new MemoryExtractor(config);
      expect(extractor).toBeDefined();
    });

    it('accepts openai provider config', () => {
      const config: LLMProviderConfig = {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'test-key',
      };
      const extractor = new MemoryExtractor(config);
      expect(extractor).toBeDefined();
    });

    it('uses default values when not provided', () => {
      const extractor = new MemoryExtractor({});
      expect(extractor).toBeDefined();
    });
  });
});
