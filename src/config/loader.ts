import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { parse as parseYaml } from 'yaml';
import { getDefaults } from './defaults.js';
import { validateConfig } from './validate.js';
import type { Config } from './types.js';

/**
 * Load configuration from YAML file with environment variable substitution
 * @param configPath Path to config file (defaults to 'pearl.yaml' in cwd)
 * @returns Parsed and validated configuration
 */
export async function loadConfig(configPath?: string): Promise<Config> {
  const path = configPath || 'pearl.yaml';
  const defaults = getDefaults();

  // If config file doesn't exist and using default path, return defaults
  // If specific path given and doesn't exist, throw error
  if (!existsSync(path)) {
    if (configPath && configPath !== 'pearl.yaml') {
      // Specific path was provided but file doesn't exist
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    // Using default path and no file exists - return defaults
    validateConfig(defaults);
    return defaults;
  }

  try {
    // Read and parse YAML
    const content = readFileSync(path, 'utf8');
    const parsed = parseYaml(content);

    // Handle empty or comment-only files
    const userConfig = parsed || {};

    // Perform environment variable substitution
    const substituted = substituteEnvironmentVariables(userConfig);

    // Perform tilde expansion
    const expanded = expandTildes(substituted);

    // Deep merge with defaults
    const merged = deepMerge(defaults, expanded);

    // Validate final configuration
    validateConfig(merged);

    return merged;
  } catch (error) {
    throw new Error(`Failed to load config from ${path}: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Recursively substitute environment variables in configuration
 * Supports ${VAR} and ${VAR:-default} syntax
 */
function substituteEnvironmentVariables(obj: any): any {
  if (typeof obj === 'string') {
    // Check if the entire string is a single environment variable substitution
    const singleVarMatch = obj.match(/^\$\{([^}]+)\}$/);
    if (singleVarMatch) {
      const varSpec = singleVarMatch[1];
      const [varName, defaultValue] = varSpec.split(':-');
      const envValue = process.env[varName];

      if (envValue !== undefined) {
        return parseValue(envValue);
      }

      if (defaultValue !== undefined) {
        return parseValue(defaultValue);
      }

      // Return original placeholder if no env var and no default
      return obj;
    }

    // Handle multiple substitutions within a string (keep as string)
    return obj.replace(/\$\{([^}]+)\}/g, (match, varSpec) => {
      const [varName, defaultValue] = varSpec.split(':-');
      const envValue = process.env[varName];

      if (envValue !== undefined) {
        return envValue; // Don't parse, keep as string for interpolation
      }

      if (defaultValue !== undefined) {
        return defaultValue; // Don't parse, keep as string for interpolation
      }

      return match;
    });
  }

  if (Array.isArray(obj)) {
    return obj.map(substituteEnvironmentVariables);
  }

  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteEnvironmentVariables(value);
    }
    return result;
  }

  return obj;
}

/**
 * Parse a string value as number, boolean, or string
 */
function parseValue(value: string): any {
  // Empty string
  if (value === '') {
    return '';
  }

  // Boolean values
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }

  // Numeric values
  const num = Number(value);
  if (!isNaN(num) && isFinite(num)) {
    return num;
  }

  // String value
  return value;
}

/**
 * Expand tilde paths to absolute paths
 */
function expandTildes(obj: any): any {
  if (typeof obj === 'string' && obj.startsWith('~/')) {
    return obj.replace('~', homedir());
  }

  if (Array.isArray(obj)) {
    return obj.map(expandTildes);
  }

  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandTildes(value);
    }
    return result;
  }

  return obj;
}

/**
 * Deep merge two objects, with source taking precedence over target
 */
function deepMerge(target: any, source: any): any {
  if (!isObject(target) || !isObject(source)) {
    return source;
  }

  const result = { ...target };

  for (const [key, value] of Object.entries(source)) {
    if (isObject(value) && isObject(target[key])) {
      result[key] = deepMerge(target[key], value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Check if a value is a plain object (not array or null)
 */
function isObject(obj: any): boolean {
  return obj && typeof obj === 'object' && !Array.isArray(obj);
}