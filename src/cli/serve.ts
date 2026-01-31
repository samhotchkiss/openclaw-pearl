/**
 * Serve Command
 * Starts the Pearl HTTP server
 */

import { Command } from 'commander';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { loadConfig } from '../config/loader.js';
import { createServer } from '../server/index.js';
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
  
  const config = await loadConfig(configPath);

  // Apply CLI overrides
  if (options.port) {
    config.server.port = parseInt(options.port, 10);
  }
  if (options.host) {
    config.server.host = options.host;
  }

  console.log('Starting Pearl server...');
  
  // Create and start server
  const server = await createServer(config.server);
  
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
