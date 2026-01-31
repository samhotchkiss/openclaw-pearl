/**
 * Usage tracking module for per-account LLM cost monitoring
 */

// Types
export type {
  UsageRecord,
  UsageQuery,
  UsageSummary,
  RecordUsageParams,
  ModelPricing,
  ProviderPricing,
  CostConfig,
  UsageStore,
  IUsageTracker,
  ICostCalculator
} from './types.js';

// Main classes
export { UsageTracker } from './tracker.js';
export { CostCalculator, DEFAULT_COST_CONFIG } from './calculator.js';
export { SQLiteUsageStore } from './sqlite-store.js';

// Convenience function to create a usage tracking system
export function createUsageTracker(options: {
  dbPath?: string;
  costConfig?: import('./types.js').CostConfig;
}): {
  tracker: UsageTracker;
  calculator: CostCalculator;
  store: SQLiteUsageStore;
} {
  const { dbPath = 'usage.db', costConfig } = options;
  
  const store = new SQLiteUsageStore(dbPath);
  const calculator = new CostCalculator(costConfig);
  const tracker = new UsageTracker(store);
  
  return { tracker, calculator, store };
}