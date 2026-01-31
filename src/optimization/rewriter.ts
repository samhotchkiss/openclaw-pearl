/**
 * Prompt Rewriter
 * Optimizes user prompts for clarity and token efficiency
 */

import type { ChatMessage } from '../types.js';

// Token estimation: ~4 chars per token
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export interface RewriteResult {
  original: string;
  rewritten: string;
  originalTokens: number;
  rewrittenTokens: number;
  tokensSaved: number;
  wasRewritten: boolean;
}

export interface RewriterStats {
  totalPrompts: number;
  rewrittenPrompts: number;
  totalTokensSaved: number;
  averageSavingsPercent: number;
}

export interface RewriterConfig {
  enabled: boolean;
  model?: string;
  minTokensToRewrite?: number;  // Don't rewrite prompts shorter than this
  maxSavingsPercent?: number;   // Cap to prevent over-aggressive rewrites
  preserveFormatting?: boolean; // Keep code blocks, lists, etc.
}

export interface LLMProvider {
  complete(prompt: string): Promise<string>;
}

const DEFAULT_CONFIG: Required<RewriterConfig> = {
  enabled: true,
  model: 'ollama/llama3.2:3b',
  minTokensToRewrite: 20,      // Don't rewrite short prompts
  maxSavingsPercent: 50,       // Don't reduce by more than 50%
  preserveFormatting: true,
};

const REWRITE_PROMPT = `Rewrite this user prompt to be clear and efficient for an AI model.
Rules:
- Preserve ALL information and intent
- Remove redundancy and filler words (um, like, you know, basically, etc.)
- Clarify ambiguous phrasing
- Be direct and specific
- Do NOT add information not present in the original
- Keep code blocks, URLs, and technical terms exactly as-is
- If the prompt is already efficient, return it unchanged

Original prompt:
"""
{prompt}
"""

Rewritten prompt (just the rewritten text, nothing else):`;

/**
 * Check if prompt contains content that should not be rewritten
 */
