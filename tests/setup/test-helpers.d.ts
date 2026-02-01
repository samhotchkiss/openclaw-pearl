/**
 * Test Helpers for Pearl Test Suite
 */
import type { PearlConfig } from '../../src/types.js';
import type { BackendClient, ChatRequest, ChatChunk, Model } from '../../src/backends/types.js';
/**
 * Mock backend implementation for testing
 */
export declare class MockBackend implements BackendClient {
    chat(request: ChatRequest): AsyncGenerator<ChatChunk>;
    models(): Promise<Model[]>;
    health(): Promise<boolean>;
}
/**
 * Create a minimal test config for Pearl instances
 */
export declare function createTestConfig(): PearlConfig;
/**
 * Mock external services for testing
 */
export declare function mockExternalServices(): void;
/**
 * Create a test memory database
 */
export declare function getTestDbPath(): string;
/**
 * Clean up test environment
 */
export declare function cleanupTests(): void;
//# sourceMappingURL=test-helpers.d.ts.map