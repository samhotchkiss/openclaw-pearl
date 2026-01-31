/**
 * Sunrise Detector Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SunriseDetector } from '../src/sunrise/detector.js';
import type { TranscriptReader } from '../src/sunrise/transcript.js';

const createMockReader = () => ({
  readRecent: vi.fn(),
  getLastTimestamp: vi.fn(),
});

describe('SunriseDetector', () => {
  let detector: SunriseDetector;
  let mockReader: ReturnType<typeof createMockReader>;

  beforeEach(() => {
    mockReader = createMockReader();
  });

  describe('check', () => {
    it('should return needsRecovery=true when gap exceeds threshold', async () => {
      mockReader.getLastTimestamp.mockResolvedValue(Date.now() - 7200000);

      detector = new SunriseDetector({
        reader: mockReader as unknown as TranscriptReader,
        gapThresholdMs: 3600000,
      });

      const result = await detector.check('test-agent', 'test-session');
      expect(result.needsRecovery).toBe(true);
      expect(result.reason).toBe('gap');
    });

    it('should return needsRecovery=false when session is recent', async () => {
      mockReader.getLastTimestamp.mockResolvedValue(Date.now() - 600000);

      detector = new SunriseDetector({
        reader: mockReader as unknown as TranscriptReader,
        gapThresholdMs: 3600000,
      });

      const result = await detector.check('test-agent', 'test-session');
      expect(result.needsRecovery).toBe(false);
    });

    it('should return needsRecovery=true for new session', async () => {
      mockReader.getLastTimestamp.mockResolvedValue(null);

      detector = new SunriseDetector({
        reader: mockReader as unknown as TranscriptReader,
      });

      const result = await detector.check('test-agent', 'new-session');
      expect(result.needsRecovery).toBe(true);
      expect(result.reason).toBe('new_session');
    });

    it('should detect explicit forceSunrise', async () => {
      mockReader.getLastTimestamp.mockResolvedValue(Date.now() - 60000);

      detector = new SunriseDetector({
        reader: mockReader as unknown as TranscriptReader,
      });

      const result = await detector.check('test-agent', 'test-session', {
        forceSunrise: true,
      });
      expect(result.needsRecovery).toBe(true);
      expect(result.reason).toBe('forced');
    });

    it('should handle reader errors gracefully', async () => {
      mockReader.getLastTimestamp.mockRejectedValue(new Error('Read error'));

      detector = new SunriseDetector({
        reader: mockReader as unknown as TranscriptReader,
      });

      const result = await detector.check('test-agent', 'test-session');
      expect(result.needsRecovery).toBe(true);
      expect(result.reason).toBe('error');
    });
  });

  describe('session tracking', () => {
    it('should track recovered sessions', async () => {
      mockReader.getLastTimestamp.mockResolvedValue(Date.now() - 7200000);

      detector = new SunriseDetector({
        reader: mockReader as unknown as TranscriptReader,
        gapThresholdMs: 3600000,
      });

      const result1 = await detector.check('test-agent', 'test-session');
      expect(result1.needsRecovery).toBe(true);

      detector.markRecovered('test-agent', 'test-session');

      const result2 = await detector.check('test-agent', 'test-session');
      expect(result2.needsRecovery).toBe(false);
      expect(result2.reason).toBe('already_recovered');
    });

    it('should allow clearing recovered status', async () => {
      mockReader.getLastTimestamp.mockResolvedValue(Date.now() - 7200000);

      detector = new SunriseDetector({
        reader: mockReader as unknown as TranscriptReader,
        gapThresholdMs: 3600000,
      });

      detector.markRecovered('test-agent', 'test-session');
      detector.clearRecovered('test-agent', 'test-session');

      const result = await detector.check('test-agent', 'test-session');
      expect(result.needsRecovery).toBe(true);
    });
  });
});
