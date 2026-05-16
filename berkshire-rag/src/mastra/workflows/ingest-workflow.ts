import fs from 'node:fs';
import path from 'node:path';

import { createStep, createWorkflow } from '@mastra/core/workflows';
import { MDocument } from '@mastra/rag';
import { z } from 'zod';

import {
  BERKSHIRE_VECTOR_INDEX,
  embedBatch,
  ensureIndex,
  vectorStore,
} from '../vector/store';

function letterYearFromPath(filePath: string): string | undefined {
  const match = path.basename(filePath).match(/(19|20)\d{2}/);
  return match?.[0];
}

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;

  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item: any) => item.str).join(' ') + '\n';
  }
  return text;
}

const fileSummarySchema = z.object({
  sourceFile: z.string(),
  chunkCount: z.number(),
});

const discoverPdfsStep = createStep({
  id: 'discoverPdfs',
  description: 'Find all PDF shareholder letters in the source folder.',
  inputSchema: z.object({ folder: z.string() }),
  outputSchema: z.array(z.string()),
  execute: async ({ inputData }) => {
    const { folder } = inputData;

    if (!fs.existsSync(folder)) {
      throw new Error(`Documents folder not found: ${folder}`);
    }

    await ensureIndex();

    const files = fs
      .readdirSync(folder)
      .filter((f) => f.toLowerCase().endsWith('.pdf'))
      .map((f) => path.join(folder, f));

    console.log(`[ingest] Discovered ${files.length} PDF files in ${folder}`);
    return files;
  },
});

const processPdfStep = createStep({
  id: 'processPdf',
  description:
    'Parse one PDF, chunk it with MDocument (recursive), embed each chunk, and upsert into PgVector.',
  inputSchema: z.string(),
  outputSchema: fileSummarySchema,
  execute: async ({ inputData }) => {
    const filePath = inputData;
    const sourceFile = path.basename(filePath);
    const year = letterYearFromPath(filePath);

    console.log(`[ingest] Processing ${sourceFile}`);

    const buffer = fs.readFileSync(filePath);
    const rawText = await extractTextFromPdf(buffer);

    if (!rawText.trim()) {
      console.warn(`[ingest] No text in ${sourceFile}`);
      return { sourceFile, chunkCount: 0 };
    }

    const doc = MDocument.fromText(rawText, { sourceFile, year });
    const chunks = await doc.chunk({
      strategy: 'recursive',
      maxSize: 1000,
      overlap: 150,
    });

    console.log(`[ingest] ${sourceFile} — ${chunks.length} chunks`);

    const batchSize = 64;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);

      const vectors = await embedBatch(batch.map((c) => c.text));
      const metadata = batch.map((c, j) => ({
        text: c.text,
        sourceFile,
        year,
        chunkIndex: i + j,
      }));
      const ids = batch.map((_, j) => `${sourceFile}-${i + j}`);

      await vectorStore.upsert({
        indexName: BERKSHIRE_VECTOR_INDEX,
        vectors,
        metadata,
        ids,
      });

      console.log(
        `[ingest] ${sourceFile} — upserted ${Math.min(
          i + batch.length,
          chunks.length,
        )}/${chunks.length}`,
      );
    }

    return { sourceFile, chunkCount: chunks.length };
  },
});

export const ingestWorkflow = createWorkflow({
  id: 'ingestWorkflow',
  description:
    'Ingest Berkshire Hathaway shareholder-letter PDFs into the PgVector store.',
  inputSchema: z.object({ folder: z.string() }),
  outputSchema: z.array(fileSummarySchema),
})
  .then(discoverPdfsStep)
  .foreach(processPdfStep)
  .commit();
