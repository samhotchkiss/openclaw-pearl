/**
 * Stats Command
 * Display Pearl usage statistics
 */

import { Command } from 'commander';
import { resolve } from 'path';
import { loadConfig } from '../config/loader.js';
import { MemoryStore } from '../memory/store.js';
import type { Config } from '../config/types.js';

export interface StatsOptions {
  config?: string;
}

export const statsCommand = new Command('stats')
  .description('Display Pearl usage statistics')
  .option('-c, --config <path>', 'Path to config file', 'pearl.yaml')
  .action(async (options: StatsOptions) => {
    try {
      await runStats(options);
    } catch (error) {
      console.error('Failed to get stats:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

export async function runStats(options: StatsOptions): Promise<void> {
  const configPath = resolve(process.cwd(), options.config || 'pearl.yaml');
  const config = await loadConfig(configPath);
  
  const store = new MemoryStore(config.memory.path);
  
  try {
    const stats = store.getStats();
    
    console.log('\nPearl Statistics');
    console.log('═'.repeat(40));
    console.log(`Total Memories: ${stats.totalMemories}`);
    console.log(`Total Agents: ${Object.keys(stats.byAgent).length}`);
    
    if (stats.byType && Object.keys(stats.byType).length > 0) {
      console.log('\nMemories by Type:');
      for (const [type, count] of Object.entries(stats.byType)) {
        console.log(`  ${type}: ${count}`);
      }
    }
    
    if (stats.byAgent && Object.keys(stats.byAgent).length > 0) {
      console.log('\nMemories by Agent:');
      for (const [agent, count] of Object.entries(stats.byAgent)) {
        console.log(`  ${agent}: ${count}`);
      }
    }
    
    console.log('═'.repeat(40));
  } finally {
    store.close();
  }
}
