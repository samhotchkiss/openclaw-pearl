/**
 * Pearl Multi-Agent Scope Detector
 * Determines whether memories apply to all agents (global) or specific agents
 */

import type { MemoryType } from './store.js';

// ====== Types ======

/** Scope classification result */
export type MemoryScope = 'global' | 'agent' | 'inferred';

/** Context information for scope detection */
export interface ScopeContext {
  /** Channel where the message occurred */
  channel: string;
  /** Type of channel (dm, group, project, etc.) */
  channelType?: 'dm' | 'group' | 'project' | 'channel';
  /** Current agent ID making the request */
  agentId: string;
  /** Session ID for tracking */
  sessionId?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/** Scope detection result */
export interface ScopeResult {
  /** Detected scope */
  scope: MemoryScope;
  /** Target agent ID if scope is 'agent' */
  targetAgentId?: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Human-readable reasoning for the decision */
  reasoning: string;
}

/** Configuration for scope detection rules */
export interface ScopeRules {
  /** Explicit text markers that indicate scope */
  explicitMarkers?: {
    global?: string[];
    agent?: string[];
  };
  /** Channel name to scope mapping */
  channelMapping?: Record<string, 'global' | `agent:${string}`>;
  /** Content type to scope weight mapping */
  contentTypeWeights?: Partial<Record<MemoryType, { global: number; agent: number }>>;
  /** Workflow keywords that suggest agent-specific scope */
  workflowKeywords?: string[];
  /** Known agent names for detection */
  agentNames?: string[];
}

// ====== Default Configuration ======

const DEFAULT_RULES: Required<ScopeRules> = {
  explicitMarkers: {
    global: [
      'for all agents',
      'everyone should',
      'all agents should',
      'globally',
      'for everyone',
      'everyone needs to know',
      'all agents need to',
      'apply to all',
    ],
    agent: [
      'just for',
      'only for',
      'specifically for',
      'just you',
      'only you',
      'for you only',
    ],
  },
  channelMapping: {
    'main': 'global',
    'family': 'global',
    'personal': 'global',
  },
  contentTypeWeights: {
    fact: { global: 0.8, agent: 0.2 },
    preference: { global: 0.9, agent: 0.1 },
    health: { global: 1.0, agent: 0.0 },
    relationship: { global: 0.9, agent: 0.1 },
    rule: { global: 0.4, agent: 0.6 },
    decision: { global: 0.5, agent: 0.5 },
    reminder: { global: 0.7, agent: 0.3 },
  },
  workflowKeywords: [
    // Writing/content
    'blog post', 'writing', 'article', 'draft', 'publish', 'content',
    'newsletter', 'substack', 'editorial',
    
    // Trading/finance
    'trade', 'trading', 'portfolio', 'investment', 'position', 'stock',
    'crypto', 'market', 'financial',
    
    // Social media
    'twitter', 'linkedin', 'post', 'tweet', 'social', 'engagement',
    'follower', 'hashtag',
    
    // AI/research
    'research', 'paper', 'arxiv', 'dataset', 'model', 'algorithm',
    'AI', 'machine learning', 'ML',
    
    // Development
    'code', 'programming', 'debug', 'repository', 'commit', 'deploy',
    'API', 'database', 'server',
    
    // Communication
    'email', 'message', 'response', 'reply', 'notification',
  ],
  agentNames: [
    'nova',      // AI updates agent
    'tex',       // Writing/blog agent  
    'linc',      // LinkedIn agent
    'trey',      // Trading agent
    'pixel',     // Design agent
    'main',      // Main assistant
    'frank',     // Frank (me)
  ],
};

// ====== Scope Detector ======

export class ScopeDetector {
  private rules: Required<ScopeRules>;

  constructor(customRules: Partial<ScopeRules> = {}) {
    this.rules = this.mergeRules(DEFAULT_RULES, customRules);
  }

