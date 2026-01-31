/**
 * Sunrise Integration Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SunriseService } from '../src/sunrise/index.js';
import type { TranscriptReader } from '../src/sunrise/transcript.js';
import type { SunriseSummarizer, SessionSummary } from '../src/sunrise/summarizer.js';
import type { SunriseDetector } from '../src/sunrise/detector.js';

const createMockReader = () => ({
  readRecent: vi.fn(),
  getLastTimestamp: vi.fn(),
});

const createMockSummarizer = () => ({
  summarize: vi.fn(),
});

const createMockDetector = () => ({
  check: vi.fn(),
  markRecovered: vi.fn(),
  clearRecovered: vi.fn(),
});

describe('SunriseService', () => {
  describe('handleRequest', () => {
    it('should inject summary after gap', async () => {
      const mockSummary: SessionSummary = {
        timestamp: new Date().toISOString(),
        recentContext: 'Building API',
        progress: 'Completed endpoints',
        decisions: ['Using Express'],
        state: 'Active',
        nextSteps: ['Add validation'],
      };

      const mockReader = createMockReader();
      const mockSummarizer = createMockSummarizer();
      const mockDetector = createMockDetector();

      mockDetector.check.mockResolvedValue({ needsRecovery: true, reason: 'gap' });
      mockReader.readRecent.mockResolvedValue([
        { role: 'user', content: 'Build API', timestamp: Date.now() - 3600000 },
      ]);
      mockSummarizer.summarize.mockResolvedValue(mockSummary);

      const service = new SunriseService({
        reader: mockReader as unknown as TranscriptReader,
        summarizer: mockSummarizer as unknown as SunriseSummarizer,
        detector: mockDetector as unknown as SunriseDetector,
      });

      const result = await service.handleRequest('test-agent', 'test-session', [
        { role: 'user', content: 'Continue' },
      ]);

      expect(result.summaryInjected).toBe(true);
      expect(result.messages[0].content).toContain('Session Recovery');
      expect(mockDetector.markRecovered).toHaveBeenCalled();
    });

    it('should skip injection when no recovery needed', async () => {
      const mockReader = createMockReader();
      const mockSummarizer = createMockSummarizer();
      const mockDetector = createMockDetector();

      mockDetector.check.mockResolvedValue({ needsRecovery: false });

      const service = new SunriseService({
        reader: mockReader as unknown as TranscriptReader,
        summarizer: mockSummarizer as unknown as SunriseSummarizer,
        detector: mockDetector as unknown as SunriseDetector,
      });

      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const result = await service.handleRequest('test-agent', 'test-session', messages);

      expect(result.summaryInjected).toBe(false);
      expect(result.messages).toEqual(messages);
    });

    it('should cache summaries per session', async () => {
      const mockSummary: SessionSummary = {
        timestamp: new Date().toISOString(),
        recentContext: 'Cached',
        progress: 'Progress',
        decisions: [],
        state: 'active',
        nextSteps: [],
      };

      const mockReader = createMockReader();
      const mockSummarizer = createMockSummarizer();
      const mockDetector = createMockDetector();

      mockDetector.check.mockResolvedValue({ needsRecovery: true, reason: 'gap' });
      mockReader.readRecent.mockResolvedValue([]);
      mockSummarizer.summarize.mockResolvedValue(mockSummary);

      const service = new SunriseService({
        reader: mockReader as unknown as TranscriptReader,
        summarizer: mockSummarizer as unknown as SunriseSummarizer,
        detector: mockDetector as unknown as SunriseDetector,
      });

      await service.handleRequest('test-agent', 'test-session', [
        { role: 'user', content: 'First' },
      ]);

      mockDetector.check.mockResolvedValue({ needsRecovery: true, reason: 'forced' });

      await service.handleRequest('test-agent', 'test-session', [
        { role: 'user', content: 'Second' },
      ]);

      expect(mockSummarizer.summarize).toHaveBeenCalledTimes(1);
    });

    it('should prepend summary to existing system message', async () => {
      const mockSummary: SessionSummary = {
        timestamp: new Date().toISOString(),
        recentContext: 'API dev',
        progress: 'Auth done',
        decisions: [],
        state: 'active',
        nextSteps: [],
      };

      const mockReader = createMockReader();
      const mockSummarizer = createMockSummarizer();
      const mockDetector = createMockDetector();

      mockDetector.check.mockResolvedValue({ needsRecovery: true, reason: 'gap' });
      mockReader.readRecent.mockResolvedValue([]);
      mockSummarizer.summarize.mockResolvedValue(mockSummary);

      const service = new SunriseService({
        reader: mockReader as unknown as TranscriptReader,
        summarizer: mockSummarizer as unknown as SunriseSummarizer,
        detector: mockDetector as unknown as SunriseDetector,
      });

      const messages = [
        { role: 'system' as const, content: 'You are helpful.' },
        { role: 'user' as const, content: 'Hello' },
      ];

      const result = await service.handleRequest('test-agent', 'test-session', messages);

      expect(result.messages.length).toBe(2);
      expect(result.messages[0].content).toContain('Session Recovery');
      expect(result.messages[0].content).toContain('You are helpful.');
    });

    it('should handle summarizer returning null', async () => {
      const mockReader = createMockReader();
      const mockSummarizer = createMockSummarizer();
      const mockDetector = createMockDetector();

      mockDetector.check.mockResolvedValue({ needsRecovery: true, reason: 'gap' });
      mockReader.readRecent.mockResolvedValue([]);
      mockSummarizer.summarize.mockResolvedValue(null);

      const service = new SunriseService({
        reader: mockReader as unknown as TranscriptReader,
        summarizer: mockSummarizer as unknown as SunriseSummarizer,
        detector: mockDetector as unknown as SunriseDetector,
      });

      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const result = await service.handleRequest('test-agent', 'test-session', messages);

      expect(result.summaryInjected).toBe(false);
    });
  });
});
