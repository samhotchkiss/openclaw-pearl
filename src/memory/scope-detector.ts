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
    'email', 'message', 'reply', 'notification',
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

    // 1. Check for explicit markers (highest priority)
    const explicitResult = this.checkExplicitMarkers(content);
    if (explicitResult) {
      signals.push({
        score: 0.98,
        scope: explicitResult.scope,
        targetAgentId: explicitResult.targetAgentId,
        reason: `explicit marker: "${explicitResult.marker}"`,
      });
    }

    // 2. Check channel context
    const channelResult = this.checkChannelContext(context);
    if (channelResult) {
      signals.push({
        score: 0.75,
        scope: channelResult.scope,
        targetAgentId: channelResult.targetAgentId,
        reason: channelResult.reason,
      });
    }

    // 3. Check content type patterns
    const typeResult = this.checkContentType(type, content);
    signals.push({
      score: 0.6,
      scope: typeResult.scope,
      reason: typeResult.reason,
    });

    // 4. Check workflow keywords
    const workflowResult = this.checkWorkflowKeywords(content);
    if (workflowResult) {
      const targetAgent = this.inferAgentFromKeywords(workflowResult.keywords);
      signals.push({
        score: 0.8,
        scope: targetAgent ? 'agent' : 'inferred',
        targetAgentId: targetAgent,
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
          ...(base.explicitMarkers?.global ?? []),
          ...(custom.explicitMarkers?.global ?? []),
        ],
        agent: [
          ...(base.explicitMarkers?.agent ?? []),
          ...(custom.explicitMarkers?.agent ?? []),
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
    for (const marker of this.rules.explicitMarkers?.global || []) {
      if (lowerContent.includes(marker.toLowerCase())) {
        return { scope: 'global', marker };
      }
    }

    // Check agent-specific markers
    for (const marker of this.rules.explicitMarkers?.agent || []) {
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
    const lowerContent = content.toLowerCase();

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
    // Prioritize specific channel type information when available
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

    // Fall back to direct channel mapping
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

    // Personal information (names, addresses, health) is usually global
    if (this.containsPersonalInfo(content)) {
      // Provide specific reasons based on memory type
      if (type === 'fact') {
        return {
          scope: 'global',
          reason: 'personal facts typically global',
        };
      } else if (type === 'health') {
        return {
          scope: 'global',
          reason: 'health information typically global',
        };
      } else {
        return {
          scope: 'global',
          reason: 'personal information typically applies globally',
        };
      }
    }

    // Provide specific reasons for certain types
    if (type === 'preference') {
      return {
        scope: 'global',
        reason: 'user preferences typically global',
      };
    }

    // Check for generic/unclear content
    if (this.isGenericContent(content)) {
      return {
        scope: 'global',
        reason: 'default scope for unclear content',
      };
    }

    // Choose scope based on weights
    if (weights.global > weights.agent) {
      return {
        scope: 'global',
        reason: `${type} memories typically global (weight: ${weights.global} vs ${weights.agent})`,
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
      // Names (capitalized words)
      /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/,
      // Addresses
      /\b\d+\s+[A-Z][a-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Place|Pl)\b/i,
      // Locations with "live", "from", etc.
      /\b(live|lives|from|in|at)\s+[A-Z][a-z]+/,
      // Family relationships
      /\b(my|his|her)\s+(son|daughter|wife|husband|partner|mom|dad|brother|sister|child|family)\b/i,
      // Personal attributes
      /\b(allergic to|diagnosed with|birthday|age|born)\b/i,
    ];

    return personalPatterns.some(pattern => pattern.test(content));
  }

  private isGenericContent(content: string): boolean {
    const lowerContent = content.toLowerCase();
    const genericPatterns = [
      'random fact',
      'something',
      'this is',
    ];
    
    return genericPatterns.some(pattern => lowerContent.includes(pattern));
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

  private inferAgentFromKeywords(keywords: string[]): string | undefined {
    const lowerKeywords = keywords.map(k => k.toLowerCase());
    
    // Writing/blog keywords -> tex
    if (lowerKeywords.some(k => ['blog post', 'writing', 'article', 'draft', 'publish', 'content', 'newsletter', 'substack', 'editorial'].includes(k))) {
      return 'tex';
    }
    
    // Trading/finance keywords -> trey
    if (lowerKeywords.some(k => ['trade', 'trading', 'portfolio', 'investment', 'position', 'stock', 'crypto', 'market', 'financial'].includes(k))) {
      return 'trey';
    }
    
    // Social media keywords -> linc
    if (lowerKeywords.some(k => ['twitter', 'linkedin', 'post', 'tweet', 'social', 'engagement', 'follower', 'hashtag'].includes(k))) {
      return 'linc';
    }
    
    // AI/research keywords -> nova
    if (lowerKeywords.some(k => ['research', 'paper', 'arxiv', 'dataset', 'model', 'algorithm', 'ai', 'machine learning', 'ml'].includes(k))) {
      return 'nova';
    }
    
    // Development keywords -> main (fallback for dev tasks)
    if (lowerKeywords.some(k => ['code', 'programming', 'debug', 'repository', 'commit', 'deploy', 'api', 'database', 'server'].includes(k))) {
      return 'main';
    }
    
    return undefined;
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

    // Calculate confidence based on signal strength and agreement
    let confidence = topSignal.score;

    // If we only have weak content-type signals, reduce confidence
    const hasStrongSignals = signals.some(s => s.score >= 0.75);
    if (!hasStrongSignals && signals.length === 1 && topSignal.score <= 0.6) {
      confidence = Math.min(confidence, 0.6);
    }

    // Further reduce confidence for empty content
    const hasContent = signals.some(s => s.reason.includes('contains') || s.reason.includes('personal') || s.reason.includes('workflow'));
    if (!hasContent && signals.some(s => s.reason.includes('default'))) {
      confidence = Math.min(confidence, 0.4);
    }

    // Boost confidence if multiple signals agree
    const agreeingSignals = signals.filter(s => 
      s.scope === topSignal.scope && 
      s.targetAgentId === topSignal.targetAgentId
    );
    if (agreeingSignals.length > 1) {
      confidence = Math.min(1.0, confidence + 0.1 * (agreeingSignals.length - 1));
    }

    // Reduce confidence if signals conflict
    const conflictingSignals = signals.filter(s => 
      s.scope !== topSignal.scope
    );
    if (conflictingSignals.length > 0) {
      confidence = Math.max(0.1, confidence - 0.1 * conflictingSignals.length);
    }

    // Build reasoning
    const reasons = signals.slice(0, 3).map(s => s.reason);
    const reasoning = reasons.join('; ');

    return {
      scope: topSignal.scope,
      targetAgentId: topSignal.targetAgentId,
      confidence,
      reasoning,
    };
  }
}