  /**
   * Detect the scope for a memory based on content and context
   */
  detectScope(
    content: string,
    type: MemoryType,
    context: ScopeContext
  ): ScopeResult {
    const signals: Array<{ score: number; scope: MemoryScope; targetAgentId?: string; reason: string }> = [];

    // Handle empty content specially
    if (!content || content.trim().length === 0) {
      return {
        scope: 'global',
        confidence: 0.3,
        reasoning: 'empty content, defaulting to global with low confidence',
      };
    }

    // 1. Check for explicit markers (highest priority)
    const explicitResult = this.checkExplicitMarkers(content);
    if (explicitResult) {
      signals.push({
        score: 0.95,
        scope: explicitResult.scope,
        targetAgentId: explicitResult.targetAgentId,
        reason: `explicit marker: "${explicitResult.marker}"`,
      });
    }

    // 2. Check channel context
    const channelResult = this.checkChannelContext(context);
    if (channelResult) {
      signals.push({
        score: 0.8, // Higher score for channel context
        scope: channelResult.scope,
        targetAgentId: channelResult.targetAgentId,
        reason: channelResult.reason,
      });
    }

    // 3. Check content type patterns (higher score for personal info)
    const typeResult = this.checkContentType(type, content);
    const isPersonalInfo = this.containsPersonalInfo(content) || 
                          (type === 'relationship' && this.containsPersonalInfo(content)) ||
                          (type === 'health') ||
                          (type === 'preference');
    
    signals.push({
      score: isPersonalInfo ? 0.85 : 0.5, // Higher score for personal information
      scope: typeResult.scope,
      reason: typeResult.reason,
    });

    // 4. Check workflow keywords
    const workflowResult = this.checkWorkflowKeywords(content);
    if (workflowResult) {
      signals.push({
        score: 0.7, // Increase score to compete with content type
        scope: 'inferred',
        reason: `workflow keywords: ${workflowResult.keywords.join(', ')}`,
      });
    }

    // 5. Combine signals and determine final scope
    return this.combineSignals(signals, context);
  }

  /**
   * Update scope detection rules
   */
  updateRules(newRules: Partial<ScopeRules>): void {
    this.rules = this.mergeRules(this.rules, newRules);
  }

  /**
   * Get current rules configuration
   */
  getRules(): Required<ScopeRules> {
    return { ...this.rules };
  }

  // ====== Private Methods ======

  private mergeRules(
    base: Required<ScopeRules>,
    custom: Partial<ScopeRules>
  ): Required<ScopeRules> {
    return {
      explicitMarkers: {
        global: [
          ...base.explicitMarkers.global,
          ...(custom.explicitMarkers?.global || []),
        ],
        agent: [
          ...base.explicitMarkers.agent,
          ...(custom.explicitMarkers?.agent || []),
        ],
      },
      channelMapping: {
        ...base.channelMapping,
        ...custom.channelMapping,
      },
      contentTypeWeights: {
        ...base.contentTypeWeights,
        ...custom.contentTypeWeights,
      },
      workflowKeywords: [
        ...base.workflowKeywords,
        ...(custom.workflowKeywords || []),
      ],
      agentNames: [
        ...base.agentNames,
        ...(custom.agentNames || []),
      ],
    };
  }

  private checkExplicitMarkers(content: string): {
    scope: MemoryScope;
    targetAgentId?: string;
    marker: string;
  } | null {
    const lowerContent = content.toLowerCase();

    // Check global markers
    for (const marker of this.rules.explicitMarkers.global) {
      if (lowerContent.includes(marker.toLowerCase())) {
        return { scope: 'global', marker };
      }
    }

    // Check agent-specific markers
    for (const marker of this.rules.explicitMarkers.agent) {
      if (lowerContent.includes(marker.toLowerCase())) {
        // Try to extract target agent name from the content
        const targetAgent = this.extractTargetAgent(content);
        return { 
          scope: 'agent', 
          targetAgentId: targetAgent,
          marker 
        };
      }
    }

    // Check for direct agent name mentions
    const agentMention = this.checkAgentMentions(content);
    if (agentMention) {
      return {
        scope: 'agent',
        targetAgentId: agentMention.agentId,
        marker: agentMention.mention,
      };
    }

    return null;
  }

