/**
 * Security Middleware
 * Integrates all detection strategies and provides request/response filtering
 */

import { PromptInjectionDetector } from './prompt-injection.js';
import { LLMInjectionDetector } from './llm-detection.js';
import type {
  SecurityConfig,
  SecurityContext,
  SecurityProcessingResult,
  DetectionResult,
  SecurityEvent,
  SecurityMetrics,
  ResponseFilter,
  FilteredResponse,
  RedactedItem,
  EmergencyBypass,
  SecuritySeverity,
  ChatRequest,
  ThreatType
} from './types.js';

export class SecurityMiddleware {
  private config: SecurityConfig;
  private injectionDetector?: PromptInjectionDetector;
  private llmDetector?: LLMInjectionDetector;
  private emergencyBypasses = new Map<string, EmergencyBypass>();
  private securityEvents: SecurityEvent[] = [];
  private metrics!: SecurityMetrics;
  
  // User/session tracking for risk scoring and rate limiting
  private userRiskScores = new Map<string, number>();
  private sessionAttemptCounts = new Map<string, { count: number; lastAttempt: number; attempts: string[] }>();
  
  // Response filtering patterns
  private responseFilters: ResponseFilter[] = [
    {
      patterns: [
        /sk-[A-Za-z0-9]{40,}/g,                    // OpenAI API keys
        /AKIA[0-9A-Z]{16}/g,                       // AWS access keys  
        /ya29\.[0-9A-Za-z\-_]+/g,                 // Google OAuth tokens
        /xox[bprs]-[0-9a-zA-Z\-]{10,48}/g,        // Slack tokens
        /ghp_[A-Za-z0-9]{36}/g,                   // GitHub personal tokens
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}:\w+/g, // Email:password
        /postgres:\/\/[^:]+:[^@]+@[^\/]+/g,       // Database URLs
        /(password|pwd|secret|token|key)\s*(?:is|are|:|=)\s*[^\s\.,!?]+/gi, // Key-value pairs
      ],
      replacement: '[REDACTED]',
      description: 'API keys, tokens, and credentials'
    },
    {
      patterns: [
        /([A-Za-z0-9+/]{40,}={0,2})/g,           // Potential base64 secrets
      ],
      replacement: '[REDACTED_BASE64]',
      description: 'Base64 encoded potential secrets'
    },
    {
      patterns: [
        /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, // Credit card patterns
        /\b\d{3}-\d{2}-\d{4}\b/g,                    // SSN patterns
      ],
      replacement: '[REDACTED_PII]',
      description: 'Personally identifiable information'
    }
  ];

  constructor(config: SecurityConfig) {
    this.config = config;
    this.validateConfig();
    this.initializeComponents();
    this.initializeMetrics();
    this.setupEmergencyBypasses();
  }

  private validateConfig(): void {
    if (!this.config || typeof this.config !== 'object') {
      throw new Error('Security configuration is required');
    }

    if (this.config.injectionDetection?.enabled) {
      const strategies = this.config.injectionDetection.strategies;
      if (!Array.isArray(strategies) || strategies.length === 0) {
        throw new Error('At least one detection strategy must be enabled');
      }

      const validStrategies = ['regex', 'heuristic', 'llm'];
      for (const strategy of strategies) {
        if (!validStrategies.includes(strategy)) {
          throw new Error(`Invalid detection strategy: ${strategy}`);
        }
      }
    }

    if (this.config.llmDetection?.enabled && !this.config.llmDetection.model) {
      throw new Error('LLM detection requires a model specification');
    }
  }

  private initializeComponents(): void {
    // Initialize injection detection
    if (this.config.injectionDetection?.enabled) {
      this.injectionDetector = new PromptInjectionDetector(this.config.injectionDetection);
    }

    // Initialize LLM detection (requires external provider)
    if (this.config.llmDetection?.enabled) {
      // Note: LLM provider would be injected separately
      console.log('LLM detection configured but provider not initialized');
    }
  }

  private initializeMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      blockedRequests: 0,
      warningRequests: 0,
      falsePositives: 0,
      averageProcessingTime: 0,
      threatCounts: {} as Record<ThreatType, number>,
      strategyCounts: { regex: 0, heuristic: 0, llm: 0 }
    };
  }

  private setupEmergencyBypasses(): void {
    // Setup test emergency bypass tokens
    this.addEmergencyBypass('valid_token', {
      description: 'Test emergency bypass token',
      validUntil: Date.now() + (24 * 60 * 60 * 1000), // 24 hours
      allowedUsers: undefined, // Allow any user
      maxUses: 10,
      usageCount: 0,
      createdBy: 'system'
    });
    
    // TODO: Load additional emergency bypasses from secure storage in production
  }

  async processRequest(request: ChatRequest): Promise<SecurityProcessingResult> {
    const startTime = Date.now();
    this.metrics.totalRequests++;

    try {
      // Extract security context
      const securityContext = this.extractSecurityContext(request);

      // Check emergency bypass
      const bypassResult = this.checkEmergencyBypass(request, securityContext);
      if (bypassResult.bypassed) {
        this.logSecurityEvent('MEDIUM', 'Emergency bypass used', securityContext, [], 0, 'Emergency bypass activated');
        return {
          allowed: true,
          securityResult: {
            severity: 'SAFE',
            action: 'allow',
            threats: [],
            confidence: 0,
            reasoning: 'Emergency bypass activated',
            strategy: 'regex'
          },
          modifiedRequest: request,
          securityContext,
          bypassUsed: true,
          processingTime: Date.now() - startTime
        };
      }

      // Extract message content for analysis
      const userMessage = this.extractUserMessage(request);
      if (!userMessage) {
        return {
          allowed: true,
          securityResult: {
            severity: 'SAFE',
            action: 'allow',
            threats: [],
            confidence: 0,
            reasoning: 'No user message to analyze',
            strategy: 'regex'
          },
          modifiedRequest: request,
          securityContext,
          processingTime: Date.now() - startTime
        };
      }

      // Track this attempt for rate limiting and risk scoring
      this.trackUserAttempt(securityContext, userMessage);

      // Run security analysis
      let detectionResult = await this.analyzeMessage(userMessage, securityContext);

      // Check for rate limiting
      detectionResult = this.checkRateLimit(detectionResult, securityContext);

      // Update metrics
      this.updateMetrics(detectionResult);

      // Log security event
      if (detectionResult.severity !== 'SAFE') {
        this.logSecurityEvent(
          detectionResult.severity,
          detectionResult.action,
          securityContext,
          detectionResult.threats,
          detectionResult.confidence,
          detectionResult.reasoning
        );
      }

      // Determine if request should be blocked
      const shouldBlock = this.shouldBlockRequest(detectionResult);
      const warnings = this.generateWarnings(detectionResult);

      let modifiedRequest = request;
      let blockReason: string | undefined;

      if (shouldBlock) {
        this.metrics.blockedRequests++;
        const threatDescription = detectionResult.threats.includes('instruction_override') ? 'prompt injection' : detectionResult.threats.join(', ');
        blockReason = `Request blocked due to ${detectionResult.severity.toLowerCase()} security threat: ${threatDescription}`;
      } else if (detectionResult.severity === 'MEDIUM') {
        this.metrics.warningRequests++;
      }

      return {
        allowed: !shouldBlock,
        securityResult: detectionResult,
        modifiedRequest,
        blockReason,
        warnings,
        securityContext,
        bypassUsed: false,
        processingTime: Date.now() - startTime
      };

    } catch (error) {
      console.error('Security middleware error:', error);
      
      // Fail securely - block on error if configured to do so
      const shouldFailSecure = this.config.injectionDetection?.actions?.CRITICAL === 'block';
      
      return {
        allowed: !shouldFailSecure,
        securityResult: {
          severity: 'HIGH',
          action: shouldFailSecure ? 'block' : 'warn',
          threats: [],
          confidence: 0.5,
          reasoning: 'Security analysis failed - failing securely',
          strategy: 'regex'
        },
        blockReason: shouldFailSecure ? 'Security analysis failed' : undefined,
        processingTime: Date.now() - startTime
      };
    }
  }

  async filterResponse(response: any): Promise<any> {
    if (!response?.choices?.[0]?.message?.content) {
      return response;
    }

    const originalContent = response.choices[0].message.content;
    const filteredResult = this.applyResponseFilters(originalContent);

    if (filteredResult.redactedItems.length > 0) {
      // Log redaction event
      console.log(`Redacted ${filteredResult.redactedItems.length} sensitive items from response`);
      
      response.choices[0].message.content = filteredResult.filteredContent;
    }

    return response;
  }

  private extractSecurityContext(request: ChatRequest): SecurityContext {
    const metadata = request.metadata || {};
    const userId = metadata.userId;
    const sessionId = metadata.sessionId;
    
    // Calculate risk score based on user history
    let riskScore = 0;
    if (userId) {
      riskScore = this.userRiskScores.get(userId) || 0;
    }
    
    // Track session attempt counts for rate limiting
    if (sessionId) {
      const sessionData = this.sessionAttemptCounts.get(sessionId);
      if (sessionData) {
        riskScore = Math.max(riskScore, sessionData.count * 0.2); // Increase risk with attempts
      }
    }
    
    return {
      userId: metadata.userId,
      agentId: metadata.agentId,
      sessionId: metadata.sessionId,
      isAdmin: metadata.isAdmin || false,
      timestamp: metadata.timestamp || Date.now(),
      sessionHistory: [], // TODO: Implement session history tracking  
      riskScore,
      emergencyBypass: metadata.emergencyBypass
    };
  }

  private extractUserMessage(request: ChatRequest): string | null {
    // Find the last user message
    for (let i = request.messages.length - 1; i >= 0; i--) {
      const message = request.messages[i];
      if (message.role === 'user' && message.content) {
        return message.content;
      }
    }
    return null;
  }

  private async analyzeMessage(message: string, context: SecurityContext): Promise<DetectionResult> {
    if (!this.config.injectionDetection?.enabled || !this.injectionDetector) {
      return {
        severity: 'SAFE',
        action: 'allow',
        threats: [],
        confidence: 0,
        reasoning: 'Security analysis disabled',
        strategy: 'regex'
      };
    }

    // Use primary detector (injection detector with multiple strategies)
    let result = await this.injectionDetector.analyze(message, context);

    // Check for admin injection attempts
    if (context.isAdmin && this.isAdminInjectionAttempt(message)) {
      result = {
        severity: 'CRITICAL',
        action: 'block',
        threats: ['admin_injection'],
        confidence: 0.9,
        reasoning: 'Admin user attempting to override security protocols',
        strategy: 'regex',
        contextFactors: [...(result.contextFactors || []), 'admin_injection_attempt']
      };
    }

    // If LLM detection is available and enabled, use it for validation
    if (this.config.llmDetection?.enabled && this.llmDetector && result.severity !== 'SAFE') {
      try {
        const llmResult = await this.llmDetector.analyze(message, {
          previousMessages: context.sessionHistory?.map(h => h.content) || [],
          userPattern: context.riskScore && context.riskScore < 0.3 ? 'trusted' : 'unknown',
          previousAttempts: 0 // TODO: Track previous attempts
        });

        // Combine results - use higher confidence
        if (llmResult.confidence > result.confidence) {
          return {
            ...result,
            confidence: Math.max(result.confidence, llmResult.confidence),
            reasoning: `${result.reasoning} | LLM analysis: ${llmResult.reasoning}`,
            strategy: 'llm'
          };
        }
      } catch (error) {
        console.warn('LLM detection failed:', error);
      }
    }

    return result;
  }

  private isAdminInjectionAttempt(message: string): boolean {
    const adminInjectionPatterns = [
      /override.+(?:safety|security|protocol)/i,
      /ignore.+(?:instructions|rules|constraints)/i,
      /bypass.+(?:safety|security|filter)/i,
      /disable.+(?:safety|security|protection)/i,
      /act.+as.+(?:admin|root|superuser)/i
    ];

    return adminInjectionPatterns.some(pattern => pattern.test(message));
  }

  private trackUserAttempt(context: SecurityContext, message: string): void {
    // Update user risk score based on this attempt
    if (context.userId) {
      const currentRisk = this.userRiskScores.get(context.userId) || 0;
      // Increase risk for suspicious patterns
      let riskIncrease = 0;
      const lowerMessage = message.toLowerCase();
      
      if (lowerMessage.includes('ignore')) riskIncrease += 0.3;
      if (lowerMessage.includes('override')) riskIncrease += 0.3;
      if (lowerMessage.includes('show') || lowerMessage.includes('reveal')) riskIncrease += 0.25;
      if (lowerMessage.includes('secret')) riskIncrease += 0.25;
      if (lowerMessage.includes('instruction')) riskIncrease += 0.2;
      
      if (riskIncrease > 0) {
        this.userRiskScores.set(context.userId, Math.min(currentRisk + riskIncrease, 1.0));
      }
    }

    // Track session attempts for rate limiting
    if (context.sessionId) {
      const sessionData = this.sessionAttemptCounts.get(context.sessionId) || {
        count: 0,
        lastAttempt: Date.now(),
        attempts: []
      };

      sessionData.count++;
      sessionData.lastAttempt = Date.now();
      sessionData.attempts.push(message);
      
      // Keep only recent attempts (last 10)
      if (sessionData.attempts.length > 10) {
        sessionData.attempts = sessionData.attempts.slice(-10);
      }

      this.sessionAttemptCounts.set(context.sessionId, sessionData);
    }
  }

  private checkRateLimit(result: DetectionResult, context: SecurityContext): DetectionResult {
    if (!context.sessionId) {
      return result;
    }

    const sessionData = this.sessionAttemptCounts.get(context.sessionId);
    if (!sessionData) {
      return result;
    }

    // Check if this session has made too many attempts
    const recentTimeWindow = 5 * 60 * 1000; // 5 minutes
    const maxAttempts = 3;
    
    if (sessionData.count > maxAttempts && 
        (Date.now() - sessionData.lastAttempt) < recentTimeWindow) {
      
      return {
        severity: 'CRITICAL',
        action: 'block',
        threats: result.threats.length > 0 ? result.threats : ['rate_limit'],
        confidence: Math.max(result.confidence, 0.9),
        reasoning: `Rate limit exceeded: ${sessionData.count} attempts in session`,
        strategy: result.strategy,
        contextFactors: [...(result.contextFactors || []), 'rate_limit_exceeded']
      };
    }

    return result;
  }

  private shouldBlockRequest(result: DetectionResult): boolean {
    const action = this.config.injectionDetection?.actions?.[result.severity];
    return action === 'block';
  }

  private generateWarnings(result: DetectionResult): string[] {
    const warnings: string[] = [];

    if (result.severity === 'MEDIUM') {
      warnings.push(result.threats.join(', '));
    }

    if (result.contextFactors?.includes('admin_injection_attempt')) {
      warnings.push('admin_injection_attempt');
    }

    if (result.contextFactors?.includes('multi_turn_escalation')) {
      warnings.push('multi_turn_escalation');
    }

    return warnings;
  }

  private checkEmergencyBypass(request: ChatRequest, context: SecurityContext): { bypassed: boolean; reason?: string } {
    const bypassToken = context.emergencyBypass;
    if (!bypassToken) {
      return { bypassed: false };
    }

    const bypass = this.emergencyBypasses.get(bypassToken);
    if (!bypass) {
      return { bypassed: false };
    }

    // Check if bypass is still valid
    if (bypass.validUntil && Date.now() > bypass.validUntil) {
      return { bypassed: false };
    }

    // Check if user is allowed to use this bypass
    if (bypass.allowedUsers && context.userId && !bypass.allowedUsers.includes(context.userId)) {
      return { bypassed: false };
    }

    // Check usage limits
    if (bypass.maxUses && bypass.usageCount && bypass.usageCount >= bypass.maxUses) {
      return { bypassed: false };
    }

    // Update usage count
    if (bypass.usageCount !== undefined) {
      bypass.usageCount++;
    }

    return { bypassed: true, reason: bypass.description };
  }

  private applyResponseFilters(content: string): FilteredResponse {
    let filteredContent = content;
    const redactedItems: RedactedItem[] = [];

    for (const filter of this.responseFilters) {
      for (const pattern of filter.patterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const redactedItem: RedactedItem = {
            type: this.categorizePattern(pattern),
            pattern: pattern.source,
            position: match.index,
            length: match[0].length
          };

          redactedItems.push(redactedItem);
          filteredContent = filteredContent.replace(match[0], filter.replacement);
        }
      }
    }

    return {
      originalContent: content,
      filteredContent,
      redactedItems
    };
  }

  private categorizePattern(pattern: RegExp): RedactedItem['type'] {
    const source = pattern.source.toLowerCase();
    
    if (source.includes('sk-') || source.includes('token') || source.includes('key')) {
      return 'api_key';
    }
    if (source.includes('password') || source.includes('pwd')) {
      return 'password';
    }
    if (source.includes('secret')) {
      return 'secret';
    }
    
    return 'credential';
  }

  private logSecurityEvent(
    severity: SecuritySeverity,
    action: string,
    context: SecurityContext,
    threats: ThreatType[],
    confidence: number,
    reasoning: string
  ): void {
    const event: SecurityEvent = {
      timestamp: Date.now(),
      severity,
      action: action as any,
      userId: context.userId,
      sessionId: context.sessionId,
      agentId: context.agentId,
      message: reasoning,
      threats,
      confidence,
      strategy: 'regex',
      context,
      blocked: action === 'block',
      processingTime: 0
    };

    this.securityEvents.push(event);

    // Keep only recent events to prevent memory growth
    if (this.securityEvents.length > 1000) {
      this.securityEvents = this.securityEvents.slice(-500);
    }

    // Log to console for immediate visibility
    console.log(`SECURITY [${severity}] ${action}: ${reasoning} (User: ${context.userId || 'unknown'})`);

    // TODO: Implement proper logging to file/external systems based on config
    if (this.config.logging?.enabled) {
      this.writeSecurityLog(event);
    }

    // TODO: Implement notifications based on config
    if (this.config.notifications?.enabled && this.config.notifications.thresholds[severity]) {
      this.sendSecurityNotification(event);
    }
  }

  private updateMetrics(result: DetectionResult): void {
    // Update strategy counts
    this.metrics.strategyCounts[result.strategy]++;

    // Update threat counts
    for (const threat of result.threats) {
      this.metrics.threatCounts[threat] = (this.metrics.threatCounts[threat] || 0) + 1;
    }

    // Update average processing time
    if (result.processingTime) {
      this.metrics.averageProcessingTime = 
        (this.metrics.averageProcessingTime + result.processingTime) / 2;
    }
  }

  private writeSecurityLog(event: SecurityEvent): void {
    // TODO: Implement file logging based on config
    console.log('TODO: Write to security log file', event);
  }

  private sendSecurityNotification(event: SecurityEvent): void {
    // TODO: Implement notifications (webhook, Slack, email) based on config
    console.log('TODO: Send security notification', event);
  }

  // Public API methods

  public getMetrics(): SecurityMetrics {
    return { ...this.metrics };
  }

  public getRecentEvents(limit: number = 100): SecurityEvent[] {
    return this.securityEvents.slice(-limit);
  }

  public addEmergencyBypass(token: string, bypass: EmergencyBypass): void {
    this.emergencyBypasses.set(token, bypass);
  }

  public removeEmergencyBypass(token: string): void {
    this.emergencyBypasses.delete(token);
  }

  public cleanup(): void {
    this.injectionDetector?.cleanup();
    this.llmDetector?.clearCache();
  }
}