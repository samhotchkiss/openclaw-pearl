/**
 * Sunrise Summarizer Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SunriseSummarizer,
  formatSummary,
  type SessionSummary,
  type SummaryProvider,
} from '../src/sunrise/summarizer.js';
import type { TranscriptMessage } from '../src/sunrise/transcript.js';

const createMockProvider = (): { summarize: ReturnType<typeof vi.fn> } => ({
  summarize: vi.fn(),
});

describe('SunriseSummarizer', () => {
  let summarizer: SunriseSummarizer;
  let mockProvider: ReturnType<typeof createMockProvider>;

  beforeEach(() => {
    mockProvider = createMockProvider();
  });

  describe('summarize', () => {
    it('should generate summary from transcript messages', async () => {
      const mockSummary: SessionSummary = {
        timestamp: new Date().toISOString(),
        recentContext: 'Working on user authentication',
        progress: 'Completed login form',
        decisions: ['Using JWT tokens'],
        state: 'Waiting for API keys',
        nextSteps: ['Implement OAuth'],
      };

      mockProvider.summarize.mockResolvedValue(mockSummary);
      summarizer = new SunriseSummarizer({ provider: mockProvider as unknown as SummaryProvider });

      const messages: TranscriptMessage[] = [
        { role: 'user', content: 'Implement auth', timestamp: Date.now() - 3600000 },
        { role: 'assistant', content: 'Starting with login form', timestamp: Date.now() - 3500000 },
      ];

      const result = await summarizer.summarize(messages);

      expect(result).not.toBeNull();
      expect(result?.recentContext).toBe(mockSummary.recentContext);
      expect(mockProvider.summarize).toHaveBeenCalledWith(messages);
    });

    it('should return null for empty transcript', async () => {
      summarizer = new SunriseSummarizer({ provider: mockProvider as unknown as SummaryProvider });
      const result = await summarizer.summarize([]);
      expect(result).toBeNull();
    });

    it('should return null if transcript is too short', async () => {
      summarizer = new SunriseSummarizer({ 
        provider: mockProvider as unknown as SummaryProvider,
        minMessages: 4,
      });

      const messages: TranscriptMessage[] = [
        { role: 'user', content: 'Hello', timestamp: Date.now() },
      ];

      const result = await summarizer.summarize(messages);
      expect(result).toBeNull();
    });

    it('should handle provider errors gracefully', async () => {
      mockProvider.summarize.mockRejectedValue(new Error('API error'));
      summarizer = new SunriseSummarizer({ provider: mockProvider as unknown as SummaryProvider, minMessages: 1 });

      const messages: TranscriptMessage[] = [
        { role: 'user', content: 'Test message', timestamp: Date.now() },
      ];

      const result = await summarizer.summarize(messages);
      expect(result).toBeNull();
    });
  });
});

describe('formatSummary', () => {
  it('should format summary as markdown', () => {
    const summary: SessionSummary = {
      timestamp: '2025-01-28T10:00:00Z',
      recentContext: 'Working on auth',
      progress: 'Login form completed',
      decisions: ['Use JWT tokens'],
      state: 'Waiting for keys',
      nextSteps: ['Add OAuth'],
    };

    const formatted = formatSummary(summary);

    expect(formatted).toContain('## Session Recovery');
    expect(formatted).toContain('Working on auth');
    expect(formatted).toContain('Use JWT tokens');
  });

  it('should handle empty decisions', () => {
    const summary: SessionSummary = {
      timestamp: '2025-01-28T10:00:00Z',
      recentContext: 'Starting',
      progress: 'Just began',
      decisions: [],
      state: 'active',
      nextSteps: ['Continue'],
    };

    const formatted = formatSummary(summary);
    expect(formatted).toContain('**Decisions:** None recorded');
  });

  it('should handle empty next steps', () => {
    const summary: SessionSummary = {
      timestamp: '2025-01-28T10:00:00Z',
      recentContext: 'Done',
      progress: 'Completed',
      decisions: ['Done'],
      state: 'complete',
      nextSteps: [],
    };

    const formatted = formatSummary(summary);
    expect(formatted).toContain('**Next:** Resume where left off');
  });
});
