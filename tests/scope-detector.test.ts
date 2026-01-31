import { describe, it, expect, beforeEach } from 'vitest';
import {
  ScopeDetector,
  type ScopeContext,
  type ScopeRules,
} from '../src/memory/scope-detector.js';

describe('ScopeDetector', () => {
  describe('construction', () => {
    it('creates with default rules', () => {
      const detector = new ScopeDetector();
      expect(detector).toBeDefined();
    });

    it('creates with custom rules', () => {
      const customRules: ScopeRules = {
        explicitMarkers: {
          global: ['for everyone'],
          agent: ['just for me'],
        },
      };

      const detector = new ScopeDetector(customRules);
      expect(detector).toBeDefined();
    });
  });

  describe('detectScope() - explicit markers', () => {
    let detector: ScopeDetector;

    beforeEach(() => {
      detector = new ScopeDetector();
    });

    it('detects global scope from "for all agents" marker', () => {
      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'For all agents: always use proper grammar',
        'rule',
        context
      );

      expect(result.scope).toBe('global');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.reasoning).toContain('explicit marker');
      expect(result.reasoning).toContain('for all agents');
    });

    it('detects agent scope from "Tex should" marker', () => {
      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'Tex should always use casual tone',
        'rule',
        context
      );

      expect(result.scope).toBe('agent');
      expect(result.targetAgentId).toBe('tex');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe('detectScope() - content type patterns', () => {
    let detector: ScopeDetector;

    beforeEach(() => {
      detector = new ScopeDetector();
    });

    it('favors global scope for user preferences', () => {
      const context: ScopeContext = {
        channel: 'main',
        channelType: 'dm',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'I prefer concise responses',
        'preference',
        context
      );

      expect(result.scope).toBe('global');
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.reasoning).toContain('user preferences typically global');
    });

    it('handles empty content gracefully', () => {
      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = detector.detectScope('', 'fact', context);

      expect(result.scope).toBe('global');
      expect(result.confidence).toBeLessThan(0.5);
      expect(result.reasoning).toContain('empty content');
    });
  });

  describe('updateRules()', () => {
    it('updates channel mappings', () => {
      const detector = new ScopeDetector();
      
      detector.updateRules({
        channelMapping: {
          'custom-channel': 'agent:custom',
        },
      });

      const context: ScopeContext = {
        channel: 'custom-channel',
        agentId: 'main',
      };

      const result = detector.detectScope('Test rule', 'rule', context);

      expect(result.scope).toBe('agent');
      expect(result.targetAgentId).toBe('custom');
    });
  });

  describe('confidence scoring', () => {
    let detector: ScopeDetector;

    beforeEach(() => {
      detector = new ScopeDetector();
    });

    it('assigns high confidence for explicit markers', () => {
      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'For all agents: test rule',
        'rule',
        context
      );

      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('assigns medium confidence for channel context', () => {
      const context: ScopeContext = {
        channel: 'main',
        channelType: 'dm',
        agentId: 'main',
      };

      const result = detector.detectScope('Test preference', 'preference', context);

      expect(result.confidence).toBeGreaterThan(0.6);
      expect(result.confidence).toBeLessThanOrEqual(0.9);
    });

    it('assigns lower confidence for content type only', () => {
      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = detector.detectScope('Random fact', 'fact', context);

      expect(result.confidence).toBeLessThan(0.7);
    });
  });
});