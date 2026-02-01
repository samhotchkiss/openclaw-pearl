/**
 * Pearl Memory Extractor
 * Analyzes messages for memorable content using LLM classification
 */

import type { MemoryType } from './store.js';
import { ScopeDetector, type ScopeContext } from './scope-detector.js';
import { createLogger } from '../utils/logger.js';

// ====== Types ======

export interface ExtractedMemory {
  type: MemoryType;
  content: string;
  confidence: number;
  tags: string[];
  // Scope detection fields
  scope?: 'global' | 'agent' | 'inferred';
  scope_confidence?: number;
  target_agent_id?: string;
  scope_reasoning?: string;
}

export interface ExtractionResult {
  memories: ExtractedMemory[];
  error?: string;
}

export interface LLMProvider {
  extract(message: string): Promise<ExtractionResult>;
}

export interface LLMProviderConfig {
  provider?: 'anthropic' | 'ollama' | 'openai';
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  minConfidence?: number;
}

// ====== Constants ======

/** Minimum message length to consider for extraction */
const MIN_MESSAGE_LENGTH = 15;

/** Patterns that indicate trivial/non-memorable content */
const TRIVIAL_PATTERNS = [
  // Greetings
  /^(hi|hey|hello|yo|sup|hiya|howdy)[\s!.,?]*$/i,
  /^good\s*(morning|afternoon|evening|night)[\s!.,?]*$/i,
  
  // Acknowledgments
  /^(ok|okay|sure|yes|no|yep|nope|yeah|nah|fine|alright|great|cool|nice|thanks|thx|ty|k)[\s!.,?]*$/i,
  /^(got it|sounds good|perfect|exactly|right|correct|agreed|understood)[\s!.,?]*$/i,
  
  // Simple questions without personal info
  /^how are you[\s?!.,]*$/i,
  /^what'?s up[\s?!.,]*$/i,
  /^how'?s it going[\s?!.,]*$/i,
  
  // Single word responses
  /^\w{1,4}[!?.]*$/,
];

