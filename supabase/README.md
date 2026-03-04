# Supabase Database Setup Guide

This project uses Supabase with PostgreSQL and pgvector for semantic memory storage.

## Prerequisites

1. A Supabase account ([supabase.com](https://supabase.com))
2. OpenAI API key with access to embeddings models
3. Node.js 18+ and pnpm installed

## Initial Setup

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Choose a region close to your users
3. Wait for the project to be provisioned

### 2. Run Database Migrations

Navigate to your Supabase project dashboard:

1. Go to **SQL Editor** in the left sidebar
2. Click **New Query**
3. Copy the contents of `supabase/migrations/001_initial_schema.sql`
4. Paste and run the query

This will:
- Enable the pgvector extension
- Create tables: `messages`, `goals`, `user_facts`, `conversation_contexts`
- Set up HNSW indexes for fast similarity search
- Create helper functions for semantic search
- Configure Row Level Security (RLS)

### 3. Configure Environment Variables

Add the following to your `.env` file:

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# OpenAI
OPENAI_API_KEY=sk-your-openai-api-key
```

Get these values from:
- **SUPABASE_URL**: Project Settings > API > Project URL
- **SUPABASE_ANON_KEY**: Project Settings > API > anon/public key
- **SUPABASE_SERVICE_ROLE_KEY**: Project Settings > API > service_role key (keep secret!)
- **OPENAI_API_KEY**: Your OpenAI account

### 4. Deploy Edge Functions (Optional)

Edge Functions keep your OpenAI API key secure. To deploy:

```bash
# Install Supabase CLI
brew install supabase/tap/supabase

# Link to your project
supabase link --project-ref your-project-ref

# Deploy functions
supabase functions deploy embeddings
supabase functions deploy semantic-search
```

Set the `OPENAI_API_KEY` secret:
```bash
supabase secrets set OPENAI_API_KEY=sk-your-key
```

## Database Schema

### Messages Table
Stores conversation history with semantic embeddings.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| telegram_user_id | BIGINT | User's Telegram ID |
| role | TEXT | 'user', 'assistant', or 'system' |
| content | TEXT | Message text |
| embedding | vector(3072) | OpenAI embedding |
| created_at | TIMESTAMPTZ | Timestamp |

### Goals Table
Stores user goals with semantic search.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| telegram_user_id | BIGINT | User's Telegram ID |
| title | TEXT | Goal title |
| description | TEXT | Optional details |
| status | TEXT | 'active', 'completed', 'archived' |
| priority | INTEGER | 1-10 priority score |
| embedding | vector(3072) | OpenAI embedding |

### User Facts Table
Stores facts about users for personalization.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| telegram_user_id | BIGINT | User's Telegram ID |
| fact_type | TEXT | Type of fact |
| fact_text | TEXT | The fact content |
| confidence | INTEGER | 1-10 confidence score |
| embedding | vector(3072) | OpenAI embedding |

## Usage Examples

### Store a message with embedding

```typescript
import { getDatabaseClient } from "./src/database";

const db = getDatabaseClient();

await db.storeUserMessage(
  123456789, // Telegram user ID
  "Hello, how are you?",
);
```

### Retrieve conversation context

```typescript
const context = await db.getQueryContext(
  123456789,
  "What were we talking about?",
  { maxMessages: 20, maxSimilarMessages: 5 },
);

console.log(context.conversation); // Recent messages
console.log(context.relevantMessages); // Semantically similar
console.log(context.relevantGoals); // Related goals
console.log(context.userFacts); // User preferences
```

### Create and search goals

```typescript
// Create a goal
await db.createGoal(
  123456789,
  "Learn TypeScript",
  "Complete a TypeScript course this month",
  8, // priority
  "learning",
);

// Get active goals
const goals = await db.getActiveGoals(123456789);

// Semantic search for relevant goals
const results = await db.semanticSearch(
  123456789,
  "What should I focus on learning?",
);
```

### Store user facts

```typescript
import type { FactType } from "./src/database";

await db.upsertFact(
  123456789,
  "preference",
  "Prefers concise responses",
  7, // confidence
  "user_explicit",
);
```

## Vector Similarity Search

The database uses pgvector with HNSW indexes for fast semantic search:

- **Model**: OpenAI text-embedding-3-large (3072 dimensions)
- **Distance**: Cosine similarity
- **Index**: HNSW with m=16, ef_construction=64

Search functions:
- `search_similar_messages()` - Find similar conversation history
- `search_relevant_goals()` - Find goals related to a query
- `search_relevant_facts()` - Find facts relevant to a query

## Performance Tips

1. **Batch embeddings**: Use `storeMessagesBatch()` for multiple messages
2. **Async embeddings**: Generate embeddings in background for non-critical data
3. **Cache context**: Store conversation context in memory for frequently accessed users
4. **Set appropriate thresholds**: Lower similarity thresholds = more results, slower

## Security Notes

- **Never commit** service role keys or API keys to git
- **Use Edge Functions** for production to keep API keys server-side
- **RLS is enabled** by default - users can only access their own data
- **Service role key** bypasses RLS - use with extreme caution

## Troubleshooting

### pgvector extension not found
Run in Supabase SQL Editor:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### Embedding dimension mismatch
Ensure you're using text-embedding-3-large (3072 dims) consistently.

### Slow searches
Check that HNSW indexes are created:
```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'messages';
```

## Migrations

To create a new migration:

```sql
-- supabase/migrations/002_add_new_table.sql
CREATE TABLE new_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ...
);
```

Apply via the Supabase dashboard SQL Editor.
