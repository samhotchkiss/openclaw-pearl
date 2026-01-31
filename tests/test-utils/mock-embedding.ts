/**
 * Mock embedding service for testing
 */

import type { EmbeddingService } from '../../src/memory/embeddings.js';

export class MockEmbeddingService implements EmbeddingService {
  private cache = new Map<string, number[]>();

  constructor(private dimensions: number = 768) {}

  async embed(text: string): Promise<number[]> {
    // Use cache to ensure consistent results
    if (this.cache.has(text)) {
      return this.cache.get(text)!;
    }

    // Generate deterministic embeddings based on text content
    const embedding: number[] = [];
    let hash = 0;
    
    // Simple hash function
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) & 0xfffffff;
    }

    // Generate deterministic float values
    for (let i = 0; i < this.dimensions; i++) {
      const seed = hash + i;
      const value = (Math.sin(seed / 1000) + 1) / 2; // Normalize to 0-1
      embedding.push(value);
    }

    // Normalize the vector
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    const normalized = embedding.map(val => val / magnitude);

    this.cache.set(text, normalized);
    return normalized;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(text => this.embed(text)));
  }

  getDimensions(): number {
    return this.dimensions;
  }
}