import { describe, it, expect } from 'vitest';
import {
  ScopeDetector,
  type ScopeContext,
  type ScopeResult,
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
          global: ['for everyone', 'all agents should'],
          agent: ['just for me', 'only I should'],
        },
        channelMapping: {
          'main': 'global',
          'nova-work': 'agent:nova',
        },
        contentTypeWeights: {
          preference: { global: 0.8, agent: 0.2 },
          rule: { global: 0.3, agent: 0.7 },
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
      expect(result.confidence).toBeGreaterThan(0.9);
      expect(result.reasoning).toContain('explicit marker');
      expect(result.reasoning).toContain('for all agents');
    });

    it('detects global scope from "everyone should know" marker', () => {
      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'Everyone should know that Sam is allergic to nuts',
        'health',
        context
      );

      expect(result.scope).toBe('global');
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('detects agent scope from "just for Nova" marker', () => {
      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'Just for Nova: focus on AI research papers only',
        'rule',
        context
      );

      expect(result.scope).toBe('agent');
      expect(result.targetAgentId).toBe('nova');
      expect(result.confidence).toBeGreaterThan(0.9);
      expect(result.reasoning).toContain('explicit marker');
    });

    it('detects agent scope from "Tex should" marker', () => {
      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'Tex should always write in a casual tone',
        'rule',
        context
      );

      expect(result.scope).toBe('agent');
      expect(result.targetAgentId).toBe('tex');
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('handles case-insensitive agent names', () => {
      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'NOVA should track AI developments only',
        'rule',
        context
      );

      expect(result.scope).toBe('agent');
      expect(result.targetAgentId).toBe('nova');
    });
  });

  describe('detectScope() - channel context', () => {
    let detector: ScopeDetector;

    beforeEach(() => {
      detector = new ScopeDetector();
    });

    it('detects global scope for main DM channel', () => {
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
      expect(result.reasoning).toContain('main DM channel');
    });

    it('detects agent scope for project-specific channel', () => {
      const context: ScopeContext = {
        channel: 'nova-ai-updates',
        channelType: 'project',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'Always include the source URL in summaries',
        'rule',
        context
      );

      expect(result.scope).toBe('agent');
      expect(result.targetAgentId).toBe('nova');
      expect(result.confidence).toBeGreaterThan(0.6);
    });

    it('detects global scope for group chat', () => {
      const context: ScopeContext = {
        channel: 'family-chat',
        channelType: 'group',
        agentId: 'main',
      };

      const result = detector.detectScope(
        "Essie's birthday is August 18th",
        'fact',
        context
      );

      expect(result.scope).toBe('global');
      expect(result.confidence).toBeGreaterThan(0.6);
    });
  });

  describe('detectScope() - content type patterns', () => {
    let detector: ScopeDetector;

    beforeEach(() => {
      detector = new ScopeDetector();
    });

    it('favors global scope for personal facts', () => {
      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'Sam lives at 1000 Cordova Place, Santa Fe',
        'fact',
        context
      );

      expect(result.scope).toBe('global');
      expect(result.reasoning).toContain('personal facts typically global');
    });

    it('favors global scope for user preferences', () => {
      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'I prefer dark mode interfaces',
        'preference',
        context
      );

      expect(result.scope).toBe('global');
      expect(result.reasoning).toContain('user preferences typically global');
    });

    it('favors global scope for health information', () => {
      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'Sam is allergic to penicillin',
        'health',
        context
      );

      expect(result.scope).toBe('global');
      expect(result.reasoning).toContain('health information typically global');
    });

    it('favors global scope for relationship info', () => {
      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'Noah is 8 years old and goes to May Center',
        'relationship',
        context
      );

      expect(result.scope).toBe('global');
    });

    it('considers agent scope for task rules', () => {
      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'Always format code with 2-space indents',
        'rule',
        context
      );

      // Should be agent scope due to "code" workflow keyword mapping to main
      expect(result.scope).toBe('agent');
      expect(result.targetAgentId).toBe('main');
    });

    it('considers agent scope for workflow decisions', () => {
      const context: ScopeContext = {
        channel: 'tex-writing',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'Use casual tone for all blog posts',
        'decision',
        context
      );

      expect(result.scope).toBe('agent');
      expect(result.targetAgentId).toBe('tex');
    });
  });

  describe('detectScope() - content keywords', () => {
    let detector: ScopeDetector;

    beforeEach(() => {
      detector = new ScopeDetector();
    });

    it('detects agent scope from workflow keywords', () => {
      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'When writing blog posts, use subheadings',
        'rule',
        context
      );

      // Should favor agent scope due to "writing" keyword mapping to tex
      expect(result.scope).toBe('agent');
      expect(result.targetAgentId).toBe('tex');
      expect(result.reasoning).toContain('workflow keywords');
    });

    it('detects trading scope for financial keywords', () => {
      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'Never trade more than $500 per position',
        'rule',
        context
      );

      expect(result.scope).toBe('agent');
      expect(result.targetAgentId).toBe('trey');
      expect(result.reasoning).toContain('workflow keywords');
    });

    it('detects social media scope for posting keywords', () => {
      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'When posting to LinkedIn, always include insights',
        'rule',
        context
      );

      expect(result.scope).toBe('agent');
      expect(result.targetAgentId).toBe('linc');
      expect(result.reasoning).toContain('workflow keywords');
    });
  });

  describe('detectScope() - fallback and edge cases', () => {
    let detector: ScopeDetector;

    beforeEach(() => {
      detector = new ScopeDetector();
    });

    it('defaults to global for unclear cases', () => {
      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'This is a random fact about something',
        'fact',
        context
      );

      expect(result.scope).toBe('global');
      expect(result.confidence).toBeLessThan(0.7);
      expect(result.reasoning).toContain('default');
    });

    it('handles empty content gracefully', () => {
      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = detector.detectScope('', 'fact', context);

      expect(result.scope).toBe('global');
      expect(result.confidence).toBeLessThan(0.7);
    });

    it('handles unknown agent names', () => {
      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'UnknownAgent should do this task',
        'rule',
        context
      );

      // Should not set targetAgentId for unknown agents
      expect(result.scope).toBe('inferred');
      expect(result.targetAgentId).toBeUndefined();
    });

    it('combines multiple signals correctly', () => {
      const context: ScopeContext = {
        channel: 'nova-work',
        channelType: 'project',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'For all agents: when summarizing research, include methodology',
        'rule',
        context
      );

      // Explicit marker should override channel context
      expect(result.scope).toBe('global');
      expect(result.confidence).toBeGreaterThan(0.9);
    });
  });

  describe('updateRules()', () => {
    it('updates explicit markers', () => {
      const detector = new ScopeDetector();
      
      detector.updateRules({
        explicitMarkers: {
          global: ['custom global marker'],
          agent: ['custom agent marker'],
        },
      });

      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = detector.detectScope(
        'Custom global marker: test rule',
        'rule',
        context
      );

      expect(result.scope).toBe('global');
      expect(result.confidence).toBeGreaterThan(0.9);
    });

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

      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('assigns medium confidence for channel context', () => {
      const context: ScopeContext = {
        channel: 'main',
        channelType: 'dm',
        agentId: 'main',
      };

      const result = detector.detectScope('Test preference', 'preference', context);

      expect(result.confidence).toBeGreaterThan(0.6);
      expect(result.confidence).toBeLessThan(0.9);
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