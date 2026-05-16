import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import {
  BERKSHIRE_VECTOR_INDEX,
  embed,
  vectorStore,
} from '../vector/store';

const letterChunkSchema = z.object({
  id: z.string(),
  excerpt: z.string(),
  sourceFile: z.string(),
  year: z.string().optional(),
  similarity: z.number(),
});

export type LetterChunk = z.infer<typeof letterChunkSchema>;

const YEAR_RE = /\b((?:19|20)\d{2})\b/g;
const RANGE_RE =
  /\b((?:19|20)\d{2})\s*(?:to|through|until|-|–|—|and)\s*((?:19|20)\d{2})\b/i;

function buildYearFilter(query: string): Record<string, any> | undefined {
  const range = query.match(RANGE_RE);
  if (range) {
    const [a, b] = [range[1], range[2]].sort();
    return { year: { $gte: a, $lte: b } };
  }

  const years = Array.from(query.matchAll(YEAR_RE)).map((m) => m[1]);
  if (years.length === 1) return { year: years[0] };
  if (years.length > 1) {
    const sorted = [...years].sort();
    return { year: { $gte: sorted[0], $lte: sorted[sorted.length - 1] } };
  }

  return undefined;
}

export const searchShareholderLettersTool = createTool({
  id: 'searchShareholderLetters',

  description:
    'Semantic search over Berkshire Hathaway shareholder letter excerpts (1977–2024). ALWAYS call this before answering. If the user mentions a specific year or range of years in their question, include those years verbatim in the query string — the tool will auto-filter by year.',

  inputSchema: z.object({
    query: z
      .string()
      .describe(
        'Natural-language search query. Include any years mentioned by the user (e.g. "2023 acquisitions" or "cryptocurrency 2018 to 2022") so the tool can apply a metadata filter.',
      ),
  }),

  outputSchema: z.object({
    chunks: z.array(letterChunkSchema),
  }),

  execute: async (inputData) => {
    const { query } = inputData;
    const topK = 6;

    try {
      const filter = buildYearFilter(query);
      const vector = await embed(query);

      const results = await vectorStore.query({
        indexName: BERKSHIRE_VECTOR_INDEX,
        queryVector: vector,
        topK,
        filter,
      });

      const chunks: LetterChunk[] = results.map((row) => {
        const meta = row.metadata ?? {};
        return {
          id: String(row.id),
          excerpt: String(meta.text ?? '').slice(0, 4000),
          sourceFile: String(meta.sourceFile ?? ''),
          year: meta.year ? String(meta.year) : undefined,
          similarity: Number(row.score) || 0,
        };
      });

      return { chunks };
    } catch (error) {
      console.error('Shareholder search tool error:', error);
      return { chunks: [] };
    }
  },
});
