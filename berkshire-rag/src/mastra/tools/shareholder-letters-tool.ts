import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import ollama from 'ollama';

import { Client } from 'pg';
const db = new Client({
  connectionString: process.env.DATABASE_URL,
});

await db.connect();

/**
 * Ollama embedding model
 */
const EMBEDDING_MODEL = 'nomic-embed-text';

/**
 * Output schema
 */
const letterChunkSchema = z.object({
  id: z.string(),
  excerpt: z.string(),
  sourceFile: z.string(),
  year: z.string().optional(),
  score: z.number(),
});

export type LetterChunk = z.infer<
  typeof letterChunkSchema
>;

/**
 * Create embedding using Ollama
 */
async function embedQuery(
  text: string
): Promise<number[]> {
  const response = await ollama.embeddings({
    model: EMBEDDING_MODEL,
    prompt: text,
  });

  return response.embedding;
}

/**
 * Berkshire shareholder letters search tool
 */
export const searchShareholderLettersTool =
  createTool({
    id: 'searchShareholderLetters',

    description:
      'Semantic search over Berkshire Hathaway shareholder letter excerpts. Use this tool before answering questions about Warren Buffett, Berkshire Hathaway, investing, acquisitions, insurance, business strategy, or shareholder letters.',

    inputSchema: z.object({
      query: z
        .string()
        .describe(
          'Natural language search query'
        ),

      topK: z
        .number()
        .int()
        .min(1)
        .max(12)
        .optional()
        .describe(
          'Number of relevant chunks to return'
        ),
    }),

    outputSchema: z.object({
      chunks: z.array(letterChunkSchema),
    }),

    execute: async (inputData) => {
      try {
        const { query, topK = 6 } = inputData;
    
        /**
         * Create embedding
         */
        const vector = await embedQuery(query);
    
        /**
         * Direct PostgreSQL pgvector search
         */
        const result = await db.query(
          `
          SELECT
            id,
            content,
            metadata,
            embedding <=> $1::vector AS score
          FROM documents
          ORDER BY embedding <=> $1::vector
          LIMIT $2
          `,
          [JSON.stringify(vector), topK]
        );
    
        const chunks: LetterChunk[] = result.rows.map(
          (row:any) => {
            const meta = row.metadata ?? {};
    
            return {
              id: String(row.id),
    
              excerpt: row.content?.slice(0, 4000) || '',
    
              sourceFile:
                meta.sourceFile || '',
    
              year: meta.year,
    
              score: Number(row.score) || 0,
            };
          }
        );
    
        return {
          chunks,
        };
      } catch (error) {
        console.error(
          'Shareholder search tool error:',
          error
        );
    
        return {
          chunks: [],
        };
      }
    },
  });