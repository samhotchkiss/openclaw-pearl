/**
 * Accounts module - Multi-account management with routing
 */

export { AccountRegistry } from './registry.js';
export { AccountRouter, NoAccountAvailableError } from './router.js';
export type {
  Provider,
  AuthType,
  Account,
  AccountConfig,
  AccountsConfig,
  BudgetStatus,
  MatchConditions,
  RoutingRule,
  RoutingContext,
  RoutingOptions,
  RoutingResult,
  RoutingRulesConfig,
} from './types.js';