function hasPreservableContent(text: string): boolean {
  // Code blocks
  if (/```[\s\S]*?```/m.test(text)) return true;
  // Inline code
  if (/`[^`]+`/.test(text)) return true;
  // URLs
  if (/https?:\/\/[^\s]+/.test(text)) return true;
  // JSON
  if (/^\s*[{[]/.test(text)) return true;
  // Very structured content (numbered lists, etc.)
  if (/^\s*\d+\.\s/m.test(text)) return true;
  
  return false;
}

/**
 * Check if prompt is likely already efficient
 */
function isLikelyEfficient(text: string): boolean {
  const tokens = estimateTokens(text);
  
  // Very short prompts are already efficient
  if (tokens < 15) return true;
  
  // Calculate word-to-token ratio (efficient prompts have fewer filler words)
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const avgWordLen = words.reduce((sum, w) => sum + w.length, 0) / words.length;
  
  // High average word length suggests technical/specific content
  if (avgWordLen > 6) return true;
  
  // Check for filler word patterns
  const fillerPatterns = [
    /\bum\b/i, /\buh\b/i, /\blike\b/i, /\byou know\b/i,
    /\bbasically\b/i, /\bactually\b/i, /\breally\b/i,
    /\bjust\b/i, /\bkind of\b/i, /\bsort of\b/i,
    /\bi was wondering\b/i, /\bcould you please\b/i,
    /\bi would like\b/i, /\bif you don't mind\b/i,
  ];
  
  const hasFillers = fillerPatterns.some(p => p.test(text));
  return !hasFillers;
}

export class PromptRewriter {
  private config: Required<RewriterConfig>;
  private provider?: LLMProvider;
  private stats: RewriterStats;

  constructor(config: Partial<RewriterConfig> = {}, provider?: LLMProvider) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.provider = provider;
    this.stats = {
      totalPrompts: 0,
      rewrittenPrompts: 0,
      totalTokensSaved: 0,
      averageSavingsPercent: 0,
    };
  }

  /**
   * Rewrite a single prompt for efficiency
   */
  async rewrite(prompt: string): Promise<RewriteResult> {
    this.stats.totalPrompts++;
    
    const originalTokens = estimateTokens(prompt);
    
    // If disabled, pass through
    if (!this.config.enabled) {
      return this.passthrough(prompt, originalTokens);
    }

    // Don't rewrite very short prompts
    if (originalTokens < this.config.minTokensToRewrite) {
      return this.passthrough(prompt, originalTokens);
    }

    // Don't rewrite prompts with code/URLs/structured content
    if (this.config.preserveFormatting && hasPreservableContent(prompt)) {
      return this.passthrough(prompt, originalTokens);
    }

    // Don't rewrite already-efficient prompts
    if (isLikelyEfficient(prompt)) {
      return this.passthrough(prompt, originalTokens);
    }

    // No provider configured, use heuristic rewriting
    if (!this.provider) {
      return this.heuristicRewrite(prompt, originalTokens);
    }

    // Use LLM for intelligent rewriting
    try {
      const rewritten = await this.llmRewrite(prompt);
      return this.createResult(prompt, rewritten, originalTokens);
    } catch (error) {
      // Fall back to heuristic on error
      console.error('LLM rewrite failed, using heuristic:', error);
      return this.heuristicRewrite(prompt, originalTokens);
    }
  }

  /**
   * Rewrite the last user message in a conversation
   */
  async rewriteMessages(messages: ChatMessage[]): Promise<{
    messages: ChatMessage[];
    result?: RewriteResult;
  }> {
    if (!this.config.enabled) {
      return { messages };
    }

    // Find the last user message (iterate backwards for compatibility)
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx === -1) {
      return { messages };
    }

    const userMessage = messages[lastUserIdx];
    const result = await this.rewrite(userMessage.content);

    if (!result.wasRewritten) {
      return { messages };
    }

    // Create new messages array with rewritten content
    const newMessages = [...messages];
    newMessages[lastUserIdx] = {
      ...userMessage,
      content: result.rewritten,
    };

    return { messages: newMessages, result };
  }

  /**
   * Get rewriter statistics
   */
  getStats(): RewriterStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalPrompts: 0,
      rewrittenPrompts: 0,
      totalTokensSaved: 0,
      averageSavingsPercent: 0,
    };
  }

  private passthrough(prompt: string, tokens: number): RewriteResult {
    return {
      original: prompt,
      rewritten: prompt,
      originalTokens: tokens,
      rewrittenTokens: tokens,
      tokensSaved: 0,
      wasRewritten: false,
    };
  }

  private createResult(original: string, rewritten: string, originalTokens: number): RewriteResult {
    const rewrittenTokens = estimateTokens(rewritten);
    let tokensSaved = originalTokens - rewrittenTokens;
    
    // Don't allow negative savings (rewrite made it longer)
    if (tokensSaved < 0) {
      return this.passthrough(original, originalTokens);
    }

    // Cap savings to prevent over-aggressive rewrites
    const savingsPercent = (tokensSaved / originalTokens) * 100;
    if (savingsPercent > this.config.maxSavingsPercent) {
      // Rewrite was too aggressive, might have lost meaning
      return this.passthrough(original, originalTokens);
    }

    // Update stats
    this.stats.rewrittenPrompts++;
    this.stats.totalTokensSaved += tokensSaved;
    this.stats.averageSavingsPercent = 
      (this.stats.totalTokensSaved / (this.stats.rewrittenPrompts * originalTokens)) * 100;

    return {
      original,
      rewritten,
      originalTokens,
      rewrittenTokens,
      tokensSaved,
      wasRewritten: tokensSaved > 0,
    };
  }

  private async llmRewrite(prompt: string): Promise<string> {
    if (!this.provider) {
      throw new Error('No LLM provider configured');
    }

    const rewritePrompt = REWRITE_PROMPT.replace('{prompt}', prompt);
    const response = await this.provider.complete(rewritePrompt);
    
    // Clean up the response
    return response.trim();
  }

  private heuristicRewrite(prompt: string, originalTokens: number): RewriteResult {
    let rewritten = prompt;

    // Remove common filler phrases
    const fillerRemovals: [RegExp, string][] = [
      [/\b(um|uh)\b/gi, ''],
      [/\byou know\b/gi, ''],
      [/\blike\b(?!\s+this|\s+that|\s+to)/gi, ''],
      [/\bbasically\b/gi, ''],
      [/\bactually\b/gi, ''],
      [/\bjust\b(?!\s+in\s+case)/gi, ''],
      [/\bkind of\b/gi, ''],
      [/\bsort of\b/gi, ''],
      [/\bi was wondering if\b/gi, ''],
      [/\bcould you please\b/gi, 'please'],
      [/\bwould you mind\b/gi, 'please'],
      [/\bi would like you to\b/gi, ''],
      [/\bif you don't mind\b/gi, ''],
      [/\bif that's okay\b/gi, ''],
      [/\bif possible\b/gi, ''],
      [/\bI think\b(?!\s+that)/gi, ''],
      [/\bI believe\b(?!\s+that)/gi, ''],
      [/\bI guess\b/gi, ''],
      [/\bI mean\b/gi, ''],
    ];

    for (const [pattern, replacement] of fillerRemovals) {
      rewritten = rewritten.replace(pattern, replacement);
    }

    // Normalize whitespace
    rewritten = rewritten.replace(/\s+/g, ' ').trim();
    
    // Remove duplicate punctuation
    rewritten = rewritten.replace(/([.!?])\s*\1+/g, '$1');

    return this.createResult(prompt, rewritten, originalTokens);
  }
}
