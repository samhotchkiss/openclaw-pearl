/**
 * Pearl HTTP Server
 * OpenAI-compatible API server with real Pearl orchestrator
 */

import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { uuidv7 } from 'uuidv7';
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { Pearl } from '../pearl.js';
import type { ServerConfig, PearlConfig, ChatRequest } from '../types.js';

// Structured request log for the watch CLI
const REQUEST_LOG_PATH = join(homedir(), '.pearl', 'requests.jsonl');

function ensureLogDir() {
  const dir = dirname(REQUEST_LOG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

interface RequestLogEntry {
  ts: string;
  id: string;
  agentId: string;
  sessionId: string;
  requestedModel: string;
  routedModel: string;
  classification?: { complexity: string; type: string; sensitive: boolean; estimatedTokens: number };
  prompt: string;       // first 200 chars of last user message
  responsePreview: string; // first 200 chars of response
  tokens: { input: number; output: number; total: number };
  durationMs: number;
  stream: boolean;
  rule?: string;
}

function logRequest(entry: RequestLogEntry) {
  try {
    ensureLogDir();
    appendFileSync(REQUEST_LOG_PATH, JSON.stringify(entry) + '\n');
  } catch (e) {
    // Don't crash the server over logging
  }
}

// OpenAI-compatible types
// Content can be a string or array of content blocks (OpenAI multi-modal format)
type ContentBlock = { type: 'text'; text: string } | { type: string; [key: string]: unknown };
type MessageContent = string | ContentBlock[];

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: MessageContent;
}

/**
 * Normalize message content to a plain string.
 * OpenClaw sends content as either:
 * - A plain string: "hello"
 * - An array of content blocks: [{"type":"text","text":"hello"}]
 */
function normalizeContent(content: MessageContent): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: 'text'; text: string } =>
        block.type === 'text' && typeof (block as any).text === 'string')
      .map(block => block.text)
      .join('\n');
  }
  return String(content ?? '');
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  metadata?: {
    agent_id?: string;
    session_id?: string;
  };
}

interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: 'stop' | 'length' | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface ErrorResponse {
  error: {
    type: string;
    message: string;
    code?: string;
  };
}

interface ModelInfo {
  id: string;
  object: 'model';
  owned_by: string;
}

// Logger interface for structured logging
interface Logger {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
  debug: (message: string, data?: Record<string, unknown>) => void;
}

function createLogger(): Logger {
  const log = (level: string, message: string, data?: Record<string, unknown>) => {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...data,
    };
    console.log(JSON.stringify(entry));
  };

  return {
    info: (message, data) => log('info', message, data),
    warn: (message, data) => log('warn', message, data),
    error: (message, data) => log('error', message, data),
    debug: (message, data) => log('debug', message, data),
  };
}

// Validation helpers
function validateChatRequest(body: unknown): { valid: true; request: ChatCompletionRequest } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const req = body as Record<string, unknown>;

  if (!req.model || typeof req.model !== 'string') {
    return { valid: false, error: 'model is required and must be a string' };
  }

  if (!req.messages || !Array.isArray(req.messages)) {
    return { valid: false, error: 'messages is required and must be an array' };
  }

  if (req.messages.length === 0) {
    return { valid: false, error: 'messages array cannot be empty' };
  }

  for (let i = 0; i < req.messages.length; i++) {
    const msg = req.messages[i] as Record<string, unknown>;
    if (!msg.role || typeof msg.role !== 'string') {
      return { valid: false, error: `messages[${i}].role is required and must be a string` };
    }
    if (!['system', 'user', 'assistant'].includes(msg.role as string)) {
      return { valid: false, error: `messages[${i}].role must be 'system', 'user', or 'assistant'` };
    }
    if (typeof msg.content !== 'string' && !Array.isArray(msg.content)) {
      return { valid: false, error: `messages[${i}].content must be a string or array of content blocks` };
    }
  }

  return { valid: true, request: body as ChatCompletionRequest };
}

// Simple token estimation (4 chars ≈ 1 token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface CreateServerOptions {
  serverConfig?: Partial<ServerConfig>;
  pearlConfig?: PearlConfig;
  pearl?: Pearl;
}

