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

import { UsageTracker as UsageTrackerClass } from './tracker.js';
import { CostCalculator as CostCalculatorClass } from './calculator.js';
import { SQLiteUsageStore as SQLiteUsageStoreClass } from './sqlite-store.js';

// Convenience function to create a usage tracking system
export function createUsageTracker(options: {
  dbPath?: string;
  costConfig?: import('./types.js').CostConfig;
}): {
  tracker: UsageTrackerClass;
  calculator: CostCalculatorClass;
  store: SQLiteUsageStoreClass;
} {
  const { dbPath = 'usage.db', costConfig } = options;
  
  const store = new SQLiteUsageStoreClass(dbPath);
  const calculator = new CostCalculatorClass(costConfig);
  const tracker = new UsageTrackerClass(store);
  
  return { tracker, calculator, store };
}