/** Words that suggest substantive content worth extracting */
const SUBSTANTIVE_INDICATORS = [
  // Personal info
  /\b(my name is|i am called|call me)\b/i,
  /\b(i live|i'm from|i reside|i work at|i work for)\b/i,
  /\b(my (son|daughter|wife|husband|partner|mom|dad|brother|sister|child))\b/i,
  
  // Preferences
  /\b(i prefer|i like|i love|i hate|i dislike|i enjoy|i avoid)\b/i,
  /\b(always|never|every time)\b/i,
  
  // Rules/instructions
  /\b(always use|never use|make sure|don't forget|remember to)\b/i,
  
  // Decisions
  /\b(we decided|i've decided|decision is|let's go with)\b/i,
  
  // Facts with specifics
  /\b(born in|graduated from|allergic to|diagnosed with)\b/i,
  /\b\d{4,}\b/, // Numbers (years, phone numbers, etc.)
  /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/, // Proper names (two capitalized words)
  
  // Time-sensitive
  /\b(remind me|don't forget|due|deadline|appointment)\b/i,
];

/** Default extraction prompt following MEMORY.md spec */
const EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction system. Analyze the user's message and identify content worth remembering long-term.

Extract ONLY clear, explicit statements. Do not infer or assume.

Categories:
- fact: Concrete information (names, dates, addresses, numbers)
- preference: User likes/dislikes, opinions
- rule: Instructions for how the agent should behave
- decision: Choices made, with reasoning if given
- health: Medical information, medications, conditions
- reminder: Time-based notes
- relationship: People and their connections to the user

Return JSON:
{
  "memories": [
    {
      "type": "preference",
      "content": "User prefers concise responses",
      "tags": ["communication", "style"],
      "confidence": 0.9
    }
  ]
}

If nothing memorable, return: { "memories": [] }

Rules:
- Be conservative. Only extract clear statements.
- Normalize content (third person: "User prefers..." not "I prefer...")
- Include relevant tags for searchability
- Set confidence 0-1 based on clarity`;

// ====== Default LLM Provider (Mock for now) ======

/**
 * Default LLM provider that logs and returns empty
 * In production, this would be replaced with actual API calls
 */
class DefaultLLMProvider implements LLMProvider {
  private config: LLMProviderConfig;
  private logger = createLogger('memory-extractor');

  constructor(config: LLMProviderConfig = {}) {
    this.config = {
      provider: config.provider ?? 'anthropic',
      model: config.model ?? 'claude-sonnet-4-20250514',
      ...config,
    };
  }

  async extract(_message: string): Promise<ExtractionResult> {
    // In a real implementation, this would call the configured LLM
    // For now, return empty (production implementation would go here)
    this.logger.debug('LLM extraction placeholder called', {
      provider: this.config.provider,
      model: this.config.model,
      message: 'Would extract memories in production implementation'
    });
    return { memories: [] };
  }
}

// ====== Memory Extractor ======

export class MemoryExtractor {
  private provider: LLMProvider;
  private minConfidence: number;
  private scopeDetector: ScopeDetector;

  constructor(config: LLMProviderConfig = {}, provider?: LLMProvider, scopeDetector?: ScopeDetector) {
    this.minConfidence = config.minConfidence ?? 0.7;
    this.provider = provider ?? createProvider(config);
    this.scopeDetector = scopeDetector ?? new ScopeDetector();
  }

  /**
   * Extract memories from a message
   */
  async extract(message: string, context?: ScopeContext): Promise<ExtractionResult> {
    // Quick exit for trivial content
    if (this.isTrivial(message)) {
      return { memories: [] };
    }

    try {
      // Call the LLM provider
      const result = await this.provider.extract(message);

      // Check if the provider returned an error
      if (result.error) {
        return { memories: [], error: result.error };
      }

      // Validate and filter the response
      const validatedMemories = this.validateAndFilter(result.memories);

      // Add scope detection to each memory
      const memoriesWithScope = await this.addScopeDetection(validatedMemories, message, context);

      return { memories: memoriesWithScope };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { memories: [], error: errorMessage };
    }
  }

  /**
   * Check if a message is trivial and not worth sending to LLM
   */
  private isTrivial(message: string): boolean {
    // Too short to contain meaningful info
    if (message.trim().length < MIN_MESSAGE_LENGTH) {
      return true;
    }

    // Matches trivial patterns
    for (const pattern of TRIVIAL_PATTERNS) {
      if (pattern.test(message.trim())) {
        return true;
      }
    }

    // Check for substantive indicators
    // If any are present, it's NOT trivial
    for (const pattern of SUBSTANTIVE_INDICATORS) {
      if (pattern.test(message)) {
        return false;
      }
    }

    // Default: if message is somewhat long and doesn't match trivial patterns,
    // let the LLM decide
    return message.trim().length < 30;
  }

  /**
   * Validate and filter extracted memories
   */
  private validateAndFilter(memories: ExtractedMemory[]): ExtractedMemory[] {
    if (!Array.isArray(memories)) {
      return [];
    }

    return memories.filter((memory) => {
      // Must have required fields
      if (!memory.type || !memory.content) {
        return false;
      }

      // Must have valid type
      const validTypes: MemoryType[] = [
        'fact',
        'preference',
        'rule',
        'decision',
        'health',
        'reminder',
        'relationship',
      ];
      if (!validTypes.includes(memory.type)) {
        return false;
      }

      // Must meet confidence threshold
      if (typeof memory.confidence !== 'number' || memory.confidence < this.minConfidence) {
        return false;
      }

      // Ensure tags is an array
      if (!Array.isArray(memory.tags)) {
        memory.tags = [];
      }

      return true;
    });
  }

  /**
   * Add scope detection to extracted memories
   */
  private async addScopeDetection(
    memories: ExtractedMemory[],
    originalMessage: string,
    context?: ScopeContext
  ): Promise<ExtractedMemory[]> {
    if (!context) {
      // If no context provided, default to global scope
      return memories.map(memory => ({
        ...memory,
        scope: 'global' as const,
        scope_confidence: 0.5,
        scope_reasoning: 'no context provided, defaulting to global',
      }));
    }

    return memories.map(memory => {
      // Detect scope for this specific memory
      const scopeResult = this.scopeDetector.detectScope(
        memory.content,
        memory.type,
        context
      );

      return {
        ...memory,
        scope: scopeResult.scope,
        scope_confidence: scopeResult.confidence,
        target_agent_id: scopeResult.targetAgentId,
        scope_reasoning: scopeResult.reasoning,
      };
    });
  }

  /**
   * Get the extraction system prompt
   * Useful for custom provider implementations
   */
  getExtractionPrompt(): string {
    return EXTRACTION_SYSTEM_PROMPT;
  }
}

// ====== Provider Implementations ======

/**
 * Ollama LLM Provider
 * Uses local Ollama instance for extraction
 */
export class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;
  private systemPrompt: string;

  constructor(
    baseUrl: string = 'http://localhost:11434',
    model: string = 'llama3.2:3b',
    systemPrompt: string = EXTRACTION_SYSTEM_PROMPT
  ) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.systemPrompt = systemPrompt;
  }

  async extract(message: string): Promise<ExtractionResult> {
    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: `${this.systemPrompt}\n\nMessage to analyze:\n${message}`,
          stream: false,
          format: 'json',
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json() as { response: string };
      const parsed = JSON.parse(data.response) as ExtractionResult;

      return {
        memories: parsed.memories || [],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { memories: [], error: errorMessage };
    }
  }
}

/**
 * Anthropic LLM Provider
 * Uses Claude API for extraction
 */
export class AnthropicProvider implements LLMProvider {
  private apiKey: string;
  private model: string;
  private systemPrompt: string;

  constructor(
    apiKey: string,
    model: string = 'claude-sonnet-4-20250514',
    systemPrompt: string = EXTRACTION_SYSTEM_PROMPT
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.systemPrompt = systemPrompt;
  }

  async extract(message: string): Promise<ExtractionResult> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1024,
          system: this.systemPrompt,
          messages: [
            {
              role: 'user',
              content: `Analyze this message for memories:\n\n${message}`,
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Anthropic API error: ${response.status}`);
      }

      const data = await response.json() as {
        content: Array<{ type: string; text: string }>;
      };
      
      // Extract JSON from response
      const textContent = data.content.find((c) => c.type === 'text');
      if (!textContent) {
        return { memories: [] };
      }

      // Parse JSON from response (handle markdown code blocks)
      let jsonStr = textContent.text;
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      const parsed = JSON.parse(jsonStr.trim()) as ExtractionResult;

      return {
        memories: parsed.memories || [],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { memories: [], error: errorMessage };
    }
  }
}

