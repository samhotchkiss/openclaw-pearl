/**
 * Pearl Sunrise Detector
 */

import type { TranscriptReader } from './transcript.js';

export interface SunriseCheckResult {
  needsRecovery: boolean;
  reason?: 'gap' | 'new_session' | 'forced' | 'already_recovered' | 'error';
  gapMs?: number;
}

export interface SunriseCheckOptions {
  forceSunrise?: boolean;
}

export interface SunriseDetectorConfig {
  reader: TranscriptReader;
  gapThresholdMs?: number;
}

const DEFAULT_GAP_THRESHOLD_MS = 3600000;

export class SunriseDetector {
  private reader: TranscriptReader;
  private gapThresholdMs: number;
  private recoveredSessions: Set<string> = new Set();

  constructor(config: SunriseDetectorConfig) {
    this.reader = config.reader;
    this.gapThresholdMs = config.gapThresholdMs ?? DEFAULT_GAP_THRESHOLD_MS;
  }

  async check(
    agentId: string,
    sessionId: string,
    options: SunriseCheckOptions = {}
  ): Promise<SunriseCheckResult> {
    const sessionKey = `${agentId}:${sessionId}`;

    if (options.forceSunrise) {
      return { needsRecovery: true, reason: 'forced' };
    }

    if (this.recoveredSessions.has(sessionKey)) {
      return { needsRecovery: false, reason: 'already_recovered' };
    }

    try {
      const lastTimestamp = await this.reader.getLastTimestamp(agentId, sessionId);

      if (lastTimestamp === null) {
        return { needsRecovery: true, reason: 'new_session' };
      }

      const gapMs = Date.now() - lastTimestamp;
      if (gapMs > this.gapThresholdMs) {
        return { needsRecovery: true, reason: 'gap', gapMs };
      }

      return { needsRecovery: false };
    } catch (error) {
      console.error('[SunriseDetector] Error checking session:', error);
      return { needsRecovery: true, reason: 'error' };
    }
  }

  markRecovered(agentId: string, sessionId: string): void {
    this.recoveredSessions.add(`${agentId}:${sessionId}`);
  }

  clearRecovered(agentId: string, sessionId: string): void {
    this.recoveredSessions.delete(`${agentId}:${sessionId}`);
  }

  clearAllRecovered(): void {
    this.recoveredSessions.clear();
  }

  isRecovered(agentId: string, sessionId: string): boolean {
    return this.recoveredSessions.has(`${agentId}:${sessionId}`);
  }

  getRecoveredSessions(): string[] {
    return Array.from(this.recoveredSessions);
  }

  setGapThreshold(ms: number): void {
    this.gapThresholdMs = ms;
  }
}
