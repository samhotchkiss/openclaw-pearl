/**
 * Pearl Sunrise Summarizer
 */

import type { TranscriptMessage } from './transcript.js';

export interface SessionSummary {
  timestamp: string;
  recentContext: string;
  progress: string;
  decisions: string[];
  state: string;
  nextSteps: string[];
}

export interface SummaryProvider {
  summarize(messages: TranscriptMessage[]): Promise<SessionSummary>;
}

export interface SummarizerConfig {
  provider: SummaryProvider;
  minMessages?: number;
  maxMessages?: number;
}

const DEFAULT_MIN_MESSAGES = 2;
const DEFAULT_MAX_MESSAGES = 100;

export const SUMMARY_SYSTEM_PROMPT = `You are a session recovery assistant. Analyze the conversation transcript and generate a structured summary.

Output JSON:
{
  "recentContext": "What was being worked on",
  "progress": "What was accomplished",
  "decisions": ["Key decisions made"],
  "state": "Current state or blockers",
  "nextSteps": ["Immediate next actions"]
}`;

export function formatSummary(summary: SessionSummary): string {
  const lines: string[] = [
    `## Session Recovery [${summary.timestamp}]`,
    `**Recent context:** ${summary.recentContext}`,
    `**Progress:** ${summary.progress}`,
  ];

  if (summary.decisions.length > 0) {
    lines.push('**Decisions:**');
    for (const d of summary.decisions) lines.push(`- ${d}`);
  } else {
    lines.push('**Decisions:** None recorded');
  }

  lines.push(`**State:** ${summary.state}`);

  if (summary.nextSteps.length > 0) {
    lines.push('**Next:**');
    for (const s of summary.nextSteps) lines.push(`- ${s}`);
  } else {
    lines.push('**Next:** Resume where left off');
  }

  return lines.join('\n');
}

export class SunriseSummarizer {
  private provider: SummaryProvider;
  private minMessages: number;
  private maxMessages: number;

  constructor(config: SummarizerConfig) {
    this.provider = config.provider;
    this.minMessages = config.minMessages ?? DEFAULT_MIN_MESSAGES;
    this.maxMessages = config.maxMessages ?? DEFAULT_MAX_MESSAGES;
  }

  async summarize(messages: TranscriptMessage[]): Promise<SessionSummary | null> {
    if (messages.length === 0 || messages.length < this.minMessages) {
      return null;
    }

    const relevantMessages = messages.length > this.maxMessages
      ? messages.slice(-this.maxMessages)
      : messages;

    try {
      const summary = await this.provider.summarize(relevantMessages);
      return { ...summary, timestamp: new Date().toISOString() };
    } catch (error) {
      console.error('[SunriseSummarizer] Failed to generate summary:', error);
      return null;
    }
  }
}

export class OllamaSummaryProvider implements SummaryProvider {
  private baseUrl: string;
  private model: string;

  constructor(baseUrl: string = 'http://localhost:11434', model: string = 'llama3.2:3b') {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async summarize(messages: TranscriptMessage[]): Promise<SessionSummary> {
    const transcript = messages.map(m => `[${m.role}]: ${m.content}`).join('\n');
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: `${SUMMARY_SYSTEM_PROMPT}\n\nTranscript:\n${transcript}\n\nGenerate JSON:`,
        stream: false,
        format: 'json',
      }),
    });
    if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
    const data = await response.json() as { response: string };
    const parsed = JSON.parse(data.response) as Omit<SessionSummary, 'timestamp'>;
    return {
      timestamp: new Date().toISOString(),
      recentContext: parsed.recentContext || 'No context',
      progress: parsed.progress || 'No progress',
      decisions: parsed.decisions || [],
      state: parsed.state || 'Unknown',
      nextSteps: parsed.nextSteps || [],
    };
  }
}

export class AnthropicSummaryProvider implements SummaryProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'claude-3-5-haiku-20241022') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async summarize(messages: TranscriptMessage[]): Promise<SessionSummary> {
    const transcript = messages.map(m => `[${m.role}]: ${m.content}`).join('\n');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system: SUMMARY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Generate summary:\n\n${transcript}` }],
      }),
    });
    if (!response.ok) throw new Error(`Anthropic error: ${response.status}`);
    const data = await response.json() as { content: Array<{ type: string; text: string }> };
    const text = data.content.find(c => c.type === 'text')?.text || '{}';
    let jsonStr = text;
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) jsonStr = match[1];
    const parsed = JSON.parse(jsonStr.trim()) as Omit<SessionSummary, 'timestamp'>;
    return {
      timestamp: new Date().toISOString(),
      recentContext: parsed.recentContext || 'No context',
      progress: parsed.progress || 'No progress',
      decisions: parsed.decisions || [],
      state: parsed.state || 'Unknown',
      nextSteps: parsed.nextSteps || [],
    };
  }
}

export class OpenAISummaryProvider implements SummaryProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(apiKey: string, model: string = 'gpt-4o-mini', baseUrl?: string) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl || 'https://api.openai.com/v1';
  }

  async summarize(messages: TranscriptMessage[]): Promise<SessionSummary> {
    const transcript = messages.map(m => `[${m.role}]: ${m.content}`).join('\n');
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
          { role: 'user', content: `Generate summary:\n\n${transcript}` },
        ],
      }),
    });
    if (!response.ok) throw new Error(`OpenAI error: ${response.status}`);
    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const content = data.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content) as Omit<SessionSummary, 'timestamp'>;
    return {
      timestamp: new Date().toISOString(),
      recentContext: parsed.recentContext || 'No context',
      progress: parsed.progress || 'No progress',
      decisions: parsed.decisions || [],
      state: parsed.state || 'Unknown',
      nextSteps: parsed.nextSteps || [],
    };
  }
}
