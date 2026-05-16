import { PgVector } from '@mastra/pg';
import OpenAI from 'openai';

export const BERKSHIRE_VECTOR_INDEX = 'berkshire_letters';

export const EMBEDDING_MODEL = 'text-embedding-3-small';

export const EMBEDDING_DIM = 1536;

export const vectorStore = new PgVector({
  id: 'berkshire_rag',
  connectionString: process.env.DATABASE_URL!,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function embed(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });

  return response.data[0].embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });

  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

let indexReady: Promise<void> | undefined;

export function ensureIndex(): Promise<void> {
  if (!indexReady) {
    indexReady = vectorStore.createIndex({
      indexName: BERKSHIRE_VECTOR_INDEX,
      dimension: EMBEDDING_DIM,
      metric: 'cosine',
      indexConfig: { type: 'hnsw' },
      metadataIndexes: ['year', 'sourceFile'],
    });
  }

  return indexReady;
}
