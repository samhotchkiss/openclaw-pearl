# Pearl Memory System

## Overview

Pearl's memory system automatically extracts, stores, and retrieves information that should persist across sessions. It's designed to work invisibly — agents don't know they're being augmented with memories.

## Memory Lifecycle

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   EXTRACT   │────▶│    STORE    │────▶│  RETRIEVE   │────▶│   AUGMENT   │
│             │     │             │     │             │     │             │
│ Classify    │     │ Embed       │     │ Search      │     │ Inject into │
│ message for │     │ and save    │     │ relevant    │     │ system      │
│ memorable   │     │ to SQLite   │     │ memories    │     │ prompt      │
│ content     │     │             │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

## Extraction

### What Gets Extracted

| Type | Description | Examples |
|------|-------------|----------|
| `fact` | Concrete information | Names, dates, addresses, numbers |
| `preference` | User likes/dislikes | "I prefer dark mode", "I hate meetings before 10am" |
| `rule` | Agent behavior instructions | "Always use bullet points", "Never send emails without asking" |
| `decision` | Choices with reasoning | "We decided to use SQLite because..." |
| `health` | Medical information | Medications, conditions, allergies |
| `reminder` | Time-based notes | "Remind me to...", "Don't forget..." |
| `relationship` | People connections | "Jeff is my business partner", "Noah is 8 years old" |

### Extraction Prompt

```
You are a memory extraction system. Analyze the user's message and identify content worth remembering long-term.

Extract ONLY clear, explicit statements. Do not infer or assume.

Categories:
- fact: Concrete information (names, dates, addresses, numbers)
- preference: User likes/dislikes, opinions
- rule: Instructions for how the agent should behave
- decision: Choices made, with reasoning if given
- health: Medical information, medications, conditions
- reminder: Time-based notes
- relationship: People and their connections to the user

Return JSON:
{
  "memories": [
    {
      "type": "preference",
      "content": "User prefers concise responses",
      "tags": ["communication", "style"],
      "confidence": 0.9
    }
  ]
}

If nothing memorable, return: { "memories": [] }

Rules:
- Be conservative. Only extract clear statements.
- Normalize content (third person: "User prefers..." not "I prefer...")
- Include relevant tags for searchability
- Set confidence 0-1 based on clarity

Message to analyze:
{message}
```

### Extraction Config

```yaml
extraction:
  enabled: true
  model: ollama/llama3.2:3b
  async: true                    # Don't block requests
  min_confidence: 0.7            # Threshold to store
  extract_from_assistant: false  # Also extract from AI responses
  dedup_window: 3600             # Seconds to check for duplicates
```

## Storage

### Schema

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,              -- UUID
  agent_id TEXT NOT NULL,           -- Namespace
  type TEXT NOT NULL,               -- fact, preference, rule, etc.
  content TEXT NOT NULL,            -- The actual memory
  tags TEXT,                        -- JSON array of tags
  embedding BLOB,                   -- Float32 array for search
  confidence REAL,                  -- Extraction confidence
  created_at INTEGER NOT NULL,      -- Unix timestamp
  updated_at INTEGER NOT NULL,
  accessed_at INTEGER,              -- Last retrieval time
  access_count INTEGER DEFAULT 0,   -- Retrieval count
  expires_at INTEGER,               -- Optional expiration
  source_session TEXT,              -- Session that created this
  source_message_id TEXT            -- Original message ID
);