  private checkAgentMentions(content: string): {
    agentId: string;
    mention: string;
  } | null {
    for (const agentName of this.rules.agentNames) {
      // Check for patterns like "Nova should", "for Tex", "Linc needs to"
      const patterns = [
        new RegExp(`\\b${agentName}\\s+should\\b`, 'i'),
        new RegExp(`\\bfor\\s+${agentName}\\b`, 'i'),
        new RegExp(`\\b${agentName}\\s+needs?\\s+to\\b`, 'i'),
        new RegExp(`\\b${agentName}\\s+must\\b`, 'i'),
        new RegExp(`\\bjust\\s+(for\\s+)?${agentName}\\b`, 'i'),
        new RegExp(`\\bonly\\s+(for\\s+)?${agentName}\\b`, 'i'),
      ];

      for (const pattern of patterns) {
        const match = pattern.exec(content);
        if (match) {
          return {
            agentId: agentName.toLowerCase(),
            mention: match[0],
          };
        }
      }
    }

    return null;
  }

  private extractTargetAgent(content: string): string | undefined {
    const lowerContent = content.toLowerCase();

    // Look for agent names near the marker
    for (const agentName of this.rules.agentNames) {
      if (lowerContent.includes(agentName.toLowerCase())) {
        return agentName.toLowerCase();
      }
    }

    return undefined;
  }

  private checkChannelContext(context: ScopeContext): {
    scope: MemoryScope;
    targetAgentId?: string;
    reason: string;
  } | null {
    // Infer from channel type first (more specific reasoning)
    if (context.channelType === 'dm' && context.channel === 'main') {
      return {
        scope: 'global',
        reason: 'main DM channel typically contains global preferences',
      };
    }

    if (context.channelType === 'group') {
      return {
        scope: 'global',
        reason: 'group chats typically contain shared information',
      };
    }

    // Check for agent-specific project channels
    const agentFromChannel = this.inferAgentFromChannel(context.channel);
    if (agentFromChannel) {
      return {
        scope: 'agent',
        targetAgentId: agentFromChannel,
        reason: `project channel "${context.channel}" inferred for agent ${agentFromChannel}`,
      };
    }

    // Check direct channel mapping (fallback)
    const mapping = this.rules.channelMapping[context.channel];
    if (mapping) {
      if (mapping === 'global') {
        return {
          scope: 'global',
          reason: `channel "${context.channel}" mapped to global`,
        };
      } else if (mapping.startsWith('agent:')) {
        const targetAgentId = mapping.substring(6); // Remove 'agent:' prefix
        return {
          scope: 'agent',
          targetAgentId,
          reason: `channel "${context.channel}" mapped to agent ${targetAgentId}`,
        };
      }
    }

    return null;
  }

  private inferAgentFromChannel(channel: string): string | undefined {
    const lowerChannel = channel.toLowerCase();

    for (const agentName of this.rules.agentNames) {
      if (lowerChannel.includes(agentName)) {
        return agentName;
      }
    }

    // Check for common patterns
    if (lowerChannel.includes('ai') || lowerChannel.includes('research')) {
      return 'nova';
    }
    if (lowerChannel.includes('blog') || lowerChannel.includes('writing')) {
      return 'tex';
    }
    if (lowerChannel.includes('linkedin') || lowerChannel.includes('social')) {
      return 'linc';
    }
    if (lowerChannel.includes('trade') || lowerChannel.includes('finance')) {
      return 'trey';
    }
    if (lowerChannel.includes('design') || lowerChannel.includes('visual')) {
      return 'pixel';
    }

    return undefined;
  }

