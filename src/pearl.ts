/**
 * Pearl - Main Orchestrator Class
 * Coordinates all components to provide memory-enhanced chat completions
 */

import { uuidv7 } from 'uuidv7';
import { MemoryStore } from './memory/store.js';
import { MemoryExtractor, createProvider } from './memory/extractor.js';
import { MemoryRetriever } from './memory/retriever.js';
import { PromptAugmenter } from './memory/augmenter.js';
import { createEmbeddingProvider } from './memory/embeddings.js';
import { ModelRouter } from './routing/router.js';
import { RuleEngine, createRulesFromConfig } from './routing/rules.js';
import { createBackendClient } from './backends/index.js';
import type {
  PearlConfig,
  ChatRequest,
  ChatChunk,
  ChatMessage,
  BackendClient,
  RoutingResult,
  ScoredMemory,
  ExtractedMemory,
  AugmentResult,
  SunriseConfig,
} from './types.js';
import { 
  SunriseService, 
  createSunriseService,
  TranscriptLogger,
  type SunriseHandleResult 
} from './sunrise/index.js';

interface RequestMetadata {
  agentId: string;
  sessionId: string;
}

interface ExtractionQueue {
  agentId: string;
  sessionId: string;
  message: ChatMessage;
  timestamp: number;
}

export class Pearl {
  private config: PearlConfig;
  private initialized = false;
  
  // Core components
  private memoryStore!: MemoryStore;
  private extractor!: MemoryExtractor;
  private retriever!: MemoryRetriever;
  private augmenter!: PromptAugmenter;
  private router!: ModelRouter;
  private backends!: Map<string, BackendClient>;
  
  // Sunrise components
  private sunriseService?: SunriseService;
  private transcriptLogger?: TranscriptLogger;
  
  // Session tracking
  private sessionMemories = new Map<string, Set<string>>(); // sessionId -> Set<memoryId>
  
  // Extraction queue for async processing
  private extractionQueue: ExtractionQueue[] = [];
  private extractionWorkerRunning = false;

  constructor(config: PearlConfig) {
    this.config = config;
  }

