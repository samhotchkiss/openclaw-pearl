/**
 * Configuration system for Pearl
 * 
 * Provides YAML-based configuration loading with:
 * - Environment variable substitution (${VAR} and ${VAR:-default})
 * - Sensible defaults
 * - Configuration validation
 * - Tilde expansion for file paths
 */

export { loadConfig } from './loader.js';
export { getDefaults } from './defaults.js';
export { validateConfig } from './validate.js';
export type * from './types.js';