-- Indexes
CREATE INDEX idx_memories_agent ON memories(agent_id);
CREATE INDEX idx_memories_type ON memories(agent_id, type);
CREATE INDEX idx_memories_created ON memories(agent_id, created_at DESC);
CREATE INDEX idx_memories_accessed ON memories(agent_id, accessed_at DESC);
```

### Memory ID Generation

Use UUIDv7 (time-ordered) for efficient indexing:
```typescript
import { uuidv7 } from 'uuidv7';
const id = uuidv7(); // "018d5f3c-5b3b-7000-8000-000000000000"
```

### Embedding Storage

Store embeddings as binary blobs (Float32Array):
```typescript
function serializeEmbedding(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

function deserializeEmbedding(buffer: Buffer): number[] {
  return Array.from(new Float32Array(buffer.buffer));
}
```

### Deduplication

Before storing, check for near-duplicates:
```typescript
async function isDuplicate(agentId: string, content: string, embedding: number[]): Promise<boolean> {
  const recent = await db.query(`
    SELECT id, embedding FROM memories 
    WHERE agent_id = ? 
    AND created_at > ?
    ORDER BY created_at DESC
    LIMIT 50
  `, [agentId, Date.now() - DEDUP_WINDOW]);
  
  for (const memory of recent) {
    const similarity = cosineSimilarity(embedding, memory.embedding);
    if (similarity > 0.95) return true; // Near-duplicate
  }
  return false;
}
```

## Retrieval

### Semantic Search

```typescript
async function searchMemories(
  agentId: string, 
  query: string, 
  options: RetrievalOptions
): Promise<Memory[]> {
  // 1. Embed the query
  const queryEmbedding = await embedder.embed(query);
  
  // 2. Get all memories for agent (or use vector index)
  const memories = await db.query(`
    SELECT * FROM memories WHERE agent_id = ?
  `, [agentId]);
  
  // 3. Score by similarity
  const scored = memories.map(m => ({
    ...m,
    similarity: cosineSimilarity(queryEmbedding, m.embedding)
  }));
  
  // 4. Apply recency boost
  if (options.recencyBoost) {
    const now = Date.now();
    scored.forEach(m => {
      const ageHours = (now - m.created_at) / 3600000;
      m.score = m.similarity * Math.exp(-ageHours / 168); // 1-week half-life
    });
  }
  
  // 5. Apply type weights
  scored.forEach(m => {
    m.score *= options.typeWeights?.[m.type] || 1.0;
  });
  
  // 6. Filter and sort
  return scored
    .filter(m => m.similarity >= options.minSimilarity)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.maxMemories);
}
```

### Retrieval Config

```yaml
retrieval:
  max_memories: 10          # Max to inject
  min_similarity: 0.7       # Threshold
  token_budget: 500         # Max tokens for memories
  recency_boost: true       # Recent memories rank higher
  type_weights:
    rule: 1.5               # Rules are important
    decision: 1.3           # Decisions matter
    preference: 1.2         # Preferences helpful
    fact: 1.0
    health: 1.0
    relationship: 1.0
    reminder: 0.8           # Lower weight for reminders
```

### Token Budgeting

Stop adding memories when budget exhausted:
```typescript
function selectMemoriesWithinBudget(
  memories: Memory[], 
  budgetTokens: number
): Memory[] {
  const selected: Memory[] = [];
  let tokensUsed = 0;
  
  for (const memory of memories) {
    const memoryTokens = estimateTokens(memory.content);
    if (tokensUsed + memoryTokens > budgetTokens) break;
    selected.push(memory);
    tokensUsed += memoryTokens;
  }
  
  return selected;
}

function estimateTokens(text: string): number {
  // Rough estimate: 4 chars per token
  return Math.ceil(text.length / 4);
}
```

## Augmentation

### Injection Format

Memories are injected as a prefix to the system message:

```
<pearl:memories>
## Relevant Context
- User prefers concise, direct responses
- User's timezone is America/Denver (MST)
- Decision (2024-01-15): Use SQLite for local storage
- User's son Noah is 8 years old and goes to May Center
</pearl:memories>

{original_system_message}
```

### Session Tracking

Avoid re-injecting the same memories within a session:

```typescript
const sessionMemories = new Map<string, Set<string>>();

function filterAlreadyInjected(
  sessionId: string, 
  memories: Memory[]
): Memory[] {
  const injected = sessionMemories.get(sessionId) || new Set();
  const fresh = memories.filter(m => !injected.has(m.id));
  
  // Track newly injected
  fresh.forEach(m => injected.add(m.id));
  sessionMemories.set(sessionId, injected);
  
  return fresh;
}
```

### Update Access Stats

When memories are retrieved, update access tracking:
```typescript
async function recordAccess(memoryIds: string[]): Promise<void> {
  const now = Date.now();
  await db.run(`
    UPDATE memories 
    SET accessed_at = ?, access_count = access_count + 1
    WHERE id IN (${memoryIds.map(() => '?').join(',')})
  `, [now, ...memoryIds]);
}
```

## Memory Management

### Manual CRUD

Users can manage memories via API:

```bash
# List all memories
GET /v1/memories?agent_id=main

