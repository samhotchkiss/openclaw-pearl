/**
 * Request classification types for routing system
 */

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface RequestClassification {
  complexity: 'low' | 'medium' | 'high';
  type: 'general' | 'code' | 'creative' | 'analysis' | 'chat';
  sensitive: boolean;
  estimatedTokens: number;
  requiresTools: boolean;
  reasoning?: string; // Optional reasoning from LLM classification
}

export interface ClassificationOptions {
  useHeuristicsOnly?: boolean;
  useLLMClassification?: boolean;
  model?: string; // LLM model for classification
}

export interface SensitiveDetectionResult {
  isSensitive: boolean;
  reasons: string[]; // What was detected (e.g., ["SSN", "Credit Card"])
}

export interface TokenEstimate {
  estimate: number;
  method: 'character_count' | 'word_count' | 'gpt_estimate';
}

export interface TypeDetectionResult {
  type: 'general' | 'code' | 'creative' | 'analysis' | 'chat';
  confidence: number; // 0-1
  keywords: string[]; // Keywords that triggered detection
}

export interface ComplexityAnalysis {
  complexity: 'low' | 'medium' | 'high';
  factors: {
    length: number;
    questionWords: number;
    technicalTerms: number;
    requestType: string;
  };
}

export interface ClassifierMetrics {
  heuristicClassifications: number;
  llmClassifications: number;
  averageClassificationTime: number;
  sensitiveContentDetected: number;
}