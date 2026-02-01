/**
 * Integration tests for EmbeddingService with actual Ollama API
 * These tests require a running Ollama instance with nomic-embed-text model
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { EmbeddingService, cosineSimilarity } from '../../src/memory/embeddings.js';

describe('EmbeddingService Integration', () => {
  let embeddingService: EmbeddingService;
  
  beforeAll(async () => {
    embeddingService = new EmbeddingService({
      provider: 'ollama',
      model: 'nomic-embed-text',
      baseUrl: 'http://localhost:11434',
    });
  });

  describe('Ollama Integration', () => {
    it('should connect to Ollama and verify nomic-embed-text model works', async () => {
      const testText = 'I love pizza';
      
      // This should not throw if Ollama is running and model is available
      const embedding = await embeddingService.embed(testText);
      
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(768); // nomic-embed-text dimensions
      expect(Array.from(embedding).every(v => typeof v === 'number')).toBe(true);
    });

    it('should generate different embeddings for different texts', async () => {
      const text1 = 'I love pizza';
      const text2 = 'The weather is sunny today';
      
      const embedding1 = await embeddingService.embed(text1);
      const embedding2 = await embeddingService.embed(text2);
      
      expect(embedding1).toBeInstanceOf(Float32Array);
      expect(embedding2).toBeInstanceOf(Float32Array);
      expect(embedding1.length).toBe(768);
      expect(embedding2.length).toBe(768);
      
      // Embeddings should be different for different texts
      const similarity = cosineSimilarity(embedding1, embedding2);
      expect(similarity).toBeLessThan(0.9); // Should not be too similar
    });

    it('should generate semantically similar embeddings for related texts', async () => {
      const text1 = 'I love pizza';
      const text2 = 'I enjoy Italian food';
      
      const embedding1 = await embeddingService.embed(text1);
      const embedding2 = await embeddingService.embed(text2);
      
      // These should be semantically similar
      const similarity = cosineSimilarity(embedding1, embedding2);
      expect(similarity).toBeGreaterThan(0.3); // Should have some semantic similarity
    });

    it('should handle batch embedding generation', async () => {
      const texts = [
        'I love pizza',
        'I enjoy Italian food', 
        'The weather is nice today',
        'It is raining outside'
      ];
      
      const embeddings = await embeddingService.embedBatch(texts);
      
      expect(embeddings).toHaveLength(4);
      embeddings.forEach(embedding => {
        expect(embedding).toBeInstanceOf(Float32Array);
        expect(embedding.length).toBe(768);
      });
      
      // Test that related texts have higher similarity
      const pizzaSimilarity = cosineSimilarity(embeddings[0], embeddings[1]); // pizza & Italian food
      const weatherSimilarity = cosineSimilarity(embeddings[2], embeddings[3]); // weather texts
      const unrelatedSimilarity = cosineSimilarity(embeddings[0], embeddings[2]); // pizza & weather
      
      expect(pizzaSimilarity).toBeGreaterThan(unrelatedSimilarity);
      expect(weatherSimilarity).toBeGreaterThan(unrelatedSimilarity);
    });

    it('should handle API errors gracefully', async () => {
      const badService = new EmbeddingService({
        provider: 'ollama',
        model: 'nonexistent-model',
        baseUrl: 'http://localhost:11434',
      });
      
      await expect(badService.embed('test')).rejects.toThrow();
    });

    it('should handle network errors gracefully', async () => {
      const badService = new EmbeddingService({
        provider: 'ollama',
        model: 'nomic-embed-text',
        baseUrl: 'http://localhost:99999', // Invalid port
      });
      
      await expect(badService.embed('test')).rejects.toThrow();
    });
  });

  describe('Performance', () => {
    it('should generate embeddings in reasonable time', async () => {
      const text = 'This is a test of embedding generation performance';
      
      const startTime = Date.now();
      await embeddingService.embed(text);
      const duration = Date.now() - startTime;
      
      // Should complete within 5 seconds for local Ollama
      expect(duration).toBeLessThan(5000);
    });

    it('should handle batch processing efficiently', async () => {
      const texts = Array(10).fill(0).map((_, i) => `Test text number ${i}`);
      
      const startTime = Date.now();
      await embeddingService.embedBatch(texts);
      const duration = Date.now() - startTime;
      
      // Should complete batch within 15 seconds
      expect(duration).toBeLessThan(15000);
    });
  });
});