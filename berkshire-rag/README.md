# Berkshire Hathaway Intelligence — Mastra RAG

A Mastra RAG agent that answers questions about Warren Buffett's investment philosophy and Berkshire Hathaway's business strategy, grounded in the annual shareholder letters (1977–2024).

## Stack

- **Framework**: [Mastra](https://mastra.ai/) (agents, workflows, memory, tools, observability)
- **LLM**: OpenAI `gpt-4o-mini`
- **Embeddings**: OpenAI `text-embedding-3-small` (1536-dim)
- **Vector store**: PostgreSQL + pgvector via Mastra's `PgVector` (`@mastra/pg`)
- **Document processing**: Mastra `MDocument` + `pdfjs-dist`
- **Memory**: Mastra `Memory` backed by LibSQL (`mastra.db`)
- **UI**: Mastra Studio at http://localhost:4111

## Project layout

```
src/mastra/
  index.ts                            # Mastra config — registers agent, workflow, vector store
  agents/berkshire-agent.ts           # RAG agent (system prompt, tool, memory)
  tools/shareholder-letters-tool.ts   # Vector search tool (year auto-extracted from query)
  workflows/ingest-workflow.ts        # Mastra Workflow: discoverPdfs → foreach(processPdf)
  vector/store.ts                     # PgVector instance, embed() helper, ensureIndex()
  rag/ingest.ts                       # Thin runner that triggers ingestWorkflow
documents/                            # Shareholder-letter PDFs (1977.pdf … 2024.pdf)
```

## Prerequisites

1. **Node** ≥ 22.13
2. **PostgreSQL** with the `pgvector` extension installed (Docker example below)
3. An **OpenAI API key** (https://platform.openai.com/api-keys) — used for both chat (`gpt-4o-mini`) and embeddings (`text-embedding-3-small`)

### Postgres via Docker

```
docker run -d --name berkshire-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=berkshire \
  -p 5432:5432 \
  pgvector/pgvector:pg16
```

Then enable the extension once:

```
docker exec -it berkshire-pg psql -U postgres -d berkshire \
  -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

## Setup

```
cp .env.example .env
# fill in OPENAI_API_KEY and DATABASE_URL
npm install
```

## Ingest the letters

Put the shareholder-letter PDFs in `documents/` (filename pattern `YYYY.pdf`, e.g. `2023.pdf`), then run:

```
npm run ingest
```

This triggers the `ingestWorkflow` Mastra Workflow, which:

- ensures the PgVector index (`berkshire_letters`, HNSW + cosine, with btree indexes on `year` and `sourceFile`)
- discovers every `*.pdf` under `documents/`
- for each file, parses it with `pdfjs-dist`, chunks via `MDocument.chunk({ strategy: 'recursive', maxSize: 1000, overlap: 150 })`, embeds chunks in batches of 64 with OpenAI `text-embedding-3-small`, and upserts vectors + metadata (`text`, `sourceFile`, `year`, `chunkIndex`) into PgVector.

You can also run the workflow from Studio (Workflows → `ingestWorkflow` → Run) with `{ "folder": "documents" }`.

Re-running is safe — `upsert` replaces existing chunks by id.

## Run the agent

```
npm run dev
```

Open http://localhost:4111 → Studio → pick **Berkshire Hathaway Intelligence**.

Studio handles streaming, conversation threads, source/tool-result display, and memory.

## Sample questions

- *What is Warren Buffett's investment philosophy?*
- *Can you elaborate on his views about diversification?* (follow-up)
- *How has Berkshire's acquisition strategy evolved over time?*
- *What does Buffett think about cryptocurrency?*
- *What companies did Berkshire acquire in 2023?*

The agent always calls the `searchShareholderLetters` tool first, then answers using only the retrieved excerpts, with `(YYYY letter)` inline citations and a trailing **Sources** list.

## Retrieval behaviour

The search tool takes only `{ query, topK }`. Year filtering happens automatically: any 4-digit year mentioned in the query (single year or range like "2019 to 2024") is parsed inside the tool and translated to a PgVector metadata filter on `year`. The agent prompt instructs it to keep user-mentioned years verbatim in the query so this kicks in.

## Deployment

For a production build run:

```
npm run build      # mastra build
npm run start      # mastra start
```

Mastra produces a Node-compatible bundle under `.mastra/output/`. To run it elsewhere you need:

- the same Postgres + pgvector instance (or a managed pgvector provider — Neon, Supabase, Railway Postgres) reachable via `DATABASE_URL`
- the LibSQL file (`mastra.db`) on a persistent volume if you want conversation memory to survive restarts
- `OPENAI_API_KEY` in the environment

Mastra also supports one-click deploys to the [Mastra platform](https://projects.mastra.ai) — point it at this repo and set the same env vars.

## Notes

- Chunking + embedding parameters live in [`src/mastra/workflows/ingest-workflow.ts`](src/mastra/workflows/ingest-workflow.ts).
- PgVector setup (index name, dimension, HNSW config, metadata indexes) is in [`src/mastra/vector/store.ts`](src/mastra/vector/store.ts).
- Memory uses the `Memory` adapter with `lastMessages: 10`, backed by `LibSQLStore` writing to `mastra.db`.
- The PgVector index is also created on Mastra-server startup via `ensureIndex()` in [`src/mastra/index.ts`](src/mastra/index.ts), so the very first agent query won't hit a missing-table error.
