import { PgVector } from '@mastra/pg';

/** Postgres index name for PgVector.createIndex / query / upsert. */
export const BERKSHIRE_VECTOR_INDEX = 'berkshire_letters';

export const vectorStore = new PgVector({
  id: 'berkshire_rag',
  connectionString: process.env.DATABASE_URL!,
});
