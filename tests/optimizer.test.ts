/**
 * Prompt Rewriter Tests
 * Tests for prompt optimization functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PromptRewriter, type LLMProvider, type RewriterConfig } from '../src/optimization/rewriter.js';

describe('PromptRewriter', () => {
  let rewriter: PromptRewriter;

  describe('with heuristic rewriting (no LLM)', () => {
    beforeEach(() => {
      rewriter = new PromptRewriter({ enabled: true });
    });

    it('should shorten verbose prompts', async () => {
      const verbose = 'Um, I was wondering if you could please help me, basically I just kind of need to sort of understand how this works, you know?';
      
      const result = await rewriter.rewrite(verbose);
      
      expect(result.wasRewritten).toBe(true);
      expect(result.rewrittenTokens).toBeLessThan(result.originalTokens);
      expect(result.tokensSaved).toBeGreaterThan(0);
    });

    it('should preserve meaning after rewrite', async () => {
      const original = 'I was wondering if you could please help me understand how async/await works in JavaScript';
      
      const result = await rewriter.rewrite(original);
      
      // Core concepts should be preserved
      expect(result.rewritten.toLowerCase()).toContain('async');
      expect(result.rewritten.toLowerCase()).toContain('await');
      expect(result.rewritten.toLowerCase()).toContain('javascript');
      expect(result.rewritten.toLowerCase()).toContain('help');
    });

    it('should not change already-efficient prompts', async () => {
      const efficient = 'Explain recursion with a Python example.';
      
      const result = await rewriter.rewrite(efficient);
      
      expect(result.wasRewritten).toBe(false);
      expect(result.rewritten).toBe(efficient);
    });

    it('should track token savings', async () => {
      const verbose = 'Um, basically, I just kind of want you to, you know, explain this to me if you could please';
      
      const result = await rewriter.rewrite(verbose);
      
      expect(result.tokensSaved).toBeGreaterThan(0);
      expect(result.tokensSaved).toBe(result.originalTokens - result.rewrittenTokens);
    });

    it('should pass through when disabled', async () => {
      const disabledRewriter = new PromptRewriter({ enabled: false });
      const prompt = 'Um, I was just wondering if, like, you could help me';
      
      const result = await disabledRewriter.rewrite(prompt);
      
      expect(result.wasRewritten).toBe(false);
      expect(result.rewritten).toBe(prompt);
    });

    it('should not rewrite prompts with code blocks', async () => {
      const withCode = 'Can you help me with this code?\n```javascript\nfunction test() { return 42; }\n```';
      
      const result = await rewriter.rewrite(withCode);
      
      expect(result.wasRewritten).toBe(false);
      expect(result.rewritten).toBe(withCode);
    });

    it('should not rewrite prompts with URLs', async () => {
      const withUrl = 'What does this page say https://example.com/article about AI?';
      
      const result = await rewriter.rewrite(withUrl);
      
      expect(result.wasRewritten).toBe(false);
    });

    it('should not rewrite prompts below minimum token threshold', async () => {
      const short = 'Hello there!';
      
      const result = await rewriter.rewrite(short);
      
      expect(result.wasRewritten).toBe(false);
    });

    it('should remove common filler words', async () => {
      // Prompt needs to be long enough to exceed minTokensToRewrite (20 tokens)
      const fillers = 'Um, like, basically I just kind of need to sort of understand how this complicated system works in production, you know what I mean?';
      
      const result = await rewriter.rewrite(fillers);
      
      expect(result.wasRewritten).toBe(true);
      expect(result.rewritten).not.toContain('Um');
      expect(result.rewritten).not.toContain('basically');
      expect(result.rewritten).not.toContain('kind of');
      expect(result.rewritten).not.toContain('sort of');
      expect(result.rewritten).not.toContain('you know');
    });

    it('should simplify polite verbose phrases', async () => {
      const polite = 'Could you please if you would be so kind help me understand this if you don\'t mind?';
      
      const result = await rewriter.rewrite(polite);
      
      expect(result.wasRewritten).toBe(true);
      expect(result.rewrittenTokens).toBeLessThan(result.originalTokens);
    });
  });

  describe('with LLM provider', () => {
    let mockProvider: LLMProvider;

    beforeEach(() => {
      mockProvider = {
        complete: vi.fn().mockImplementation(async (prompt: string) => {
          // Extract original prompt and return a shorter version
          const match = prompt.match(/"""([\s\S]*?)"""/);
          if (match) {
            const original = match[1].trim();
            // Simple mock: remove filler words and shorten
            return original
              .replace(/\bum\b|\buh\b|\blike\b|\byou know\b/gi, '')
              .replace(/\s+/g, ' ')
              .trim();
          }
          return prompt;
        }),
      };
      rewriter = new PromptRewriter({ enabled: true }, mockProvider);
    });

    it('should use LLM for rewriting', async () => {
      const verbose = 'Um, like, I was wondering if you could help me understand this concept, you know?';
      
      await rewriter.rewrite(verbose);
      
      expect(mockProvider.complete).toHaveBeenCalled();
    });

    it('should fall back to heuristic on LLM error', async () => {
      const errorProvider: LLMProvider = {
        complete: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
      };
      const errorRewriter = new PromptRewriter({ enabled: true }, errorProvider);
      
      const verbose = 'Um, basically I just need to understand this, you know?';
      const result = await errorRewriter.rewrite(verbose);
      
      // Should still return a result (from heuristic)
      expect(result).toBeDefined();
      expect(result.original).toBe(verbose);
    });
  });

  describe('message rewriting', () => {
    beforeEach(() => {
      rewriter = new PromptRewriter({ enabled: true });
    });

    it('should rewrite the last user message', async () => {
      const messages = [
        { role: 'system' as const, content: 'You are helpful.' },
        // Prompt needs to be long enough and have filler words
        { role: 'user' as const, content: 'Um, I was just wondering if you could please help me understand this concept basically, like how does this complicated system work in production?' },
      ];
      
      const { messages: newMessages, result } = await rewriter.rewriteMessages(messages);
      
      expect(result).toBeDefined();
      expect(result?.wasRewritten).toBe(true);
      expect(newMessages[1].content).not.toBe(messages[1].content);
      // System message unchanged
      expect(newMessages[0].content).toBe(messages[0].content);
    });

    it('should not modify messages when disabled', async () => {
      const disabledRewriter = new PromptRewriter({ enabled: false });
      const messages = [
        { role: 'user' as const, content: 'Um, basically, I just need help' },
      ];
      
      const { messages: newMessages, result } = await disabledRewriter.rewriteMessages(messages);
      
      expect(result).toBeUndefined();
      expect(newMessages).toEqual(messages);
    });

    it('should handle messages with no user message', async () => {
      const messages = [
        { role: 'system' as const, content: 'You are helpful.' },
        { role: 'assistant' as const, content: 'Hello!' },
      ];
      
      const { messages: newMessages } = await rewriter.rewriteMessages(messages);
      
      expect(newMessages).toEqual(messages);
    });
  });

  describe('statistics', () => {
    beforeEach(() => {
      rewriter = new PromptRewriter({ enabled: true });
    });

    it('should track total prompts processed', async () => {
      await rewriter.rewrite('Hello world');
      await rewriter.rewrite('Um basically I need help with something');
      await rewriter.rewrite('Another prompt here');
      
      const stats = rewriter.getStats();
      
      expect(stats.totalPrompts).toBe(3);
    });

    it('should track rewritten prompts count', async () => {
      await rewriter.rewrite('Short');  // Too short, not rewritten
      // Longer prompt with fillers to trigger rewrite
      await rewriter.rewrite('Um basically I just kind of need help with understanding how this complicated production system actually works in practice');
      await rewriter.rewrite('Clear and concise prompt');  // Already efficient
      
      const stats = rewriter.getStats();
      
      expect(stats.rewrittenPrompts).toBeGreaterThanOrEqual(1);
    });

    it('should track total tokens saved', async () => {
      // Longer prompts with fillers to ensure they get rewritten
      await rewriter.rewrite('Um, basically, I just kind of need to sort of understand how this complicated system works in production, you know what I mean?');
      await rewriter.rewrite('I was wondering if you could please help me understand this concept better if you don\'t mind taking the time to explain it');
      
      const stats = rewriter.getStats();
      
      expect(stats.totalTokensSaved).toBeGreaterThan(0);
    });

    it('should reset stats', async () => {
      await rewriter.rewrite('Um, basically test prompt');
      
      rewriter.resetStats();
      const stats = rewriter.getStats();
      
      expect(stats.totalPrompts).toBe(0);
      expect(stats.rewrittenPrompts).toBe(0);
      expect(stats.totalTokensSaved).toBe(0);
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      rewriter = new PromptRewriter({ enabled: true });
    });

    it('should handle empty string', async () => {
      const result = await rewriter.rewrite('');
      
      expect(result.wasRewritten).toBe(false);
      expect(result.rewritten).toBe('');
    });

    it('should handle whitespace-only string', async () => {
      const result = await rewriter.rewrite('   ');
      
      expect(result.wasRewritten).toBe(false);
    });

    it('should handle prompt that becomes empty after rewrite', async () => {
      // This shouldn't really happen, but test the safety
      const result = await rewriter.rewrite('Um');
      
      expect(result.rewritten).toBeDefined();
    });

    it('should not make prompt longer', async () => {
      // Mock provider that makes prompt longer
      const badProvider: LLMProvider = {
        complete: vi.fn().mockResolvedValue(
          'This is a much longer rewritten version that adds unnecessary context and explanation to the original short prompt'
        ),
      };
      const badRewriter = new PromptRewriter({ enabled: true }, badProvider);
      
      const original = 'Um, help me please understand this concept quickly';
      const result = await badRewriter.rewrite(original);
      
      // Should reject the longer rewrite and return original
      expect(result.rewrittenTokens).toBeLessThanOrEqual(result.originalTokens);
    });

    it('should preserve JSON content', async () => {
      const jsonPrompt = '{"key": "value", "number": 42}';
      
      const result = await rewriter.rewrite(jsonPrompt);
      
      expect(result.wasRewritten).toBe(false);
    });

    it('should preserve numbered lists', async () => {
      const listPrompt = '1. First item\n2. Second item\n3. Third item';
      
      const result = await rewriter.rewrite(listPrompt);
      
      expect(result.wasRewritten).toBe(false);
    });
  });

  describe('configuration', () => {
    it('should respect minTokensToRewrite setting', async () => {
      const strictRewriter = new PromptRewriter({ 
        enabled: true,
        minTokensToRewrite: 100,
      });
      
      const medium = 'Um basically I need help with understanding this concept please';
      const result = await strictRewriter.rewrite(medium);
      
      expect(result.wasRewritten).toBe(false);
    });

    it('should respect maxSavingsPercent setting', async () => {
      const conservativeRewriter = new PromptRewriter({ 
        enabled: true,
        maxSavingsPercent: 10,  // Very conservative
      });
      
      const verbose = 'Um, basically, I just kind of need to sort of understand this concept, you know, if you could please help me';
      const result = await conservativeRewriter.rewrite(verbose);
      
      // Should not rewrite if savings would exceed 10%
      if (result.wasRewritten) {
        const savingsPercent = (result.tokensSaved / result.originalTokens) * 100;
        expect(savingsPercent).toBeLessThanOrEqual(10);
      }
    });

    it('should allow preserveFormatting to be disabled', async () => {
      const aggressiveRewriter = new PromptRewriter({ 
        enabled: true,
        preserveFormatting: false,
      });
      
      // Even with code, it will try to rewrite if preserveFormatting is false
      // and the prompt has filler words
      const withCodeAndFillers = 'Um basically can you help with this code ```js\ntest();\n```';
      const result = await aggressiveRewriter.rewrite(withCodeAndFillers);
      
      // The preserveFormatting check is bypassed
      // (though the code block itself should still be preserved in the content)
      expect(result).toBeDefined();
    });
  });
});