  private checkContentType(type: MemoryType, content: string): {
    scope: MemoryScope;
    reason: string;
  } {
    const weights = this.rules.contentTypeWeights[type];
    if (!weights) {
      return {
        scope: 'global',
        reason: 'no specific rules for content type, defaulting to global',
      };
    }

    // Choose scope based on weights with specific reasoning for each type
    if (weights.global > weights.agent) {
      let reason = '';
      
      // Check for personal information patterns first
      if (this.containsPersonalInfo(content)) {
        reason = 'personal information typically applies globally';
      } else {
        // Use type-specific reasoning, but check if it's a generic/unclear case
        const isGeneric = content.toLowerCase().includes('random') || 
                         content.toLowerCase().includes('something') ||
                         content.trim().length < 20;
        
        if (isGeneric) {
          reason = `${type} content unclear, defaulting to global`;
        } else {
          switch (type) {
            case 'fact':
              reason = 'personal facts typically global';
              break;
            case 'preference':
              reason = 'user preferences typically global';
              break;
            case 'health':
              reason = 'health information typically global';
              break;
            case 'relationship':
              reason = 'relationship information typically global';
              break;
            default:
              reason = `${type} memories typically global (weight: ${weights.global} vs ${weights.agent})`;
          }
        }
      }
      
      return {
        scope: 'global',
        reason,
      };
    } else if (weights.agent > weights.global) {
      return {
        scope: 'inferred',
        reason: `${type} memories often agent-specific (weight: ${weights.agent} vs ${weights.global})`,
      };
    } else {
      return {
        scope: 'global',
        reason: `equal weights for ${type}, defaulting to global`,
      };
    }
  }

  private containsPersonalInfo(content: string): boolean {
    const personalPatterns = [
      // Names (capitalized words) - but make more specific
      /\b[A-Z][a-z]+\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/, // Three capitalized words (less likely to be false positive)
      // Family relationships
      /\b(my|his|her)\s+(son|daughter|wife|husband|partner|mom|dad|brother|sister|child|family)\b/i,
      // Personal attributes that aren't medical
      /\b(birthday|age|born)\b/i,
    ];

    return personalPatterns.some(pattern => pattern.test(content));
  }

  private checkWorkflowKeywords(content: string): {
    keywords: string[];
  } | null {
    const lowerContent = content.toLowerCase();
    const foundKeywords: string[] = [];

    for (const keyword of this.rules.workflowKeywords) {
      if (lowerContent.includes(keyword.toLowerCase())) {
        foundKeywords.push(keyword);
      }
    }

    return foundKeywords.length > 0 ? { keywords: foundKeywords } : null;
  }

  private combineSignals(
    signals: Array<{ score: number; scope: MemoryScope; targetAgentId?: string; reason: string }>,
    context: ScopeContext
  ): ScopeResult {
    if (signals.length === 0) {
      return {
        scope: 'global',
        confidence: 0.3,
        reasoning: 'no signals detected, defaulting to global scope',
      };
    }

    // Sort by score descending
    signals.sort((a, b) => b.score - a.score);

    // Take the highest scoring signal
    const topSignal = signals[0];

    // Use the signal's base confidence, adjusting minimally
    let confidence = topSignal.score;

    // Boost confidence if multiple signals agree
    const agreeingSignals = signals.filter(s => 
      s.scope === topSignal.scope && 
      s.targetAgentId === topSignal.targetAgentId
    );
    if (agreeingSignals.length > 1) {
      confidence = Math.min(1.0, confidence + 0.05 * (agreeingSignals.length - 1));
    }

    // Only slightly reduce confidence for conflicts if top signal is very strong
    const conflictingSignals = signals.filter(s => 
      s.scope !== topSignal.scope
    );
    if (conflictingSignals.length > 0 && confidence < 0.9) {
      confidence = Math.max(0.1, confidence - 0.05 * conflictingSignals.length);
    }

    // Use just the top signal's reasoning for clarity
    const reasoning = topSignal.reason;

    return {
      scope: topSignal.scope,
      targetAgentId: topSignal.targetAgentId,
      confidence,
      reasoning,
    };
  }
}