export async function createServer(options: CreateServerOptions = {}): Promise<FastifyInstance> {
  const logger = createLogger();
  const port = options.serverConfig?.port ?? 8787;
  const host = options.serverConfig?.host ?? '0.0.0.0';

  // Use provided Pearl instance or create new one
  let pearl = options.pearl;
  
  if (!pearl && options.pearlConfig) {
    pearl = new Pearl(options.pearlConfig);
    await pearl.initialize();
    logger.info('Pearl orchestrator initialized');
  }

  const server = Fastify({
    logger: false, // We use our own logger
  });

  // Health check
  server.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    logger.debug('Health check requested');
    return reply.send({
      status: 'healthy',
      version: '0.1.0',
      uptime_seconds: Math.floor(process.uptime()),
      pearl_initialized: pearl?.isInitialized() ?? false,
    });
  });

  // Also support /v1/health for compatibility
  server.get('/v1/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      status: 'healthy',
      version: '0.1.0',
      uptime_seconds: Math.floor(process.uptime()),
      pearl_initialized: pearl?.isInitialized() ?? false,
    });
  });

  // List models
  server.get('/v1/models', async (_request: FastifyRequest, reply: FastifyReply) => {
    logger.debug('Models list requested');
    const models: ModelInfo[] = [
      { id: 'auto', object: 'model', owned_by: 'pearl' },
      { id: 'anthropic-max/claude-opus-4-20250514', object: 'model', owned_by: 'anthropic' },
      { id: 'anthropic-max/claude-sonnet-4-20250514', object: 'model', owned_by: 'anthropic' },
      { id: 'anthropic-max/claude-haiku-4-20250514', object: 'model', owned_by: 'anthropic' },
    ];
    return reply.send({
      object: 'list',
      data: models,
    });
  });

  // Chat completions (main endpoint)
  server.post('/v1/chat/completions', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    
    // Get agent ID from header or body
    const headerAgentId = request.headers['x-pearl-agent-id'] as string | undefined;
    const headerSessionId = request.headers['x-pearl-session-id'] as string | undefined;
    
    // Validate request
    const validation = validateChatRequest(request.body);
    if (!validation.valid) {
      logger.warn('Invalid chat completion request', { error: validation.error });
      return reply.status(400).send({
        error: {
          type: 'invalid_request_error',
          message: validation.error,
          code: 'invalid_request',
        },
      } satisfies ErrorResponse);
    }

    const { request: chatRequest } = validation;
    const agentId = chatRequest.metadata?.agent_id ?? headerAgentId ?? 'anonymous';
    const sessionId = chatRequest.metadata?.session_id ?? headerSessionId ?? uuidv7();

    logger.info('Chat completion request', {
      agent_id: agentId,
      session_id: sessionId,
      model: chatRequest.model,
      message_count: chatRequest.messages.length,
      stream: chatRequest.stream ?? false,
    });

    // If Pearl is not initialized, run in passthrough mode
    if (!pearl || !pearl.isInitialized()) {
      logger.warn('Pearl not initialized, running in passthrough mode');
      return reply.status(503).send({
        error: {
          type: 'service_unavailable',
          message: 'Pearl orchestrator not initialized',
          code: 'pearl_not_ready',
        },
      } satisfies ErrorResponse);
    }

    try {
      // Build Pearl ChatRequest — normalize content to strings
      const pearlRequest: ChatRequest = {
        model: chatRequest.model,
        messages: chatRequest.messages.map(m => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: normalizeContent(m.content),
        })),
        stream: chatRequest.stream ?? false,
        temperature: chatRequest.temperature,
        maxTokens: chatRequest.max_tokens,
        metadata: {
          agentId,
          sessionId,
        },
      };

      // Handle streaming vs non-streaming
      if (chatRequest.stream) {
        // Streaming response
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        const responseId = `chatcmpl-${uuidv7()}`;
        const created = Math.floor(Date.now() / 1000);
        let streamContent = '';
        let streamModel = chatRequest.model;
        let streamUsage: any = null;

        for await (const chunk of pearl.chatCompletion(pearlRequest)) {
          if (chunk.choices?.[0]?.delta?.content) {
            streamContent += chunk.choices[0].delta.content;
          }
          if (chunk.model) {
            streamModel = chunk.model;
          }
          if (chunk.usage) {
            streamUsage = chunk.usage;
          }

          const sseChunk = {
            id: responseId,
            object: 'chat.completion.chunk',
            created,
            model: chunk.model ?? chatRequest.model,
            choices: chunk.choices?.map((c, i) => ({
              index: i,
              delta: {
                role: c.delta?.role,
                content: c.delta?.content,
              },
              finish_reason: c.finishReason,
            })) ?? [],
          };
          
          reply.raw.write(`data: ${JSON.stringify(sseChunk)}\n\n`);
        }

        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();

        const duration = Date.now() - startTime;
        logger.info('Streaming chat completion finished', {
          agent_id: agentId,
          duration_ms: duration,
        });

        // Log to structured request log for watch CLI
        const lastUserMsgStream = [...chatRequest.messages].reverse().find(m => m.role === 'user');
        logRequest({
          ts: new Date().toISOString(),
          id: responseId,
          agentId,
          sessionId,
          requestedModel: chatRequest.model,
          routedModel: streamModel,
          prompt: normalizeContent(lastUserMsgStream?.content ?? '').slice(0, 200),
          responsePreview: streamContent.slice(0, 200),
          tokens: {
            input: streamUsage?.promptTokens ?? 0,
            output: streamUsage?.completionTokens ?? 0,
            total: streamUsage?.totalTokens ?? 0,
          },
          durationMs: duration,
          stream: true,
        });

        return;
      } else {
        // Non-streaming response - collect all chunks
        let fullContent = '';
        let model = chatRequest.model;
        let finishReason: 'stop' | 'length' | null = null;
        let chunkUsage: any = null;

        for await (const chunk of pearl.chatCompletion(pearlRequest)) {
          if (chunk.choices?.[0]?.delta?.content) {
            fullContent += chunk.choices[0].delta.content;
          }
          if (chunk.model) {
            model = chunk.model;
          }
          if (chunk.choices?.[0]?.finishReason) {
            finishReason = chunk.choices[0].finishReason as 'stop' | 'length';
          }
          if (chunk.usage) {
            chunkUsage = chunk.usage;
          }
        }

        const promptTokens = chunkUsage?.promptTokens ?? chatRequest.messages.reduce((sum, m) => sum + estimateTokens(normalizeContent(m.content)), 0);
        const completionTokens = chunkUsage?.completionTokens ?? estimateTokens(fullContent);

        const response: ChatCompletionResponse = {
          id: `chatcmpl-${uuidv7()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: fullContent,
              },
              finish_reason: finishReason ?? 'stop',
            },
          ],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
          },
        };

        const duration = Date.now() - startTime;
        logger.info('Chat completion response', {
          agent_id: agentId,
          duration_ms: duration,
          tokens: response.usage,
        });

        // Log to structured request log for watch CLI
        const lastUserMsg = [...chatRequest.messages].reverse().find(m => m.role === 'user');
        logRequest({
          ts: new Date().toISOString(),
          id: response.id,
          agentId,
          sessionId,
          requestedModel: chatRequest.model,
          routedModel: model,
          prompt: normalizeContent(lastUserMsg?.content ?? '').slice(0, 200),
          responsePreview: fullContent.slice(0, 200),
          tokens: { input: promptTokens, output: completionTokens, total: promptTokens + completionTokens },
          durationMs: duration,
          stream: false,
        });

        return reply.send(response);
      }
    } catch (error) {
      logger.error('Chat completion error', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        agent_id: agentId,
      });
      
      return reply.status(500).send({
        error: {
          type: 'internal_error',
          message: error instanceof Error ? error.message : 'An error occurred during chat completion',
        },
      } satisfies ErrorResponse);
    }
  });

  // 404 handler
  server.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    logger.warn('Route not found', { method: request.method, url: request.url });
    return reply.status(404).send({
      error: {
        type: 'not_found_error',
        message: `Route ${request.method} ${request.url} not found`,
      },
    } satisfies ErrorResponse);
  });

  // Global error handler
  server.setErrorHandler(async (error: Error, request: FastifyRequest, reply: FastifyReply) => {
    logger.error('Unhandled error', {
      error: error.message,
      stack: error.stack,
      url: request.url,
    });
    return reply.status(500).send({
      error: {
        type: 'internal_error',
        message: 'An internal error occurred',
      },
    } satisfies ErrorResponse);
  });

  logger.info('Pearl server created', { port, host });

  return server;
}

// Start server if run directly
async function main() {
  const server = await createServer();
  try {
    const address = await server.listen({ port: 8787, host: '0.0.0.0' });
    console.log(`Pearl server listening at ${address}`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Export for CLI
export { main as startServer };
