/**
 * Memory Commands
 * CLI commands for managing agent memories
 */

import { Command } from 'commander';
import { resolve } from 'path';
import { loadConfig } from '../config/loader.js';
import { MemoryStore, type MemoryType } from '../memory/store.js';
import type { Config } from '../config/types.js';

export interface MemoryListOptions {
  agent: string;
  type?: string;
  limit?: string;
  config?: string;
}

export interface MemoryAddOptions {
  agent: string;
  type: string;
  content: string;
  tags?: string;
  config?: string;
}

export interface MemoryDeleteOptions {
  config?: string;
}

export const memoryCommand = new Command('memory')
  .description('Manage agent memories');

// List memories
memoryCommand
  .command('list')
  .description('List memories for an agent')
  .requiredOption('-a, --agent <agentId>', 'Agent ID')
  .option('-t, --type <type>', 'Filter by memory type')
  .option('-l, --limit <count>', 'Maximum number of memories', '20')
  .option('-c, --config <path>', 'Path to config file', 'pearl.yaml')
  .action(async (options: MemoryListOptions) => {
    try {
      await runMemoryList(options);
    } catch (error) {
      console.error('Failed to list memories:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Add memory
memoryCommand
  .command('add')
  .description('Add a memory for an agent')
  .requiredOption('-a, --agent <agentId>', 'Agent ID')
  .requiredOption('-t, --type <type>', 'Memory type (fact, preference, rule, decision, health, reminder, relationship)')
  .requiredOption('--content <text>', 'Memory content')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('-c, --config <path>', 'Path to config file', 'pearl.yaml')
  .action(async (options: MemoryAddOptions) => {
    try {
      await runMemoryAdd(options);
    } catch (error) {
      console.error('Failed to add memory:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Delete memory
memoryCommand
  .command('delete <id>')
  .description('Delete a memory by ID')
  .option('-c, --config <path>', 'Path to config file', 'pearl.yaml')
  .action(async (id: string, options: MemoryDeleteOptions) => {
    try {
      await runMemoryDelete(id, options);
    } catch (error) {
      console.error('Failed to delete memory:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

async function getStore(configPath: string): Promise<MemoryStore> {
  const fullPath = resolve(process.cwd(), configPath);
  const config = await loadConfig(fullPath);
  return new MemoryStore(config.memory.path);
}

export async function runMemoryList(options: MemoryListOptions): Promise<void> {
  const store = await getStore(options.config || 'pearl.yaml');
  
  try {
    const limit = parseInt(options.limit || '20', 10);
    
    const memories = store.query({
      agent_id: options.agent,
      type: options.type as MemoryType | undefined,
      limit,
      orderBy: 'created_at',
      order: 'desc',
    });

    if (memories.length === 0) {
      console.log(`No memories found for agent: ${options.agent}`);
      return;
    }

    console.log(`\nMemories for agent: ${options.agent}`);
    console.log('─'.repeat(60));
    
    for (const memory of memories) {
      console.log(`\nID: ${memory.id}`);
      console.log(`Type: ${memory.type}`);
      console.log(`Content: ${memory.content}`);
      if (memory.tags && memory.tags.length > 0) {
        console.log(`Tags: ${memory.tags.join(', ')}`);
      }
      console.log(`Created: ${new Date(memory.created_at).toISOString()}`);
      console.log('─'.repeat(60));
    }
    
    console.log(`\nTotal: ${memories.length} memories`);
  } finally {
    store.close();
  }
}

export async function runMemoryAdd(options: MemoryAddOptions): Promise<void> {
  const validTypes: MemoryType[] = ['fact', 'preference', 'rule', 'decision', 'health', 'reminder', 'relationship'];
  
  if (!validTypes.includes(options.type as MemoryType)) {
    throw new Error(`Invalid memory type: ${options.type}. Valid types: ${validTypes.join(', ')}`);
  }

  const store = await getStore(options.config || 'pearl.yaml');
  
  try {
    const tags = options.tags ? options.tags.split(',').map(t => t.trim()) : undefined;
    
    const memory = store.create({
      agent_id: options.agent,
      type: options.type as MemoryType,
      content: options.content,
      tags,
    });

    console.log(`Memory created successfully!`);
    console.log(`ID: ${memory.id}`);
    console.log(`Type: ${memory.type}`);
    console.log(`Content: ${memory.content}`);
    if (memory.tags && memory.tags.length > 0) {
      console.log(`Tags: ${memory.tags.join(', ')}`);
    }
  } finally {
    store.close();
  }
}

export async function runMemoryDelete(id: string, options: MemoryDeleteOptions): Promise<void> {
  const store = await getStore(options.config || 'pearl.yaml');
  
  try {
    const deleted = store.delete(id);
    
    if (deleted) {
      console.log(`Memory ${id} deleted successfully`);
    } else {
      console.log(`Memory ${id} not found`);
    }
  } finally {
    store.close();
  }
}
