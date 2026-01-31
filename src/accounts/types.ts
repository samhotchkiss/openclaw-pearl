/**
 * Account types for multi-account management
 */

/**
 * Supported LLM providers
 */
export type Provider = 'anthropic' | 'openai' | 'ollama' | 'openrouter' | 'gemini';

/**
 * Account authentication type
 */
export type AuthType = 'api_key' | 'oauth';

/**
 * Configuration for registering an account
 */
export interface AccountConfig {
  /** Unique identifier for this account */
  id: string;
  /** LLM provider (anthropic, openai, ollama, etc.) */
  provider: Provider;
  /** Authentication type (defaults to api_key) */
  type?: AuthType;
  /** API key for api_key auth type */
  apiKey?: string;
  /** Base URL for provider (required for ollama, optional for others) */
  baseUrl?: string;
  /** Monthly budget in USD (optional - no limit if not set) */
  budgetMonthlyUsd?: number;
  /** Additional provider-specific options */
  options?: Record<string, unknown>;
}

/**
 * Full account object with runtime state
 */
export interface Account extends AccountConfig {
  /** Current month's usage in USD */
  usageCurrentMonthUsd: number;
  /** Timestamp of last usage record */
  lastUsedAt?: Date;
  /** Whether account is enabled */
  enabled: boolean;
}

/**
 * Budget status for an account
 */
export interface BudgetStatus {
  /** Account ID */
  accountId: string;
  /** Amount used this month in USD */
  used: number;
  /** Monthly budget in USD (undefined if no limit) */
  budget?: number;
  /** Remaining budget in USD (undefined if no limit) */
  remaining?: number;
  /** Percentage of budget used (0-100+, undefined if no limit) */
  percentUsed?: number;
  /** Whether account is over budget */
  isOverBudget: boolean;
  /** Whether account is near budget (>80%) */
  isNearBudget: boolean;
}

/**
 * Match conditions for routing rules
 */
export interface MatchConditions {
  /** Route if request is marked sensitive */
  sensitive?: boolean;
  /** Route if agent ID matches pattern (supports * wildcards) */
  agentId?: string;
  /** Route if request type matches */
  type?: 'general' | 'code' | 'creative' | 'analysis' | 'chat';
  /** Route if complexity matches */
  complexity?: 'low' | 'medium' | 'high';
  /** Default rule (matches when no other rules match) */
  default?: boolean;
  /** Custom metadata match */
  [key: string]: unknown;
}

/**
 * Routing rule for account selection
 */
export interface RoutingRule {
  /** Rule name for identification/debugging */
  name: string;
  /** Conditions that trigger this rule */
  match: MatchConditions;
  /** Account ID to route to */
  account: string;
  /** Fallback account ID if primary fails or is over budget */
  fallback?: string;
  /** Priority (higher = evaluated first) */
  priority: number;
}

/**
 * Context provided when routing a request
 */
export interface RoutingContext {
  /** Whether the request contains sensitive content */
  sensitive?: boolean;
  /** Agent ID making the request */
  agentId?: string;
  /** Request type */
  type?: 'general' | 'code' | 'creative' | 'analysis' | 'chat';
  /** Request complexity */
  complexity?: 'low' | 'medium' | 'high';
  /** Additional metadata for custom matching */
  metadata?: Record<string, unknown>;
}

/**
 * Options for routing behavior
 */
export interface RoutingOptions {
  /** Whether to respect budget limits */
  respectBudget?: boolean;
  /** Whether to throw error if all accounts are over budget */
  strict?: boolean;
}

/**
 * Result from routing decision
 */
export interface RoutingResult {
  /** Selected account */
  account: Account;
  /** Name of the rule that matched */
  rule: string;
  /** Fallback account if available */
  fallback?: Account;
  /** Explanation of routing decision */
  reason: string;
  /** Warning message (e.g., budget warnings) */
  warning?: string;
}

/**
 * Account registry configuration (from YAML)
 */
export interface AccountsConfig {
  [accountId: string]: Omit<AccountConfig, 'id'>;
}

/**
 * Routing configuration (from YAML)
 */
export interface RoutingRulesConfig {
  rules: Array<Omit<RoutingRule, 'priority'> & { priority?: number }>;
}