  /**
   * Initialize all components
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      throw new Error('Pearl is already initialized');
    }

    try {
      // Initialize memory store
      this.memoryStore = new MemoryStore(this.config.memory.path);
      await this.memoryStore.initialize();

      // Initialize embedding provider
      const embeddingProvider = createEmbeddingProvider(this.config.embedding);

      // Initialize memory components
      const llmProvider = createProvider({
        provider: this.config.extraction.model.startsWith('ollama/') ? 'ollama' : 'anthropic',
        model: this.config.extraction.model,
        baseUrl: this.config.backends.ollama?.baseUrl,
        apiKey: this.config.backends.anthropic?.api_key,
        minConfidence: this.config.extraction.minConfidence,
      });

      this.extractor = new MemoryExtractor(llmProvider);
      this.retriever = new MemoryRetriever(this.memoryStore, embeddingProvider, this.config.retrieval);
      this.augmenter = new PromptAugmenter(this.retriever);

      // Initialize routing
      const rules = createRulesFromConfig(this.config.routing.rules, this.config.routing.default_model);
      const ruleEngine = new RuleEngine(rules);
      this.router = new ModelRouter(ruleEngine, {
        agentOverrides: this.config.routing.agentOverrides,
        fallbackChains: this.config.routing.fallback,
        classificationOptions: {
          model: this.config.routing.classifier,
        },
      });

      // Initialize backend clients
      // Helper to check if API key is valid (not a placeholder)
      const isValidApiKey = (key?: string): boolean => {
        if (!key) return false;
        // Skip placeholder values like ${VAR}
        if (key.startsWith('${') && key.endsWith('}')) return false;
        // Skip obviously invalid keys
        if (key === 'test-key-not-used' || key.length < 10) return false;
        return true;
      };

      this.backends = new Map();
      
      console.log('[Pearl] Checking Anthropic backend...');
      console.log('[Pearl] config.backends.anthropic:', !!this.config.backends.anthropic);
      console.log('[Pearl] api_key present:', !!this.config.backends.anthropic?.api_key);
      console.log('[Pearl] api_key valid:', isValidApiKey(this.config.backends.anthropic?.api_key));
      
      if (this.config.backends.anthropic && isValidApiKey(this.config.backends.anthropic.api_key)) {
        try {
          console.log('[Pearl] Creating Anthropic backend...');
          this.backends.set('anthropic', createBackendClient('anthropic', this.config.backends.anthropic));
          console.log('[Pearl] Anthropic backend created successfully');
        } catch (error) {
          console.warn('Failed to initialize Anthropic backend:', error);
        }
      }
      
      if (this.config.backends.openai && isValidApiKey(this.config.backends.openai.api_key)) {
        try {
          this.backends.set('openai', createBackendClient('openai', this.config.backends.openai));
        } catch (error) {
          console.warn('Failed to initialize OpenAI backend:', error);
        }
      }
      
      if (this.config.backends.ollama) {
        this.backends.set('ollama', createBackendClient('ollama', this.config.backends.ollama));
      }
      
      if (this.config.backends.openrouter && isValidApiKey(this.config.backends.openrouter.api_key)) {
        try {
          this.backends.set('openrouter', createBackendClient('openrouter', this.config.backends.openrouter));
        } catch (error) {
          console.warn('Failed to initialize OpenRouter backend:', error);
        }
      }

      // Initialize sunrise service if enabled
      if (this.config.sunrise?.enabled) {
        this.sunriseService = createSunriseService({
          transcriptPath: this.config.sunrise.transcriptPath,
          summary: {
            provider: this.determineSunriseProvider(this.config.sunrise.model),
            model: this.extractSunriseModel(this.config.sunrise.model),
            apiKey: this.getSunriseApiKey(this.config.sunrise.model),
            baseUrl: this.getSunriseBaseUrl(this.config.sunrise.model),
          },
          gapThresholdMs: this.config.sunrise.gapThresholdMs,
          lookbackMs: this.config.sunrise.lookbackMs,
          maxMessages: this.config.sunrise.maxMessages,
          minMessages: this.config.sunrise.minMessages,
        });
        
        this.transcriptLogger = new TranscriptLogger(this.config.sunrise.transcriptPath);
      }

      // Start extraction worker if async extraction is enabled
      if (this.config.extraction.enabled && this.config.extraction.async) {
        this.startExtractionWorker();
      }

      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize Pearl: ${error}`);
    }
  }

  /**
   * Check if Pearl is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Main chat completion endpoint
   */
  async* chatCompletion(request: ChatRequest): AsyncGenerator<ChatChunk> {
    if (!this.initialized) {
      throw new Error('Pearl not initialized. Call initialize() first.');
    }

    try {
      // 1. Extract request metadata
      const metadata = this.extractRequestMetadata(request);

      // 2. Queue user message for async extraction (non-blocking)
      if (this.config.extraction.enabled) {
        try {
          this.queueMemoryExtraction(metadata.agentId, metadata.sessionId, request.messages[request.messages.length - 1]);
        } catch (error) {
          // Log but don't block - extraction errors should never affect the main flow
          console.error('Memory extraction queue error:', error);
        }
      }

      // 3. Handle sunrise session recovery (if enabled)
      let messagesToAugment = request.messages;
      let sunriseInjected = false;
      
      if (this.sunriseService && this.transcriptLogger) {
        const sunriseResult = await this.handleSunriseRecovery(
          metadata.agentId, 
          metadata.sessionId, 
          request.messages,
          request.metadata?.forceSunrise
        );
        messagesToAugment = sunriseResult.messages;
        sunriseInjected = sunriseResult.summaryInjected;
      }

      // 4. Augment prompt with memories (includes retrieval)
      const augmentedRequest = await this.augmentPrompt(messagesToAugment, metadata.agentId, metadata.sessionId);

      // 5. Route to appropriate backend
      const routing = await this.routeRequest(augmentedRequest.messages, metadata.agentId);
      console.log(`[Pearl] Routed: ${request.model} → ${routing.model} (rule: ${routing.rule}, complexity: ${routing.classification.complexity}, type: ${routing.classification.type})`);

      // 6. Forward to backend and stream response
      let assistantResponse = '';
      const modifiedRequest = {
        ...request,
        model: routing.model,
        messages: augmentedRequest.messages,
        // Pass routing metadata for logging
        _routing: routing,
      };

      for await (const chunk of this.forwardToBackend(routing.model, modifiedRequest)) {
        // Collect assistant response content for potential extraction
        if (chunk.choices?.[0]?.delta?.content) {
          assistantResponse += chunk.choices[0].delta.content;
        }

        yield chunk;

        // If this is the final chunk and we should extract assistant responses
        if (chunk.choices?.[0]?.finishReason && this.config.extraction.extractFromAssistant) {
          const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: assistantResponse,
          };
          this.queueMemoryExtraction(metadata.agentId, metadata.sessionId, assistantMessage);
        }
        
        // Log conversation to transcript for future sunrise recovery
        if (chunk.choices?.[0]?.finishReason && this.transcriptLogger) {
          await this.logConversationToTranscript(
            metadata.agentId,
            metadata.sessionId,
            request.messages,
            assistantResponse
          );
        }
      }

      // Track injected memories for this session
      this.trackInjectedMemories(metadata.sessionId, augmentedRequest.injectedMemories);

    } catch (error) {
      // Log error and re-throw for proper error handling
      console.error('Pearl chat completion error:', error);
      throw error;
    }
  }

  /**
   * Extract agent_id and session_id from request
   */
  private extractRequestMetadata(request: ChatRequest): RequestMetadata {
    const agentId = request.metadata?.agentId || 'unknown-agent';
    const sessionId = request.metadata?.sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return { agentId, sessionId };
  }

  /**
   * Queue message for async memory extraction
   */
  private queueMemoryExtraction(agentId: string, sessionId: string, message: ChatMessage): void {
    if (!this.config.extraction.enabled) {
      return;
    }

    this.extractionQueue.push({
      agentId,
      sessionId,
      message,
      timestamp: Date.now(),
    });
  }

  /**
   * Augment prompt with retrieved memories
   */
   private async augmentPrompt(messages: ChatMessage[], agentId: string, sessionId: string): Promise<AugmentResult> {
    return await this.augmenter.augment(agentId, messages, {
      sessionId,
      tokenBudget: this.config.retrieval.tokenBudget,
      maxMemories: this.config.retrieval.maxMemories,
      minScore: this.config.retrieval.minSimilarity,
    });
  }

  /**
   * Route request to appropriate backend model
   */
  private async routeRequest(messages: ChatMessage[], agentId?: string): Promise<RoutingResult> {
    return await this.router.route(messages, agentId);
  }

  /**
   * Forward request to backend and stream response
   */
  private async* forwardToBackend(model: string, request: ChatRequest): AsyncGenerator<ChatChunk> {
    // Determine which backend to use based on model prefix
    const backendName = this.getBackendFromModel(model);
    const backend = this.backends.get(backendName);

    if (!backend) {
      throw new Error(`No backend available for model: ${model}`);
    }

    // Forward the request to the appropriate backend
    for await (const chunk of backend.chat(request)) {
      yield chunk;
    }
  }

  /**
   * Determine backend from model name
   */
  private getBackendFromModel(model: string): string {
    if (model.startsWith('anthropic-max/') || model.startsWith('anthropic/') || model.startsWith('claude')) {
      return 'anthropic';
    }
    if (model.startsWith('openai/') || model.startsWith('gpt')) {
      return 'openai';
    }
    if (model.startsWith('ollama/')) {
      return 'ollama';
    }
    if (model.startsWith('openrouter/')) {
      return 'openrouter';
    }

    // Default fallback
    return 'anthropic';
  }

  /**
   * Track injected memory IDs for session to avoid duplication
   */
  private trackInjectedMemories(sessionId: string, memoryIds: string[]): void {
    if (!this.sessionMemories.has(sessionId)) {
      this.sessionMemories.set(sessionId, new Set());
    }

    const sessionSet = this.sessionMemories.get(sessionId)!;
    memoryIds.forEach(id => sessionSet.add(id));
  }

  /**
   * Start background worker for async memory extraction
   */
  private startExtractionWorker(): void {
    if (this.extractionWorkerRunning) {
      return;
    }

    this.extractionWorkerRunning = true;

    const processQueue = async (): Promise<void> => {
      while (this.extractionWorkerRunning) {
        try {
          if (this.extractionQueue.length > 0) {
            const item = this.extractionQueue.shift()!;
            await this.processMemoryExtraction(item);
          } else {
            // Wait a bit before checking again
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (error) {
          console.error('Memory extraction worker error:', error);
          // Continue processing despite errors
        }
      }
    };

    // Start the worker in background
    processQueue().catch(error => {
      console.error('Memory extraction worker crashed:', error);
      this.extractionWorkerRunning = false;
    });
  }

  /**
   * Process a single memory extraction
   */
  private async processMemoryExtraction(item: ExtractionQueue): Promise<void> {
    try {
      const result = await this.extractor.extract(item.message.content);

      if (result.memories && result.memories.length > 0) {
        for (const memory of result.memories) {
          await this.memoryStore.create(item.agentId, {
            type: memory.type,
            content: memory.content,
            tags: memory.tags,
            sourceSession: item.sessionId,
            sourceMessageId: uuidv7(),
          });
        }
      }
    } catch (error) {
      console.error(`Memory extraction failed for agent ${item.agentId}:`, error);
    }
  }

  /**
   * Handle sunrise session recovery
   */
  private async handleSunriseRecovery(
    agentId: string,
    sessionId: string,
    messages: ChatMessage[],
    forceSunrise?: boolean
  ): Promise<SunriseHandleResult> {
    if (!this.sunriseService) {
      return { messages, summaryInjected: false };
    }

    const options = forceSunrise ? { forceSunrise: true } : {};
    return await this.sunriseService.handleRequest(agentId, sessionId, messages, options);
  }

  /**
   * Log conversation to transcript for future sunrise recovery
   */
  private async logConversationToTranscript(
    agentId: string,
    sessionId: string,
    userMessages: ChatMessage[],
    assistantResponse: string
  ): Promise<void> {
    if (!this.transcriptLogger) {
      return;
    }

    try {
      // Log user messages
      for (const message of userMessages) {
        if (message.role === 'user') {
          await this.transcriptLogger.log(agentId, sessionId, {
            role: 'user',
            content: message.content,
            timestamp: Date.now(),
            messageId: uuidv7(),
          });
        }
      }

      // Log assistant response
      if (assistantResponse.trim()) {
        await this.transcriptLogger.log(agentId, sessionId, {
          role: 'assistant',
          content: assistantResponse,
          timestamp: Date.now(),
          messageId: uuidv7(),
        });
      }
    } catch (error) {
      console.error('Failed to log conversation to transcript:', error);
    }
  }

  /**
   * Helper methods for sunrise configuration
   */
  private determineSunriseProvider(model: string): 'ollama' | 'anthropic' | 'openai' {
    if (model.startsWith('ollama/')) {
      return 'ollama';
    }
    if (model.startsWith('openai/') || model.startsWith('gpt')) {
      return 'openai';
    }
    return 'anthropic'; // default
  }

  private extractSunriseModel(model: string): string {
    if (model.includes('/')) {
      return model.split('/')[1];
    }
    return model;
  }

  private getSunriseApiKey(model: string): string | undefined {
    if (model.startsWith('anthropic/')) {
      return this.config.backends.anthropic?.api_key;
    }
    if (model.startsWith('openai/') || model.startsWith('gpt')) {
      return this.config.backends.openai?.api_key;
    }
    return undefined;
  }

  private getSunriseBaseUrl(model: string): string | undefined {
    if (model.startsWith('ollama/')) {
      return this.config.backends.ollama?.baseUrl;
    }
    if (model.startsWith('openai/')) {
      return this.config.backends.openai?.baseUrl;
    }
    return undefined;
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.extractionWorkerRunning = false;

    // Wait for any pending extractions to complete
    while (this.extractionQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Close memory store
    if (this.memoryStore) {
      await this.memoryStore.close();
    }

    this.initialized = false;
  }
}