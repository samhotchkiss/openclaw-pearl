/**
 * Transcript Reader/Writer Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  TranscriptLogger,
  TranscriptReader,
  type TranscriptEntry,
} from '../src/sunrise/transcript.js';

vi.mock('fs/promises');

describe('TranscriptLogger', () => {
  const mockLogPath = '/tmp/test-transcripts';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.appendFile).mockResolvedValue(undefined);
  });

  it('should write message to JSONL file', async () => {
    const logger = new TranscriptLogger(mockLogPath);
    const entry: TranscriptEntry = {
      agentId: 'test-agent',
      sessionId: 'test-session',
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
    };

    await logger.log(entry);

    expect(fs.mkdir).toHaveBeenCalledWith(
      path.join(mockLogPath, 'test-agent'),
      { recursive: true }
    );
    expect(fs.appendFile).toHaveBeenCalled();
  });

  it('should handle errors gracefully', async () => {
    vi.mocked(fs.appendFile).mockRejectedValue(new Error('Write failed'));
    const logger = new TranscriptLogger(mockLogPath);
    const entry: TranscriptEntry = {
      agentId: 'test-agent',
      sessionId: 'test-session',
      role: 'user',
      content: 'Test',
      timestamp: Date.now(),
    };

    await expect(logger.log(entry)).resolves.not.toThrow();
  });
});

describe('TranscriptReader', () => {
  const mockLogPath = '/tmp/test-transcripts';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should read and parse JSONL file', async () => {
    const mockEntries = [
      { role: 'user', content: 'Hello', timestamp: Date.now() - 2000 },
      { role: 'assistant', content: 'Hi!', timestamp: Date.now() - 1000 },
    ];
    vi.mocked(fs.readFile).mockResolvedValue(
      mockEntries.map(e => JSON.stringify(e)).join('\n')
    );

    const reader = new TranscriptReader(mockLogPath);
    const messages = await reader.readRecent('test-agent', 'session-123');

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('Hello');
  });

  it('should return empty array if file not found', async () => {
    vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });

    const reader = new TranscriptReader(mockLogPath);
    const messages = await reader.readRecent('test-agent', 'nonexistent');

    expect(messages).toEqual([]);
  });

  it('should respect maxMessages limit', async () => {
    const mockEntries = [
      { role: 'user', content: 'Msg 1', timestamp: Date.now() - 3000 },
      { role: 'assistant', content: 'Reply 1', timestamp: Date.now() - 2000 },
      { role: 'user', content: 'Msg 2', timestamp: Date.now() - 1000 },
    ];
    vi.mocked(fs.readFile).mockResolvedValue(
      mockEntries.map(e => JSON.stringify(e)).join('\n')
    );

    const reader = new TranscriptReader(mockLogPath);
    const messages = await reader.readRecent('test-agent', 'session', { maxMessages: 2 });

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('Reply 1');
  });

  it('should return null for getLastTimestamp if no messages', async () => {
    vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });

    const reader = new TranscriptReader(mockLogPath);
    const timestamp = await reader.getLastTimestamp('test-agent', 'session');

    expect(timestamp).toBeNull();
  });
});
