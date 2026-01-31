/**
 * Cost calculator for LLM usage
 */

import type { TokenUsage } from '../backends/types.js';
import type { CostConfig, ModelPricing, ICostCalculator } from './types.js';

/**
 * Default cost configuration with current pricing as of 2024
 */
export const DEFAULT_COST_CONFIG: CostConfig = {
  anthropic: {
    'claude-3-5-sonnet-20241022': {
      inputCostPer1kTokens: 0.003,
      outputCostPer1kTokens: 0.015,
      cacheCostPer1kTokens: 0.0003
    },
    'claude-3-5-sonnet-20240620': {
      inputCostPer1kTokens: 0.003,
      outputCostPer1kTokens: 0.015,
      cacheCostPer1kTokens: 0.0003
    },
    'claude-3-sonnet-20240229': {
      inputCostPer1kTokens: 0.003,
      outputCostPer1kTokens: 0.015
    },
    'claude-3-opus-20240229': {
      inputCostPer1kTokens: 0.015,
      outputCostPer1kTokens: 0.075
    },
    'claude-3-haiku-20240307': {
      inputCostPer1kTokens: 0.00025,
      outputCostPer1kTokens: 0.00125
    },
    // Legacy aliases
    'claude-3-5-sonnet': {
      inputCostPer1kTokens: 0.003,
      outputCostPer1kTokens: 0.015,
      cacheCostPer1kTokens: 0.0003
    },
    'claude-3-sonnet': {
      inputCostPer1kTokens: 0.003,
      outputCostPer1kTokens: 0.015
    },
    'claude-3-opus': {
      inputCostPer1kTokens: 0.015,
      outputCostPer1kTokens: 0.075
    },
    'claude-3-haiku': {
      inputCostPer1kTokens: 0.00025,
      outputCostPer1kTokens: 0.00125
    }
  },
  openai: {
    'gpt-4o': {
      inputCostPer1kTokens: 0.0025,
      outputCostPer1kTokens: 0.01
    },
    'gpt-4o-mini': {
      inputCostPer1kTokens: 0.00015,
      outputCostPer1kTokens: 0.0006
    },
    'gpt-4-turbo': {
      inputCostPer1kTokens: 0.01,
      outputCostPer1kTokens: 0.03
    },
    'gpt-4': {
      inputCostPer1kTokens: 0.03,
      outputCostPer1kTokens: 0.06
    },
    'gpt-4-32k': {
      inputCostPer1kTokens: 0.06,
      outputCostPer1kTokens: 0.12
    },
    'gpt-3.5-turbo': {
      inputCostPer1kTokens: 0.0005,
      outputCostPer1kTokens: 0.0015
    },
    'gpt-3.5-turbo-16k': {
      inputCostPer1kTokens: 0.003,
      outputCostPer1kTokens: 0.004
    }
  },
  openrouter: {
    // OpenRouter uses dynamic pricing, these are approximate averages
    'anthropic/claude-3-5-sonnet': {
      inputCostPer1kTokens: 0.003,
      outputCostPer1kTokens: 0.015
    },
    'openai/gpt-4o': {
      inputCostPer1kTokens: 0.005,
      outputCostPer1kTokens: 0.015
    },
    'meta-llama/llama-3.1-70b-instruct': {
      inputCostPer1kTokens: 0.0009,
      outputCostPer1kTokens: 0.0009
    },
    'google/gemini-pro-1.5': {
      inputCostPer1kTokens: 0.001,
      outputCostPer1kTokens: 0.002
    }
  },
  gemini: {
    'gemini-1.5-pro': {
      inputCostPer1kTokens: 0.00125,
      outputCostPer1kTokens: 0.005
    },
    'gemini-1.5-flash': {
      inputCostPer1kTokens: 0.000075,
      outputCostPer1kTokens: 0.0003
    },
    'gemini-pro': {
      inputCostPer1kTokens: 0.0005,
      outputCostPer1kTokens: 0.0015
    }
  },
  ollama: {
    // Ollama is local/free
    '*': {
      inputCostPer1kTokens: 0,
      outputCostPer1kTokens: 0
    }
  }
};

/**
 * Calculator for LLM usage costs
 */
export class CostCalculator implements ICostCalculator {
  private costConfig: CostConfig;

  constructor(costConfig: CostConfig = DEFAULT_COST_CONFIG) {
    this.costConfig = costConfig;
  }

  /**
   * Calculate cost for a request
   */
  calculateCost(provider: string, model: string, usage: TokenUsage): number {
    const pricing = this.getPricing(provider, model);
    if (!pricing) {
      return 0;
    }

    const inputCost = (usage.promptTokens * pricing.inputCostPer1kTokens) / 1000;
    const outputCost = (usage.completionTokens * pricing.outputCostPer1kTokens) / 1000;
    
    // Cache cost is optional and currently not widely used
    let cacheCost = 0;
    if (pricing.cacheCostPer1kTokens && usage.totalTokens > usage.promptTokens + usage.completionTokens) {
      const cacheTokens = usage.totalTokens - usage.promptTokens - usage.completionTokens;
      cacheCost = (cacheTokens * pricing.cacheCostPer1kTokens) / 1000;
    }

    return inputCost + outputCost + cacheCost;
  }

  /**
   * Get pricing for a model
   */
  getPricing(provider: string, model: string): ModelPricing | undefined {
    const providerConfig = this.costConfig[provider];
    if (!providerConfig) {
      return undefined;
    }

    // Try exact model match first
    let modelConfig = providerConfig[model];
    if (modelConfig) {
      return modelConfig;
    }

    // Try wildcard match
    modelConfig = providerConfig['*'];
    if (modelConfig) {
      return modelConfig;
    }

    return undefined;
  }

  /**
   * Get all providers
   */
  getProviders(): string[] {
    return Object.keys(this.costConfig);
  }

  /**
   * Get models for a provider
   */
  getModels(provider: string): string[] {
    const providerConfig = this.costConfig[provider];
    if (!providerConfig) {
      return [];
    }

    return Object.keys(providerConfig).filter(key => key !== '*');
  }

  /**
   * Update cost configuration
   */
  updateConfig(newConfig: Partial<CostConfig>): void {
    this.costConfig = {
      ...this.costConfig,
      ...newConfig
    };
  }

  /**
   * Add or update pricing for a specific model
   */
  setPricing(provider: string, model: string, pricing: ModelPricing): void {
    if (!this.costConfig[provider]) {
      this.costConfig[provider] = {};
    }
    this.costConfig[provider][model] = pricing;
  }

  /**
   * Get the current cost configuration
   */
  getConfig(): CostConfig {
    return { ...this.costConfig };
  }

  /**
   * Estimate cost for a request before making it
   */
  estimateCost(
    provider: string, 
    model: string, 
    estimatedPromptTokens: number,
    estimatedCompletionTokens: number = 0
  ): number {
    const usage: TokenUsage = {
      promptTokens: estimatedPromptTokens,
      completionTokens: estimatedCompletionTokens,
      totalTokens: estimatedPromptTokens + estimatedCompletionTokens
    };

    return this.calculateCost(provider, model, usage);
  }

  /**
   * Get cost per token for a model (useful for budgeting)
   */
  getCostPerToken(provider: string, model: string): {
    inputCostPerToken: number;
    outputCostPerToken: number;
  } | undefined {
    const pricing = this.getPricing(provider, model);
    if (!pricing) {
      return undefined;
    }

    return {
      inputCostPerToken: pricing.inputCostPer1kTokens / 1000,
      outputCostPerToken: pricing.outputCostPer1kTokens / 1000
    };
  }
}