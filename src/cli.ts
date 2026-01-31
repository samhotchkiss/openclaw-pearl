#!/usr/bin/env node
/**
 * Pearl CLI Entry Point
 * Main CLI for running Pearl server and managing memories
 */

import { Command } from 'commander';
import { serveCommand } from './cli/serve.js';
import { memoryCommand } from './cli/memory.js';
import { statsCommand } from './cli/stats.js';

export const program = new Command();

program
  .name('pearl')
  .description('Pearl - Memory-enhanced model proxy')
  .version('0.1.0');

// Register commands
program.addCommand(serveCommand);
program.addCommand(memoryCommand);
program.addCommand(statsCommand);

// Only parse if this is the main module (not imported for testing)
// Check if running as CLI (not being imported)
const isMainModule = process.argv[1]?.endsWith('cli.js') || process.argv[1]?.endsWith('cli.ts');
if (isMainModule) {
  program.parse();
}