# Get specific memory
GET /v1/memories/018d5f3c-5b3b-7000-8000-000000000000

# Create memory manually
POST /v1/memories
{
  "agent_id": "main",
  "type": "rule",
  "content": "Always format code with 2-space indents",
  "tags": ["code", "formatting"]
}

# Update memory
PUT /v1/memories/018d5f3c-5b3b-7000-8000-000000000000
{
  "content": "Updated content",
  "tags": ["new", "tags"]
}

# Delete memory
DELETE /v1/memories/018d5f3c-5b3b-7000-8000-000000000000
```

### Expiration

Memories can auto-expire:
```typescript
// Set expiration on creation
await createMemory({
  ...memory,
  expires_at: Date.now() + 7 * 24 * 3600 * 1000 // 1 week
});

// Cleanup job
async function pruneExpired(): Promise<number> {
  const result = await db.run(`
    DELETE FROM memories WHERE expires_at < ?
  `, [Date.now()]);
  return result.changes;
}
```

### Consolidation (Future)

Merge related memories to reduce noise:
```typescript
// Example: Multiple preference statements
// "User likes dark mode" + "User prefers dark themes" + "User wants dark UI"
// → "User prefers dark mode for all interfaces"
```

## Privacy & Security

1. **Namespace isolation:** Each agent has separate memory space
2. **No cross-agent access:** Memories never leak between agents
3. **Sensitive classification:** Health/financial auto-tagged as sensitive
4. **Local extraction:** Uses local LLM, not cloud API
5. **Encryption (optional):** Can encrypt memory content at rest
6. **Audit log:** Track all memory access

## Multi-Agent Scope (Issue #35)

While memories are namespace-isolated by default, some memories should be shared globally across all agents.

### Scope Types

| Scope | Description | Storage | Retrieval |
|-------|-------------|---------|-----------|
| `global` | Shared across all agents | `agent_id = "_global"` | All agents query global + own |
| `agent` | Specific to one agent | `agent_id = "nova"` | Only that agent retrieves |
| `inferred` | Scope determined at retrieval | Stored with best-guess | Semantic matching decides |

### Scope Classification

During extraction, classify scope based on:

1. **Channel context**
   - Main DM with owner → likely `global`
   - Project channel (#proj-ai-updates) → likely `agent` for that project's agent
   - Group chat → likely `global`

2. **Content type**
   - User preferences → usually `global`
   - Task instructions → usually `agent`
   - Facts about people → usually `global`
   - Workflow rules → check for agent-specific keywords

3. **Explicit keywords**
   - "for all agents", "everyone should know" → `global`
   - "just for Tex", "Nova should" → `agent`

### Extraction Enhancement

```typescript
interface MemoryExtraction {
  type: MemoryType;
  content: string;
  scope: "global" | "agent" | "inferred";
  agentId?: string;  // If scope is "agent"
  confidence: number;
}
```

### Retrieval Logic

```typescript
async function retrieve(query: string, agentId: string): Promise<Memory[]> {
  // Get global memories
  const global = await searchMemories(query, { agentId: "_global" });
  
  // Get agent-specific memories
  const agent = await searchMemories(query, { agentId });
  
  // Merge and deduplicate
  return mergeAndRank([...global, ...agent]);
}
```

### Examples

**Global memories (all agents know):**
- "Sam prefers dark mode"
- "Essie's birthday is August 18"
- "Sam is celiac"
- "The office address is 1000 Cordova Place"

**Agent-specific memories:**
- "When writing blog posts, use casual tone" → `agent: "tex"`
- "Focus on AI research papers, not product launches" → `agent: "nova"`
- "Never trade more than $500 per position" → `agent: "trey"`
- "Use sag for voice, not system TTS" → `agent: "main"`