/**
 * OpenAI LLM Provider
 * Uses OpenAI API for extraction
 */
export class OpenAIProvider implements LLMProvider {
  private apiKey: string;
  private model: string;
  private systemPrompt: string;
  private baseUrl: string;

  constructor(
    apiKey: string,
    model: string = 'gpt-4o-mini',
    systemPrompt: string = EXTRACTION_SYSTEM_PROMPT,
    baseUrl: string = 'https://api.openai.com/v1'
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.baseUrl = baseUrl;
  }

  async extract(message: string): Promise<ExtractionResult> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: this.systemPrompt },
            { role: 'user', content: `Analyze this message for memories:\n\n${message}` },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
      };
      
      const content = data.choices[0]?.message?.content;
      if (!content) {
        return { memories: [] };
      }

      const parsed = JSON.parse(content) as ExtractionResult;

      return {
        memories: parsed.memories || [],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { memories: [], error: errorMessage };
    }
  }
}

/**
 * Create an LLM provider from config
 */
export function createProvider(config: LLMProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'ollama':
      return new OllamaProvider(
        config.baseUrl ?? 'http://localhost:11434',
        config.model ?? 'llama3.2:3b'
      );
    case 'openai':
      if (!config.apiKey) {
        throw new Error('OpenAI provider requires apiKey');
      }
      return new OpenAIProvider(
        config.apiKey,
        config.model ?? 'gpt-4o-mini'
      );
    case 'anthropic':
    default:
      if (!config.apiKey && config.provider === 'anthropic') {
        throw new Error('Anthropic provider requires apiKey');
      }
      // Default to mock provider if no API key
      if (!config.apiKey) {
        return new DefaultLLMProvider(config);
      }
      return new AnthropicProvider(
        config.apiKey,
        config.model ?? 'claude-sonnet-4-20250514'
      );
  }
}
