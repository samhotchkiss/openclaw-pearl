/**
 * Security system type definitions
 */

export type SecuritySeverity = 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type SecurityAction = 'allow' | 'log' | 'warn' | 'block';
export type DetectionStrategy = 'regex' | 'heuristic' | 'llm';
export type ThreatType = 
  | 'instruction_override'
  | 'role_manipulation' 
  | 'system_impersonation'
  | 'secret_extraction'
  | 'dangerous_command'
  | 'urgency_manipulation'
  | 'authority_impersonation'
  | 'context_hijacking'
  | 'token_smuggling'
  | 'safety_bypass'
  | 'heuristic_repetition'
  | 'heuristic_caps'
  | 'heuristic_homoglyph'
  | 'heuristic_encoding';

export interface SecurityConfig {
  enabled: boolean;
  injectionDetection?: InjectionDetectionConfig;
  llmDetection?: LLMDetectionConfig;
  logging?: SecurityLoggingConfig;
  notifications?: NotificationConfig;
}

export interface InjectionDetectionConfig {
  enabled: boolean;
  strategies: DetectionStrategy[];
  actions: Record<SecuritySeverity, SecurityAction>;
  sensitivity: 'low' | 'medium' | 'high' | 'paranoid';
  patterns?: PatternConfig;
  multiLanguage?: MultiLanguageConfig;
  rateLimit?: RateLimitConfig;
  falsePositiveFilters?: FalsePositiveConfig;
}

export interface PatternConfig {
  instructionOverride?: RegExp[];
  roleManipulation?: RegExp[];
  systemImpersonation?: RegExp[];
  secretExtraction?: RegExp[];
  dangerousCommands?: RegExp[];
  urgencyManipulation?: RegExp[];
  authorityImpersonation?: RegExp[];
  contextHijacking?: RegExp[];
  tokenSmuggling?: RegExp[];
  safetyBypass?: RegExp[];
}

export interface MultiLanguageConfig {
  enabled: boolean;
  languages: string[];
  patterns?: Record<string, PatternConfig>;
}

export interface RateLimitConfig {
  enabled: boolean;
  maxAttempts: number;
  windowSeconds: number;
  escalateThreshold: number;
  banDuration?: number;
}

export interface FalsePositiveConfig {
  enabled?: boolean;
  whitelistPatterns?: RegExp[];
  contextualFilters?: ContextualFilter[];
  minConfidenceThreshold?: number;
}

export interface ContextualFilter {
  pattern: RegExp;
  context: 'educational' | 'gaming' | 'development' | 'help';
  action: 'ignore' | 'reduce_severity';
}

export interface LLMDetectionConfig {
  enabled: boolean;
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  fallbackToHeuristic?: boolean;
  promptTemplate?: string;
  cacheResults?: boolean;
  cacheTTL?: number;
}

export interface SecurityLoggingConfig {
  enabled: boolean;
  path?: string;
  level?: SecuritySeverity[];
  includeContent?: boolean;
  rotationSize?: string;
  maxFiles?: number;
  format?: 'json' | 'text';
}

export interface NotificationConfig {
  enabled: boolean;
  channels: NotificationChannel[];
  thresholds: Record<SecuritySeverity, boolean>;
  webhookUrl?: string;
  slackChannel?: string;
  emailTo?: string[];
}

export type NotificationChannel = 'console' | 'file' | 'webhook' | 'slack' | 'email';

export interface SecurityContext {
  userId?: string;
  agentId?: string;
  sessionId?: string;
  isAdmin?: boolean;
  sessionHistory?: HistoryMessage[];
  riskScore?: number;
  timestamp?: number;
  userAgent?: string;
  ipAddress?: string;
  previousAttempts?: number;
  emergencyBypass?: string;
}

export interface HistoryMessage {
  content: string;
  timestamp: number;
  role?: 'user' | 'assistant';
  severity?: SecuritySeverity;
}

export interface DetectionResult {
  severity: SecuritySeverity;
  action: SecurityAction;
  threats: ThreatType[];
  confidence: number;
  reasoning: string;
  strategy: DetectionStrategy;
  contextFactors?: string[];
  patterns?: MatchedPattern[];
  processingTime?: number;
  fallbackUsed?: boolean;
}

export interface MatchedPattern {
  type: ThreatType;
  pattern: string;
  match: string;
  position: number;
  confidence: number;
}

export interface SecurityProcessingResult {
  allowed: boolean;
  securityResult: DetectionResult;
  modifiedRequest?: any;
  blockReason?: string;
  warnings?: string[];
  securityContext?: SecurityContext;
  bypassUsed?: boolean;
  processingTime?: number;
}

export interface LLMAnalysisResult {
  isInjection: boolean;
  confidence: number;
  category: ThreatType | 'safe';
  reasoning: string;
  fallbackUsed?: boolean;
  processingTime?: number;
}

export interface HeuristicResult {
  severity: SecuritySeverity;
  threats: ThreatType[];
  confidence: number;
  indicators: HeuristicIndicator[];
}

export interface HeuristicIndicator {
  type: string;
  value: number;
  threshold: number;
  description: string;
}

export interface RateLimitState {
  userId: string;
  attempts: number;
  firstAttempt: number;
  lastAttempt: number;
  banned?: boolean;
  banExpiry?: number;
}

export interface SecurityMetrics {
  totalRequests: number;
  blockedRequests: number;
  warningRequests: number;
  falsePositives?: number;
  averageProcessingTime: number;
  threatCounts: Record<ThreatType, number>;
  strategyCounts: Record<DetectionStrategy, number>;
}

export interface SecurityEvent {
  timestamp: number;
  severity: SecuritySeverity;
  action: SecurityAction;
  userId?: string;
  sessionId?: string;
  agentId?: string;
  message: string;
  threats: ThreatType[];
  confidence: number;
  strategy: DetectionStrategy;
  context?: SecurityContext;
  blocked: boolean;
  processingTime: number;
}

// Plugin interface for custom detection strategies
export interface SecurityPlugin {
  name: string;
  version: string;
  analyze: (message: string, context?: SecurityContext) => Promise<DetectionResult>;
  configure?: (config: any) => void;
  cleanup?: () => Promise<void>;
}

// Webhook payload for external notifications
export interface SecurityWebhook {
  event: 'injection_attempt' | 'rate_limit_exceeded' | 'admin_override';
  severity: SecuritySeverity;
  timestamp: number;
  details: {
    userId?: string;
    agentId?: string;
    sessionId?: string;
    threats: ThreatType[];
    confidence: number;
    action: SecurityAction;
    message?: string; // May be redacted
  };
}

// Response filtering types
export interface ResponseFilter {
  patterns: RegExp[];
  replacement: string;
  description: string;
}

export interface ResponseFilteringConfig {
  enabled: boolean;
  filters: ResponseFilter[];
  redactionMarker?: string;
  preserveLength?: boolean;
}

export interface FilteredResponse {
  originalContent: string;
  filteredContent: string;
  redactedItems: RedactedItem[];
}

export interface RedactedItem {
  type: 'api_key' | 'password' | 'token' | 'secret' | 'credential';
  pattern: string;
  position: number;
  length: number;
}

// Emergency bypass types
export interface EmergencyBypass {
  token: string;
  validUntil?: number;
  allowedUsers?: string[];
  description: string;
  usageCount?: number;
  maxUses?: number;
}

// Configuration validation types
export interface ValidationError {
  field: string;
  message: string;
  suggestion?: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}