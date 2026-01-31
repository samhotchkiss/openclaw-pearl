import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoryExtractor,
  type ExtractedMemory,
  type ExtractionResult,
  type LLMProvider,
} from '../src/memory/extractor.js';
import {
  ScopeDetector,
  type ScopeContext,
} from '../src/memory/scope-detector.js';
import { MemoryStore, type MemoryInput } from '../src/memory/store.js';
import { MemoryRetriever } from '../src/memory/retriever.js';
import { MockEmbeddingService } from './test-utils/mock-embedding.js';

/**
 * Mock LLM provider for testing
 */
function createMockProvider(
  response: ExtractionResult | (() => ExtractionResult)
): LLMProvider {
  return {
    async extract(_message: string): Promise<ExtractionResult> {
      return typeof response === 'function' ? response() : response;
    },
  };
}

describe('Memory System Scope Integration', () => {
  let extractor: MemoryExtractor;
  let store: MemoryStore;
  let retriever: MemoryRetriever;
  let embeddings: MockEmbeddingService;

  beforeEach(() => {
    // Setup in-memory store
    store = new MemoryStore(':memory:');
    
    // Setup mock embeddings
    embeddings = new MockEmbeddingService();
    
    // Setup retriever
    retriever = new MemoryRetriever(store, embeddings);
  });

  describe('Extraction with Scope Detection', () => {
    beforeEach(() => {
      const mockProvider = createMockProvider({
        memories: [
          {
            type: 'preference',
            content: 'User prefers dark mode',
            confidence: 0.9,
            tags: ['ui', 'appearance'],
          },
        ],
      });

      extractor = new MemoryExtractor({}, mockProvider);
    });

    it('detects global scope for main DM channel', async () => {
      const context: ScopeContext = {
        channel: 'main',
        channelType: 'dm',
        agentId: 'main',
      };

      const result = await extractor.extract(
        'I prefer dark mode for all interfaces',
        context
      );

      expect(result.memories).toHaveLength(1);
      const memory = result.memories[0];
      expect(memory.scope).toBe('global');
      expect(memory.scope_confidence).toBeGreaterThan(0.7);
      expect(memory.scope_reasoning).toContain('user preferences typically global');
    });

    it('detects agent scope for explicit agent mention', async () => {
      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const mockProvider = createMockProvider({
        memories: [
          {
            type: 'rule',
            content: 'Always use casual tone for blog posts',
            confidence: 0.9,
            tags: ['writing', 'style'],
          },
        ],
      });

      const extractor = new MemoryExtractor({}, mockProvider);

      const result = await extractor.extract(
        'Tex should always use casual tone for blog posts',
        context
      );

      expect(result.memories).toHaveLength(1);
      const memory = result.memories[0];
      expect(memory.scope).toBe('agent');
      expect(memory.target_agent_id).toBe('tex');
      expect(memory.scope_confidence).toBeGreaterThan(0.9);
    });

    it('defaults to global when no context provided', async () => {
      const mockProvider = createMockProvider({
        memories: [
          {
            type: 'preference',
            content: 'User likes pizza and Italian food',
            confidence: 0.8,
            tags: ['food'],
          },
        ],
      });

      const extractor = new MemoryExtractor({}, mockProvider);
      const result = await extractor.extract('I like pizza and Italian food');

      expect(result.memories).toHaveLength(1);
      const memory = result.memories[0];
      expect(memory.scope).toBe('global');
      expect(memory.scope_confidence).toBe(0.5);
      expect(memory.scope_reasoning).toContain('no context provided');
    });

    it('handles multiple memories with different scopes', async () => {
      const mockProvider = createMockProvider({
        memories: [
          {
            type: 'relationship',
            content: 'User has a son named Noah',
            confidence: 0.9,
            tags: ['family'],
          },
          {
            type: 'rule',
            content: 'Always format code with 2-space indents',
            confidence: 0.85,
            tags: ['coding', 'style'],
          },
        ],
      });

      const extractor = new MemoryExtractor({}, mockProvider);

      const context: ScopeContext = {
        channel: 'general',
        agentId: 'main',
      };

      const result = await extractor.extract(
        'My son Noah is 8 years old and Nova should always format code with 2-space indents',
        context
      );

      expect(result.memories).toHaveLength(2);
      
      // Family relationship should be global (personal info)
      const familyMemory = result.memories.find(m => m.content.includes('Noah'));
      expect(familyMemory?.scope).toBe('global');

      // Code formatting rule should be agent-specific
      const codeMemory = result.memories.find(m => m.content.includes('format code'));
      expect(codeMemory?.scope).toBe('agent');
      expect(codeMemory?.target_agent_id).toBe('nova');
    });
  });

  describe('Storage with Scope Information', () => {
    it('stores memories with scope metadata', async () => {
      const memoryInput: MemoryInput = {
        agent_id: '_global',
        type: 'preference',
        content: 'User prefers concise responses',
        tags: ['communication'],
        confidence: 0.9,
        scope: 'global',
        scope_confidence: 0.95,
        scope_reasoning: 'user preferences typically global',
      };

      const stored = store.create(memoryInput);

      expect(stored.scope).toBe('global');
      expect(stored.scope_confidence).toBe(0.95);
      expect(stored.scope_reasoning).toBe('user preferences typically global');
    });

    it('stores agent-specific memories with target agent', async () => {
      const memoryInput: MemoryInput = {
        agent_id: 'main', // Extracted by main agent
        type: 'rule',
        content: 'Always include source URLs in summaries',
        tags: ['ai', 'research'],
        confidence: 0.85,
        scope: 'agent',
        scope_confidence: 0.9,
        target_agent_id: 'nova',
        scope_reasoning: 'explicit mention of Nova',
      };

      const stored = store.create(memoryInput);

      expect(stored.scope).toBe('agent');
      expect(stored.target_agent_id).toBe('nova');
      expect(stored.scope_confidence).toBe(0.9);
    });
  });

  describe('Retrieval with Multi-Agent Scope', () => {
    beforeEach(async () => {
      // Create test memories with different scopes
      
      // Global memory (accessible to all agents)
      store.create({
        agent_id: '_global',
        type: 'preference',
        content: 'User prefers concise responses',
        tags: ['communication'],
        embedding: await embeddings.embed('User prefers concise responses'),
        scope: 'global',
        scope_confidence: 0.95,
      });

      // Agent-specific memory for Nova
      store.create({
        agent_id: 'main',
        type: 'rule', 
        content: 'Always include source URLs in AI research summaries',
        tags: ['ai', 'research'],
        embedding: await embeddings.embed('Always include source URLs in AI research summaries'),
        scope: 'agent',
        target_agent_id: 'nova',
        scope_confidence: 0.9,
      });

      // Agent-specific memory for Tex
      store.create({
        agent_id: 'main',
        type: 'rule',
        content: 'Use casual tone for blog posts',
        tags: ['writing', 'style'],
        embedding: await embeddings.embed('Use casual tone for blog posts'),
        scope: 'agent',
        target_agent_id: 'tex',
        scope_confidence: 0.88,
      });

      // Inferred scope memory
      store.create({
        agent_id: 'nova',
        type: 'decision',
        content: 'Use GPT-4 for complex analysis tasks',
        tags: ['ai', 'tools'],
        embedding: await embeddings.embed('Use GPT-4 for complex analysis tasks'),
        scope: 'inferred',
        scope_confidence: 0.7,
      });
    });

    it('retrieves global memories for all agents', async () => {
      const results = await retriever.retrieve('nova', 'communication preferences');

      expect(results.length).toBeGreaterThan(0);
      
      // Should find the global preference
      const globalMemory = results.find(r => r.content.includes('concise responses'));
      expect(globalMemory).toBeDefined();
      expect(globalMemory?.scope).toBe('global');
    });

    it('retrieves agent-specific memories for correct agent', async () => {
      const novaResults = await retriever.retrieve('nova', 'research summaries');
      
      // Nova should get the research rule targeted to it
      const novaRule = novaResults.find(r => r.content.includes('source URLs'));
      expect(novaRule).toBeDefined();
      expect(novaRule?.target_agent_id).toBe('nova');

      // But should not get Tex's writing rules
      const texRule = novaResults.find(r => r.content.includes('casual tone'));
      expect(texRule).toBeUndefined();
    });

    it('does not retrieve agent-specific memories for wrong agent', async () => {
      const texResults = await retriever.retrieve('tex', 'research summaries');

      // Tex should not get Nova's research rules
      const novaRule = texResults.find(r => r.content.includes('source URLs'));
      expect(novaRule).toBeUndefined();
    });

    it('includes inferred scope memories in results', async () => {
      const novaResults = await retriever.retrieve('nova', 'analysis tools');

      // Nova should see inferred scope memories from its own namespace
      const inferredMemory = novaResults.find(r => r.content.includes('GPT-4'));
      expect(inferredMemory).toBeDefined();
      expect(inferredMemory?.scope).toBe('inferred');
    });
  });

  describe('End-to-End Scope Workflow', () => {
    beforeEach(() => {
      const mockProvider = createMockProvider({
        memories: [
          {
            type: 'rule',
            content: 'Always include hashtags in social media posts',
            confidence: 0.9,
            tags: ['social', 'marketing'],
          },
        ],
      });

      extractor = new MemoryExtractor({}, mockProvider);
    });

    it('extracts, stores, and retrieves scoped memories correctly', async () => {
      const context: ScopeContext = {
        channel: 'linc-social',
        channelType: 'project',
        agentId: 'main',
      };

      // 1. Extract with scope detection
      const extracted = await extractor.extract(
        'Linc should always include hashtags in social media posts',
        context
      );

      expect(extracted.memories).toHaveLength(1);
      const memory = extracted.memories[0];
      expect(memory.scope).toBe('agent');
      expect(memory.target_agent_id).toBe('linc');

      // 2. Store the memory
      const stored = store.create({
        agent_id: 'main',
        type: memory.type,
        content: memory.content,
        tags: memory.tags,
        embedding: await embeddings.embed(memory.content),
        confidence: memory.confidence,
        scope: memory.scope,
        scope_confidence: memory.scope_confidence,
        target_agent_id: memory.target_agent_id,
        scope_reasoning: memory.scope_reasoning,
      });

      expect(stored.id).toBeDefined();

      // 3. Retrieve for the correct agent
      const lincResults = await retriever.retrieve('linc', 'social media posting');
      const foundMemory = lincResults.find(r => r.content.includes('hashtags'));
      expect(foundMemory).toBeDefined();

      // 4. Verify it's not retrieved for other agents
      const texResults = await retriever.retrieve('tex', 'social media posting');
      const notFoundMemory = texResults.find(r => r.content.includes('hashtags'));
      expect(notFoundMemory).toBeUndefined();
    });
  });
});