"use strict";
/**
 * Test Helpers for Pearl Test Suite
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockBackend = void 0;
exports.createTestConfig = createTestConfig;
exports.mockExternalServices = mockExternalServices;
exports.getTestDbPath = getTestDbPath;
exports.cleanupTests = cleanupTests;
const vitest_1 = require("vitest");
/**
 * Mock backend implementation for testing
 */
class MockBackend {
    async *chat(request) {
        const messageId = 'test-' + Date.now();
        const timestamp = Math.floor(Date.now() / 1000);
        // First chunk with role
        yield {
            id: messageId,
            object: 'chat.completion.chunk',
            created: timestamp,
            model: request.model,
            choices: [{
                    index: 0,
                    delta: { role: 'assistant' },
                    finishReason: null,
                }],
        };
        // Content chunk
        yield {
            id: messageId,
            object: 'chat.completion.chunk',
            created: timestamp,
            model: request.model,
            choices: [{
                    index: 0,
                    delta: { content: 'This is a mock response for testing' },
                    finishReason: null,
                }],
        };
        // Final chunk
        yield {
            id: messageId,
            object: 'chat.completion.chunk',
            created: timestamp,
            model: request.model,
            choices: [{
                    index: 0,
                    delta: {},
                    finishReason: 'stop',
                }],
            usage: {
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15,
            },
        };
    }
    async models() {
        return [
            {
                id: 'mock/test-model',
                object: 'model',
                created: Date.now(),
                ownedBy: 'mock',
            },
            {
                id: 'pearl',
                object: 'model',
                created: Date.now(),
                ownedBy: 'pearl',
            },
        ];
    }
    async health() {
        return true;
    }
}
exports.MockBackend = MockBackend;
/**
 * Create a minimal test config for Pearl instances
 */
function createTestConfig() {
    return {
        server: { port: 8080, host: '0.0.0.0', cors: true },
        memory: { store: 'sqlite', path: ':memory:' },
        extraction: {
            enabled: true,
            model: 'ollama/llama3.2:1b',
            async: false, // Sync for testing
            minConfidence: 0.7,
            extractFromAssistant: false,
            dedupWindowSeconds: 300,
        },
        embedding: {
            provider: 'ollama',
            model: 'nomic-embed-text',
            dimensions: 768,
        },
        retrieval: {
            maxMemories: 10,
            minSimilarity: 0.5,
            tokenBudget: 500,
            recencyBoost: true,
        },
        routing: {
            classifier: 'ollama/llama3.2:1b',
            defaultModel: 'mock/test-model',
            rules: [{
                    name: 'default',
                    match: { default: true },
                    model: 'mock/test-model',
                    priority: 1,
                }],
        },
        backends: {
            anthropic: { apiKey: 'mock-key' },
            openai: { apiKey: 'mock-key' },
            ollama: { baseUrl: 'http://localhost:11434' },
            mock: { enabled: true }, // Enable mock backend for testing
        },
        logging: { level: 'error', file: '/dev/null' },
    };
}
/**
 * Mock external services for testing
 */
function mockExternalServices() {
    // Mock Anthropic client
    vitest_1.vi.mock('../../src/backends/anthropic.js', () => ({
        AnthropicClient: vitest_1.vi.fn(() => ({
            chat: vitest_1.vi.fn(async function* () {
                yield {
                    id: 'test-response',
                    object: 'chat.completion.chunk',
                    created: Date.now(),
                    model: 'claude-3-sonnet',
                    choices: [{
                            index: 0,
                            delta: { role: 'assistant', content: 'Mock response' },
                            finishReason: 'stop',
                        }],
                };
            }),
            models: vitest_1.vi.fn(() => Promise.resolve([
                { id: 'claude-3-sonnet', object: 'model', created: Date.now(), ownedBy: 'anthropic' }
            ])),
            health: vitest_1.vi.fn(() => Promise.resolve(true)),
        }))
    }));
    // Mock Ollama client for tests
    vitest_1.vi.mock('../../src/backends/ollama.js', () => ({
        OllamaClient: vitest_1.vi.fn(() => ({
            chat: vitest_1.vi.fn(async function* () {
                yield {
                    id: 'test-response',
                    object: 'chat.completion.chunk',
                    created: Date.now(),
                    model: 'llama3.2:1b',
                    choices: [{
                            index: 0,
                            delta: { role: 'assistant', content: 'Mock extraction result' },
                            finishReason: 'stop',
                        }],
                };
            }),
            models: vitest_1.vi.fn(() => Promise.resolve([
                { id: 'llama3.2:1b', object: 'model', created: Date.now(), ownedBy: 'ollama' }
            ])),
            health: vitest_1.vi.fn(() => Promise.resolve(true)),
        }))
    }));
}
/**
 * Create a test memory database
 */
function getTestDbPath() {
    return ':memory:'; // Use in-memory SQLite for tests
}
/**
 * Clean up test environment
 */
function cleanupTests() {
    vitest_1.vi.clearAllMocks();
    vitest_1.vi.resetAllMocks();
}
//# sourceMappingURL=test-helpers.js.map