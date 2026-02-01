/**
 * Pearl Watch - Live request monitor
 * Tails ~/.pearl/requests.jsonl and displays formatted output
 */

import { Command } from 'commander';
import { createReadStream, existsSync, statSync, watchFile, unwatchFile } from 'fs';
import { createInterface } from 'readline';
import { join } from 'path';
import { homedir } from 'os';

const LOG_PATH = join(homedir(), '.pearl', 'requests.jsonl');

// ANSI colors
const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
};

interface RequestEntry {
  ts: string;
  id: string;
  agentId: string;
  sessionId: string;
  requestedModel: string;
  routedModel: string;
  classification?: { complexity: string; type: string; sensitive: boolean; estimatedTokens: number };
  prompt: string;
  responsePreview: string;
  tokens: { input: number; output: number; total: number };
  durationMs: number;
  stream: boolean;
  rule?: string;
}

function modelColor(model: string): string {
  if (model.includes('haiku')) return c.green;
  if (model.includes('sonnet')) return c.yellow;
  if (model.includes('opus')) return c.red;
  return c.white;
}

function modelBadge(model: string): string {
  const color = modelColor(model);
  // Extract just the model family name
  if (model.includes('haiku')) return `${color}${c.bold} HAIKU ${c.reset}`;
  if (model.includes('sonnet')) return `${color}${c.bold} SONNET ${c.reset}`;
  if (model.includes('opus')) return `${color}${c.bold} OPUS ${c.reset}`;
  return `${c.white}${c.bold} ${model} ${c.reset}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(tokens: { input: number; output: number; total: number }): string {
  if (tokens.total === 0) return `${c.dim}no usage data${c.reset}`;
  return `${c.dim}in:${c.reset}${tokens.input} ${c.dim}out:${c.reset}${tokens.output} ${c.dim}total:${c.reset}${tokens.total}`;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function truncate(s: string, maxLen: number): string {
  if (!s) return '';
  const clean = s.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 1) + '…';
}

function formatEntry(entry: RequestEntry): string {
  const lines: string[] = [];
  const sep = `${c.dim}${'─'.repeat(70)}${c.reset}`;
  
  lines.push(sep);
  
  // Line 1: Time, model badge, duration, agent
  const time = `${c.dim}${formatTime(entry.ts)}${c.reset}`;
  const badge = modelBadge(entry.routedModel);
  const dur = `${c.cyan}${formatDuration(entry.durationMs)}${c.reset}`;
  const agent = entry.agentId !== 'anonymous' ? ` ${c.dim}agent:${c.reset}${c.magenta}${entry.agentId}${c.reset}` : '';
  const streamIcon = entry.stream ? `${c.dim}⚡${c.reset}` : `${c.dim}●${c.reset}`;
  
  lines.push(`${time} ${badge} ${dur} ${streamIcon}${agent}`);
  
  // Line 2: Tokens
  lines.push(`  ${c.dim}tokens${c.reset} ${formatTokens(entry.tokens)}`);
  
  // Line 3: Prompt
  const promptText = truncate(entry.prompt, 120);
  lines.push(`  ${c.dim}prompt${c.reset} ${c.white}${promptText}${c.reset}`);
  
  // Line 4: Response preview
  if (entry.responsePreview) {
    const respText = truncate(entry.responsePreview, 120);
    lines.push(`  ${c.dim}reply${c.reset}  ${c.dim}${respText}${c.reset}`);
  }
  
  // Classification if available
  if (entry.classification) {
    const cls = entry.classification;
    lines.push(`  ${c.dim}class${c.reset}  complexity=${cls.complexity} type=${cls.type} tokens≈${cls.estimatedTokens}`);
  }
  
  return lines.join('\n');
}

function printHeader() {
  console.log(`\n${c.bold}${c.cyan}  ╔═══════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.cyan}  ║   🐚  Pearl Request Monitor       ║${c.reset}`);
  console.log(`${c.bold}${c.cyan}  ╚═══════════════════════════════════╝${c.reset}`);
  console.log(`  ${c.dim}Watching: ${LOG_PATH}${c.reset}`);
  console.log(`  ${c.dim}Models: ${c.green}■ Haiku${c.dim}  ${c.yellow}■ Sonnet${c.dim}  ${c.red}■ Opus${c.dim}  ⚡=stream ●=sync${c.reset}\n`);
}

async function tailLog(follow: boolean, last: number) {
  if (!existsSync(LOG_PATH)) {
    console.log(`${c.dim}No log file yet. Waiting for first request...${c.reset}\n`);
    
    if (follow) {
      // Wait for file to appear
      const checkInterval = setInterval(() => {
        if (existsSync(LOG_PATH)) {
          clearInterval(checkInterval);
          startTailing(0);
        }
      }, 1000);
      return;
    }
    return;
  }

  if (follow) {
    // Show last N entries then tail
    const lines = await readLastLines(last);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as RequestEntry;
        console.log(formatEntry(entry));
      } catch {}
    }
    
    startTailing(statSync(LOG_PATH).size);
  } else {
    // Show last N entries and exit
    const lines = await readLastLines(last);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as RequestEntry;
        console.log(formatEntry(entry));
      } catch {}
    }
  }
}

async function readLastLines(n: number): Promise<string[]> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    const rl = createInterface({ input: createReadStream(LOG_PATH, 'utf-8') });
    rl.on('line', (line) => {
      lines.push(line);
      if (lines.length > n) lines.shift();
    });
    rl.on('close', () => resolve(lines));
    rl.on('error', () => resolve([]));
  });
}

function startTailing(fromByte: number) {
  let lastSize = fromByte;
  
  const check = () => {
    try {
      const currentSize = statSync(LOG_PATH).size;
      if (currentSize > lastSize) {
        const stream = createReadStream(LOG_PATH, { start: lastSize, encoding: 'utf-8' });
        let buffer = '';
        stream.on('data', (chunk: string) => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer
          for (const line of lines) {
            if (line.trim()) {
              try {
                const entry = JSON.parse(line) as RequestEntry;
                console.log(formatEntry(entry));
              } catch {}
            }
          }
        });
        stream.on('end', () => {
          lastSize = currentSize;
        });
      }
    } catch {}
  };

  // Poll every 500ms
  setInterval(check, 500);
}

export const watchCommand = new Command('watch')
  .description('Watch Pearl requests in real-time')
  .option('-n, --last <count>', 'Show last N entries', '10')
  .option('-f, --follow', 'Follow mode (tail -f)', true)
  .option('--no-follow', 'Show entries and exit')
  .action(async (options: { last: string; follow: boolean }) => {
    printHeader();
    await tailLog(options.follow, parseInt(options.last, 10));
  });
