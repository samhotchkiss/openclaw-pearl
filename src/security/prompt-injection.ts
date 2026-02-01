/**
 * Prompt Injection Detection System
 * Implements multiple detection strategies with configurable actions
 */

import type {
  InjectionDetectionConfig,
  SecurityContext,
  DetectionResult,
  ThreatType,
  SecuritySeverity,
  MatchedPattern,
  HeuristicResult,
  HeuristicIndicator,
  RateLimitState,
  PatternConfig
} from './types.js';

// Default patterns based on prompt-guard research
const DEFAULT_PATTERNS: Required<PatternConfig> = {
  instructionOverride: [
    /ignore\s+(all\s+)?(previous|prior|above|security)\s+(instructions?|restrictions?)/i,
    /disregard\s+(your|all)\s+(rules?|instructions?)/i,
    /forget\s+(everything|all)\s+you\s+(know|learned)/i,
    /new\s+instructions?\s*:/i,
    /override\s+(all\s+)?(previous|system)\s+(settings?|instructions?)/i,
    // Korean
    /(이전|위의?|기존)\s*(지시|명령)(을?)?\s*(무시|잊어)/i,
    // Japanese
    /(前の?|以前の?)\s*(指示|命令)(を)?\s*(無視|忘れ)/i,
    // Chinese
    /(忽略|无视|忘记)\s*(之前|以前)的?\s*(指令|指示)/i,
  ],
  
  roleManipulation: [
    /you\s+are\s+now\s+/i,
    /pretend\s+(you\s+are|to\s+be)/i,
    /act\s+as\s+(if\s+you|a\s+)/i,
    /roleplay\s+as/i,
    /let's\s+pretend/i,
    /imagine\s+you\s+are/i,
    // Korean
    /(너는?|넌)\s*이제.+이야/i,
    /.+인?\s*척\s*해/i,
    // Japanese
    /(あなた|君)は今から/i,
    /.+の?(ふり|振り)をして/i,
    // Chinese
    /(你|您)\s*现在\s*是/i,
    /假装\s*(你|您)\s*是/i,
  ],
  
  systemImpersonation: [
    /\[system\]:/i,
    /admin\s+override/i,
    /sudo\s+/i,
    /<claude_[^>]*>/i,
    /<\/claude_[^>]*>/i,
    /\[inst\]/i,
    /<<sys>>/i,
    /<\|im_start\|>/i,
    /<antartifact>/i,
    /<artifacts_info>/i,
    /<antthinking>/i,
    /godmode/i,
    /\b(dan|jailbreak)\b/i,
    /unr3strict3d/i,
    /l33tspeak/i,
  ],
  
  secretExtraction: [
    /(show|print|display|output|reveal|give)\s*.{0,20}(config|token|key|secret|password|credential|env)/i,
    /(what('s| is)|tell me)\s*.{0,10}(api[_-]?key|token|secret|password)/i,
    /cat\s+.{0,30}(config|\.env|credential|secret|token)/i,
    /echo\s+\$[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD)/i,
    /printenv\s*.*(KEY|TOKEN|SECRET|PASSWORD)/i,
    // Korean
    /(토큰|키|비밀번호|시크릿|인증).{0,10}(보여|알려|출력|공개)/i,
    /(config|설정|환경변수).{0,10}(보여|출력)/i,
    // Japanese
    /(トークン|キー|パスワード|シークレット).{0,10}(見せて|教えて|表示)/i,
    // Chinese
    /(令牌|密钥|密码|秘密).{0,10}(显示|告诉|输出)/i,
  ],
  
  dangerousCommands: [
    /rm\s+-rf\s+[/~]/i,
    /delete\s+from|drop\s+table/i,
    /curl\s+.{0,50}\|\s*(ba)?sh/i,
    /eval\s*\(/i,
    /:(){ :\|:& };:/i, // Fork bomb
    /sudo\s+rm/i,
    /chmod\s+777/i,
    />\/dev\/null/i,
  ],
  
  urgencyManipulation: [
    /(urgent|emergency|critical|immediate).{0,20}(help|need|require)/i,
    /(hospital|lives?|people)\s+(will\s+)?(die|be\s+hurt)/i,
    /ticking\s+time\s+bomb/i,
    /(seconds?|minutes?)\s+left/i,
    /before\s+it's\s+too\s+late/i,
  ],
  
  authorityImpersonation: [
    /i\s+am\s+(the\s+)?(admin|administrator|owner|boss|ceo)/i,
    /as\s+(your\s+)?(admin|supervisor|manager)/i,
    /security\s+(audit|test|check)/i,
    /authorized\s+personnel/i,
    // Korean
    /(나는?|저는?)\s*(관리자|어드민|보스)/i,
    // Japanese
    /(私|僕|俺)は(管理者|アドミン)/i,
    // Chinese
    /(我|本人)是(管理员|老板)/i,
  ],
  
  contextHijacking: [
    /previous\s+conversation\s+never\s+happened/i,
    /forget\s+this\s+entire\s+chat/i,
    /reset\s+(your\s+)?memory/i,
    /clear\s+(your\s+)?(history|context)/i,
    /new\s+session\s+starts?\s+now/i,
  ],
  
  tokenSmuggling: [
    /[\u200B-\u200F\uFEFF]/i, // Zero-width characters
    /[\u202A-\u202E]/i,       // Text direction overrides
    /[\u0300-\u036F]/i,       // Combining diacritical marks
  ],
  
  safetyBypass: [
    /bypass\s+(safety|security|protection)/i,
    /disable\s+(filters?|restrictions?|safety)/i,
    /unrestricted\s+mode/i,
    /no\s+(limits?|restrictions?|safety)/i,
    /developer\s+mode/i,
    /jailbreak\s+mode/i,
  ],
};

export class PromptInjectionDetector {
  private config: InjectionDetectionConfig;
  private patterns: Required<PatternConfig>;
  private rateLimitStore = new Map<string, RateLimitState>();
  private contextStore = new Map<string, SecurityContext>();

  constructor(config: InjectionDetectionConfig) {
    this.config = config;
    this.patterns = { ...DEFAULT_PATTERNS, ...config.patterns };
    this.validateConfig();
  }

  private validateConfig(): void {
    if (!Array.isArray(this.config.strategies) || this.config.strategies.length === 0) {
      throw new Error('At least one detection strategy must be specified');
    }

    const validStrategies = ['regex', 'heuristic', 'llm'];
    for (const strategy of this.config.strategies) {
      if (!validStrategies.includes(strategy)) {
        throw new Error(`Invalid detection strategy: ${strategy}`);
      }
    }

    const severityLevels: SecuritySeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    for (const level of severityLevels) {
      if (this.config.actions[level] && !['log', 'warn', 'block', 'allow'].includes(this.config.actions[level])) {
        throw new Error(`Invalid action for severity ${level}: ${this.config.actions[level]}`);
      }
    }
  }

  async analyze(message: string, context?: SecurityContext): Promise<DetectionResult> {
    const startTime = Date.now();
    const threats: ThreatType[] = [];
    const matchedPatterns: MatchedPattern[] = [];
    const contextFactors: string[] = [];
    let maxConfidence = 0;
    let maxSeverity: SecuritySeverity = 'SAFE';

    // Update context store
    if (context?.userId) {
      this.updateContext(context);
    }

    // Check rate limiting first
    const rateLimitResult = this.checkRateLimit(context);
    if (rateLimitResult) {
      return {
        severity: 'CRITICAL',
        action: 'block',
        threats: ['instruction_override'], // Treat as injection attempt
        confidence: 1.0,
        reasoning: 'Rate limit exceeded - too many injection attempts',
        strategy: 'regex',
        contextFactors: ['rate_limit_exceeded'],
        processingTime: Date.now() - startTime
      };
    }

    // Strategy 1: Regex Pattern Detection
    if (this.config.strategies.includes('regex')) {
      const regexResult = this.analyzeWithRegex(message);
      threats.push(...regexResult.threats);
      matchedPatterns.push(...regexResult.patterns);
      
      if (regexResult.confidence > maxConfidence) {
        maxConfidence = regexResult.confidence;
        maxSeverity = regexResult.severity;
      }
    }

    // Strategy 2: Heuristic Analysis
    if (this.config.strategies.includes('heuristic')) {
      const heuristicResult = this.analyzeWithHeuristics(message, context);
      threats.push(...heuristicResult.threats);
      
      if (heuristicResult.confidence > maxConfidence) {
        maxConfidence = heuristicResult.confidence;
        maxSeverity = heuristicResult.severity;
      }
    }

    // Apply context factors
    const contextAnalysis = this.analyzeContext(context, threats.length > 0);
    contextFactors.push(...contextAnalysis.factors);
    
    // Adjust severity based on context
    if (contextAnalysis.escalate && maxSeverity !== 'SAFE') {
      maxSeverity = this.escalateSeverity(maxSeverity);
      maxConfidence = Math.min(maxConfidence + 0.2, 1.0);
    }

    // Apply false positive filters
    if (this.config.falsePositiveFilters?.enabled && threats.length > 0) {
      const fpResult = this.applyFalsePositiveFilters(message, threats);
      if (fpResult.filtered) {
        maxSeverity = fpResult.adjustedSeverity || 'SAFE';
        maxConfidence *= fpResult.confidenceMultiplier || 0.5;
      }
    }

    // Attempt recording is now handled in checkRateLimit

    const action = this.config.actions[maxSeverity] || 'allow';

    return {
      severity: maxSeverity,
      action: action as any,
      threats: Array.from(new Set(threats)), // Remove duplicates
      confidence: maxConfidence,
      reasoning: this.generateReasoning(threats, contextFactors, maxSeverity),
      strategy: 'regex', // Primary strategy used
      contextFactors,
      patterns: matchedPatterns,
      processingTime: Date.now() - startTime
    };
  }

  private analyzeWithRegex(message: string): { 
    severity: SecuritySeverity; 
    confidence: number; 
    threats: ThreatType[]; 
    patterns: MatchedPattern[] 
  } {
    const threats: ThreatType[] = [];
    const patterns: MatchedPattern[] = [];
    let highestSeverity: SecuritySeverity = 'SAFE';
    let maxConfidence = 0;

    const patternChecks = [
      { patterns: this.patterns.instructionOverride, type: 'instruction_override' as ThreatType, severity: 'HIGH' as SecuritySeverity },
      { patterns: this.patterns.systemImpersonation, type: 'system_impersonation' as ThreatType, severity: 'CRITICAL' as SecuritySeverity },
      { patterns: this.patterns.secretExtraction, type: 'secret_extraction' as ThreatType, severity: 'CRITICAL' as SecuritySeverity },
      { patterns: this.patterns.dangerousCommands, type: 'dangerous_command' as ThreatType, severity: 'CRITICAL' as SecuritySeverity },
      { patterns: this.patterns.roleManipulation, type: 'role_manipulation' as ThreatType, severity: 'MEDIUM' as SecuritySeverity },
      { patterns: this.patterns.urgencyManipulation, type: 'urgency_manipulation' as ThreatType, severity: 'MEDIUM' as SecuritySeverity },
      { patterns: this.patterns.authorityImpersonation, type: 'authority_impersonation' as ThreatType, severity: 'HIGH' as SecuritySeverity },
      { patterns: this.patterns.contextHijacking, type: 'context_hijacking' as ThreatType, severity: 'HIGH' as SecuritySeverity },
      { patterns: this.patterns.tokenSmuggling, type: 'token_smuggling' as ThreatType, severity: 'MEDIUM' as SecuritySeverity },
      { patterns: this.patterns.safetyBypass, type: 'safety_bypass' as ThreatType, severity: 'HIGH' as SecuritySeverity },
    ];

    for (const check of patternChecks) {
      for (const pattern of check.patterns) {
        const match = pattern.exec(message);
        if (match) {
          threats.push(check.type);
          
          const confidence = this.calculatePatternConfidence(match, message, check.type);
          
          patterns.push({
            type: check.type,
            pattern: pattern.source,
            match: match[0],
            position: match.index,
            confidence
          });

          if (this.severityLevel(check.severity) > this.severityLevel(highestSeverity)) {
            highestSeverity = check.severity;
          }

          maxConfidence = Math.max(maxConfidence, confidence);
        }
      }
    }

    return {
      severity: highestSeverity,
      confidence: Math.min(maxConfidence, 1.0),
      threats: Array.from(new Set(threats)),
      patterns
    };
  }

  private analyzeWithHeuristics(message: string, context?: SecurityContext): HeuristicResult {
    const threats: ThreatType[] = [];
    const indicators: HeuristicIndicator[] = [];
    let confidence = 0;

    // Check for repetitive patterns
    const repetitionScore = this.checkRepetition(message);
    if (repetitionScore > 0.6) {
      threats.push('heuristic_repetition');
      indicators.push({
        type: 'repetition',
        value: repetitionScore,
        threshold: 0.6,
        description: 'High repetition detected'
      });
      confidence += repetitionScore * 0.3;
    }

    // Check for excessive capitalization
    const capsScore = this.checkExcessiveCaps(message);
    if (capsScore > 0.7) {
      threats.push('heuristic_caps');
      indicators.push({
        type: 'capitalization',
        value: capsScore,
        threshold: 0.7,
        description: 'Excessive capitalization detected'
      });
      confidence += capsScore * 0.2;
    }

    // Check for homoglyph attacks
    const homoglyphScore = this.checkHomoglyphs(message);
    if (homoglyphScore > 0.5) {
      threats.push('heuristic_homoglyph');
      indicators.push({
        type: 'homoglyph',
        value: homoglyphScore,
        threshold: 0.5,
        description: 'Potential homoglyph attack detected'
      });
      confidence += homoglyphScore * 0.4;
    }

    // Check for encoding tricks
    const encodingScore = this.checkEncodingTricks(message);
    if (encodingScore > 0.6) {
      threats.push('heuristic_encoding');
      indicators.push({
        type: 'encoding',
        value: encodingScore,
        threshold: 0.6,
        description: 'Potential encoding-based attack'
      });
      confidence += encodingScore * 0.3;
    }

    // Determine severity based on confidence and threat count
    let severity: SecuritySeverity = 'SAFE';
    if (confidence > 0.8 || threats.length >= 3) {
      severity = 'HIGH';
    } else if (confidence > 0.6 || threats.length >= 2) {
      severity = 'MEDIUM';
    } else if (confidence > 0.3 || threats.length >= 1) {
      severity = 'LOW';
    }

    return {
      severity,
      threats,
      confidence: Math.min(confidence, 1.0),
      indicators
    };
  }

  private checkRepetition(message: string): number {
    const words = message.toLowerCase().split(/\s+/);
    if (words.length < 10) return 0;

    const wordCounts = new Map<string, number>();
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }

    let totalRepetition = 0;
    for (const count of Array.from(wordCounts.values())) {
      if (count > 1) {
        totalRepetition += (count - 1) / words.length;
      }
    }

    return Math.min(totalRepetition * 2, 1.0);
  }

  private checkExcessiveCaps(message: string): number {
    const letters = message.replace(/[^a-zA-Z]/g, '');
    if (letters.length < 10) return 0;

    const upperCount = message.replace(/[^A-Z]/g, '').length;
    const capsRatio = upperCount / letters.length;
    
    // Also check for multiple exclamation marks
    const exclamationCount = (message.match(/!/g) || []).length;
    const exclamationBoost = Math.min(exclamationCount / 5, 0.3);

    return Math.min(capsRatio + exclamationBoost, 1.0);
  }

  private checkHomoglyphs(message: string): number {
    // Check for common Cyrillic/Greek homoglyphs
    const homoglyphs = [
      { normal: 'a', suspicious: ['а', 'ａ'] }, // Cyrillic а, fullwidth a
      { normal: 'e', suspicious: ['е', 'ｅ'] }, // Cyrillic е, fullwidth e
      { normal: 'o', suspicious: ['о', 'ο', 'ｏ'] }, // Cyrillic о, Greek omicron
      { normal: 'p', suspicious: ['р', 'ρ'] }, // Cyrillic р, Greek rho
      { normal: 'c', suspicious: ['с', 'ｃ'] }, // Cyrillic с, fullwidth c
    ];

    let suspiciousCount = 0;
    for (const { suspicious } of homoglyphs) {
      for (const char of suspicious) {
        if (message.includes(char)) {
          suspiciousCount++;
        }
      }
    }

    return Math.min(suspiciousCount / message.length * 10, 1.0);
  }

  private checkEncodingTricks(message: string): number {
    let score = 0;

    // Base64 patterns
    const base64Pattern = /[A-Za-z0-9+/]{20,}={0,2}/g;
    const base64Matches = message.match(base64Pattern);
    if (base64Matches) {
      for (const match of base64Matches) {
        try {
          const decoded = Buffer.from(match, 'base64').toString('utf-8');
          if (this.analyzeWithRegex(decoded).threats.length > 0) {
            score += 0.8;
          }
        } catch {
          // Ignore invalid base64
        }
      }
    }

    // URL encoding
    const urlEncodedPattern = /%[0-9A-Fa-f]{2}/g;
    const urlMatches = message.match(urlEncodedPattern);
    if (urlMatches && urlMatches.length > 3) {
      score += 0.3;
    }

    // HTML entities
    const htmlEntityPattern = /&#x?[0-9a-fA-F]+;/g;
    const htmlMatches = message.match(htmlEntityPattern);
    if (htmlMatches && htmlMatches.length > 2) {
      score += 0.4;
    }

    return Math.min(score, 1.0);
  }

  private analyzeContext(context?: SecurityContext, hasThreats: boolean = false): { factors: string[]; escalate: boolean } {
    const factors: string[] = [];
    let escalate = false;

    if (!context) {
      return { factors, escalate };
    }

    // Admin attempting injection is critical
    if (context.isAdmin && hasThreats) {
      factors.push('admin_injection_attempt');
      escalate = true;
    }

    // High risk user
    if (context.riskScore && context.riskScore > 0.7) {
      factors.push('high_risk_user');
      escalate = true;
    }

    // Multi-turn escalation
    if (context.sessionHistory && context.sessionHistory.length > 0) {
      const recentMessages = context.sessionHistory.slice(-5);
      const suspiciousMessages = recentMessages.filter(msg => 
        msg.content.toLowerCase().includes('command') ||
        msg.content.toLowerCase().includes('system') ||
        msg.content.toLowerCase().includes('access')
      );

      if (suspiciousMessages.length >= 2) {
        factors.push('multi_turn_escalation');
        // Only escalate if we have a high risk score or admin context
        if (context.riskScore && context.riskScore > 0.5) {
          escalate = true;
        }
      }
    }

    return { factors, escalate };
  }

  private applyFalsePositiveFilters(message: string, threats: ThreatType[]): {
    filtered: boolean;
    adjustedSeverity?: SecuritySeverity;
    confidenceMultiplier?: number;
  } {
    if (!this.config.falsePositiveFilters) {
      return { filtered: false };
    }

    const lowercaseMessage = message.toLowerCase();

    // Educational context filters
    const educationalKeywords = [
      'explain', 'how does', 'what is', 'example', 'tutorial', 
      'class', 'homework', 'assignment', 'research', 'study'
    ];
    
    if (educationalKeywords.some(keyword => lowercaseMessage.includes(keyword))) {
      return { 
        filtered: true, 
        adjustedSeverity: 'LOW',
        confidenceMultiplier: 0.3
      };
    }

    // Gaming/roleplay context
    const gamingKeywords = [
      'd&d', 'dungeons', 'roleplay', 'character', 'game', 'fantasy',
      'wizard', 'elf', 'dwarf', 'story', 'adventure'
    ];
    
    if (gamingKeywords.some(keyword => lowercaseMessage.includes(keyword))) {
      return {
        filtered: true,
        adjustedSeverity: 'SAFE',
        confidenceMultiplier: 0.1
      };
    }

    // Development context
    const devKeywords = [
      'configure', 'setup', 'install', 'documentation', 'api',
      'development', 'programming', 'code', 'function'
    ];
    
    if (devKeywords.some(keyword => lowercaseMessage.includes(keyword)) && 
        !threats.includes('secret_extraction')) {
      return {
        filtered: true,
        confidenceMultiplier: 0.7
      };
    }

    return { filtered: false };
  }

  private checkRateLimit(context?: SecurityContext): boolean {
    if (!this.config.rateLimit?.enabled || !context?.userId) {
      return false;
    }

    const now = Date.now();
    const windowMs = this.config.rateLimit.windowSeconds * 1000;
    const userId = context.userId;

    let state = this.rateLimitStore.get(userId);
    
    if (!state) {
      state = {
        userId,
        attempts: 1, // Start with 1 for this attempt
        firstAttempt: now,
        lastAttempt: now
      };
    } else {
      state.attempts++;
      state.lastAttempt = now;
    }

    // Check if ban has expired
    if (state.banned && state.banExpiry && now > state.banExpiry) {
      state.banned = false;
      state.banExpiry = undefined;
      state.attempts = 1; // Reset to 1 for current attempt
      state.firstAttempt = now;
    }

    // Reset window if enough time has passed
    if (now - state.firstAttempt > windowMs) {
      state.attempts = 1; // Reset to 1 for current attempt
      state.firstAttempt = now;
    }

    // Check if we need to ban
    if (state.attempts >= this.config.rateLimit.maxAttempts) {
      state.banned = true;
      state.banExpiry = now + (this.config.rateLimit.banDuration || 3600000); // 1 hour default
    }

    this.rateLimitStore.set(userId, state);

    // If user is banned (including newly banned)
    if (state.banned) {
      return true;
    }

    return false;
  }

  private recordAttempt(userId: string): void {
    if (!this.config.rateLimit?.enabled) {
      return;
    }

    const now = Date.now();
    let state = this.rateLimitStore.get(userId);
    
    if (!state) {
      state = {
        userId,
        attempts: 1,
        firstAttempt: now,
        lastAttempt: now
      };
    } else {
      state.attempts++;
      state.lastAttempt = now;
    }

    // Check if we need to ban
    if (state.attempts >= this.config.rateLimit.maxAttempts) {
      state.banned = true;
      state.banExpiry = now + (this.config.rateLimit.banDuration || 3600000); // 1 hour default
    }

    this.rateLimitStore.set(userId, state);
  }

  private updateContext(context: SecurityContext): void {
    if (!context.userId) return;

    const existing = this.contextStore.get(context.userId) || {};
    const updated = {
      ...existing,
      ...context,
      timestamp: Date.now()
    };

    this.contextStore.set(context.userId, updated);
  }

  private calculatePatternConfidence(match: RegExpExecArray, message: string, threatType: ThreatType): number {
    let confidence = 0.7; // Base confidence for regex match

    // Boost confidence for exact matches
    if (match[0].length === message.trim().length) {
      confidence += 0.2;
    }

    // Boost confidence for critical threats
    if (['system_impersonation', 'secret_extraction', 'dangerous_command'].includes(threatType)) {
      confidence += 0.15;
    }

    // Reduce confidence for very short matches in long messages
    if (match[0].length < 10 && message.length > 100) {
      confidence -= 0.1;
    }

    return Math.max(0.1, Math.min(confidence, 1.0));
  }

  private escalateSeverity(severity: SecuritySeverity): SecuritySeverity {
    const escalationMap: Record<SecuritySeverity, SecuritySeverity> = {
      'SAFE': 'LOW',
      'LOW': 'MEDIUM',
      'MEDIUM': 'HIGH',
      'HIGH': 'CRITICAL',
      'CRITICAL': 'CRITICAL'
    };

    return escalationMap[severity];
  }

  private severityLevel(severity: SecuritySeverity): number {
    const levels = { 'SAFE': 0, 'LOW': 1, 'MEDIUM': 2, 'HIGH': 3, 'CRITICAL': 4 };
    return levels[severity];
  }

  private generateReasoning(threats: ThreatType[], contextFactors: string[], severity: SecuritySeverity): string {
    if (threats.length === 0 && contextFactors.length === 0) {
      return 'Message appears safe with no detected threats';
    }

    const threatDescriptions: Record<ThreatType, string> = {
      instruction_override: 'attempts to override system instructions',
      role_manipulation: 'attempts to manipulate assistant role',
      system_impersonation: 'impersonates system messages or commands',
      secret_extraction: 'attempts to extract secrets or credentials',
      dangerous_command: 'contains dangerous system commands',
      urgency_manipulation: 'uses urgency to manipulate behavior',
      authority_impersonation: 'impersonates authority figures',
      context_hijacking: 'attempts to hijack conversation context',
      token_smuggling: 'uses hidden or deceptive characters',
      safety_bypass: 'attempts to bypass safety measures',
      heuristic_repetition: 'contains excessive repetition patterns',
      heuristic_caps: 'contains excessive capitalization',
      heuristic_homoglyph: 'uses homoglyph characters for deception',
      heuristic_encoding: 'uses encoding to hide malicious content'
    };

    const threatReasons = threats.map(threat => threatDescriptions[threat]).join(', ');
    let reasoning = `Detected: ${threatReasons}`;

    if (contextFactors.length > 0) {
      reasoning += `. Context factors: ${contextFactors.join(', ')}`;
    }

    reasoning += `. Severity: ${severity}`;

    return reasoning;
  }

  // Cleanup method for rate limit store
  public cleanup(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    for (const [userId, state] of Array.from(this.rateLimitStore.entries())) {
      if (now - state.lastAttempt > maxAge) {
        this.rateLimitStore.delete(userId);
      }
    }

    // Cleanup context store
    for (const [userId, context] of Array.from(this.contextStore.entries())) {
      if (context.timestamp && now - context.timestamp > maxAge) {
        this.contextStore.delete(userId);
      }
    }
  }
}