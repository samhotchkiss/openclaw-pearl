/**
 * Serve Command
 * Starts the Pearl HTTP server with full orchestrator
 */

import { Command } from 'commander';
import { resolve } from 'path';
import { loadConfig, normalizeConfig } from '../config/index.js';
import { createServer } from '../server/index.js';
import { Pearl } from '../pearl.js';
import type { Config } from '../config/types.js';

export interface ServeOptions {
  config?: string;
  port?: string;
  host?: string;
}

export const serveCommand = new Command('serve')
  .description('Start the Pearl server')
  .option('-c, --config <path>', 'Path to config file', 'pearl.yaml')
  .option('-p, --port <port>', 'Server port (overrides config)')
  .option('-H, --host <host>', 'Server host (overrides config)')
  .action(async (options: ServeOptions) => {
    try {
      await runServe(options);
    } catch (error) {
      console.error('Failed to start server:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

export async function runServe(options: ServeOptions): Promise<void> {
  // Load config
  const configPath = resolve(process.cwd(), options.config || 'pearl.yaml');
  console.log(`Loading config from: ${configPath}`);
  
  let config: Config;
  try {
    config = await loadConfig(configPath);
  } catch (error) {
    // If config file doesn't exist, use defaults
    console.log('Config file not found, using defaults');
    config = await loadConfig(); // Load defaults
  }

  // Apply CLI overrides
  if (options.port) {
    config.server.port = parseInt(options.port, 10);
  }
  if (options.host) {
    config.server.host = options.host;
  }

  console.log('Initializing Pearl orchestrator...');
  
  // Normalize config from snake_case to camelCase
  const normalizedConfig = normalizeConfig(config);
  
  // Create Pearl instance with normalized config
  const pearl = new Pearl(normalizedConfig);
  await pearl.initialize();
  console.log('Pearl orchestrator initialized');
  
  console.log('Starting Pearl server...');
  
  // Create and start server with Pearl instance
  const server = await createServer({
    serverConfig: config.server,
    pearl,
  });
  
  const address = await server.listen({
    port: config.server.port,
    host: config.server.host,
  });

  console.log(`Pearl server listening on ${address}`);
  console.log('Press Ctrl+C to stop');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    
    try {
      await server.close();
      await pearl.shutdown();
      console.log('Shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
