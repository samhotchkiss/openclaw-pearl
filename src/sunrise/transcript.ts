/**
 * Pearl Transcript Logger and Reader
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface TranscriptEntry {
  agentId: string;
  sessionId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  messageId?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface TranscriptMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  messageId?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface ReadOptions {
  maxMessages?: number;
  lookbackMs?: number;
}

export class TranscriptLogger {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async log(entry: TranscriptEntry): Promise<void> {
    try {
      const dirPath = path.join(this.basePath, entry.agentId);
      const filePath = path.join(dirPath, `${entry.sessionId}.jsonl`);
      await fs.mkdir(dirPath, { recursive: true });
      const line = JSON.stringify(entry) + '\n';
      await fs.appendFile(filePath, line);
    } catch (error) {
      console.error('[TranscriptLogger] Failed to log entry:', error);
    }
  }

  async logBatch(entries: TranscriptEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.log(entry);
    }
  }
}

export class TranscriptReader {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async readRecent(
    agentId: string,
    sessionId: string,
    options: ReadOptions = {}
  ): Promise<TranscriptMessage[]> {
    const { maxMessages, lookbackMs } = options;
    const filePath = path.join(this.basePath, agentId, `${sessionId}.jsonl`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.trim());
      
      let messages: TranscriptMessage[] = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as TranscriptEntry;
          messages.push({
            role: entry.role,
            content: entry.content,
            timestamp: entry.timestamp,
            messageId: entry.messageId,
            model: entry.model,
            metadata: entry.metadata,
          });
        } catch {
          continue;
        }
      }

      if (lookbackMs !== undefined) {
        const cutoff = Date.now() - lookbackMs;
        messages = messages.filter(m => m.timestamp >= cutoff);
      }

      if (maxMessages !== undefined && messages.length > maxMessages) {
        messages = messages.slice(-maxMessages);
      }

      return messages;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async getLastTimestamp(
    agentId: string,
    sessionId: string
  ): Promise<number | null> {
    const messages = await this.readRecent(agentId, sessionId, { maxMessages: 1 });
    if (messages.length === 0) return null;
    return messages[messages.length - 1].timestamp;
  }

  async listSessions(agentId: string): Promise<string[]> {
    const dirPath = path.join(this.basePath, agentId);
    try {
      const files = await fs.readdir(dirPath);
      return files.filter(f => f.endsWith('.jsonl')).map(f => f.slice(0, -6));
    } catch (error: any) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
}
