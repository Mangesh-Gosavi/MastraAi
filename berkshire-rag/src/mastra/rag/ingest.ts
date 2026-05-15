import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import 'dotenv/config';

import ollama from 'ollama';
import { Client } from 'pg';

import { MDocument } from '@mastra/rag';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * PostgreSQL client
 */
const db = new Client({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Ollama embedding model
 */
const EMBEDDING_MODEL = 'nomic-embed-text';

/**
 * nomic-embed-text dimension
 */
const EMBEDDING_DIM = 768;

/**
 * Extract year from filename
 */
function letterYearFromPath(filePath: string): string | undefined {
  const base = path.basename(filePath);

  const match = base.match(/(20\d{2})/);

  return match?.[1];
}

/**
 * PDF extraction
 */
async function extractTextFromPdf(
  buffer: Buffer
): Promise<string> {
  const pdfjsLib = await import(
    'pdfjs-dist/legacy/build/pdf.mjs'
  );

  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
  }).promise;

  let text = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);

    const content = await page.getTextContent();

    const strings = content.items.map(
      (item: any) => item.str
    );

    text += strings.join(' ') + '\n';
  }

  return text;
}

/**
 * Create embedding using Ollama
 */
async function embed(text: string): Promise<number[]> {
  const response = await ollama.embeddings({
    model: EMBEDDING_MODEL,
    prompt: text,
  });

  return response.embedding;
}

/**
 * Create DB + table
 */
async function initializeDatabase() {
  console.log('Initializing pgvector...');

  /**
   * DO NOT CREATE EXTENSION HERE
   * already exists in docker postgres
   */

  await db.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      content TEXT,
      metadata JSONB,
      embedding VECTOR(${EMBEDDING_DIM})
    );
  `);

  console.log('pgvector ready ✅');
}

/**
 * Store vectors
 */
async function storeBatch(
  ids: string[],
  vectors: number[][],
  metadata: Record<string, any>[]
) {
  for (let i = 0; i < vectors.length; i++) {
    await db.query(
      `
      INSERT INTO documents (
        id,
        content,
        metadata,
        embedding
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id)
      DO UPDATE SET
        content = EXCLUDED.content,
        metadata = EXCLUDED.metadata,
        embedding = EXCLUDED.embedding
      `,
      [
        ids[i],
        metadata[i].text,
        metadata[i],
        JSON.stringify(vectors[i]),
      ]
    );
  }
}

/**
 * Process single PDF
 */
async function ingestFile(
  filePath: string
): Promise<void> {
  console.log(`\nProcessing: ${filePath}`);

  const buffer = fs.readFileSync(filePath);

  /**
   * Extract text
   */
  const rawText = await extractTextFromPdf(buffer);

  if (!rawText) {
    console.warn(`No text found: ${filePath}`);
    return;
  }

  /**
   * Convert to MDocument
   */
  const doc = MDocument.fromText(rawText, {
    sourcePath: filePath,
  });

  /**
   * Chunking
   */
  const chunks = await doc.chunk({
    strategy: 'character',
    maxSize: 1000,
    overlap: 150,
  });

  const year = letterYearFromPath(filePath);

  const sourceFile = path.basename(filePath);

  console.log(`Chunks: ${chunks.length}`);

  /**
   * Batch embedding + storage
   */
  const batchSize = 20;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);

    const vectors: number[][] = [];
    const metadata: Record<string, any>[] = [];
    const ids: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const chunkIndex = i + j;

      const text = batch[j].text;

      console.log(
        `Embedding chunk ${chunkIndex + 1}/${chunks.length}`
      );

      const vector = await embed(text);

      vectors.push(vector);

      metadata.push({
        text,
        sourceFile,
        year,
        chunkIndex,
      });

      ids.push(`${sourceFile}-${chunkIndex}`);
    }

    /**
     * Store in PostgreSQL
     */
    await storeBatch(ids, vectors, metadata);

    console.log(
      `Stored batch ${i + 1} → ${Math.min(
        i + batch.length,
        chunks.length
      )}`
    );
  }

  console.log(`Done: ${sourceFile}`);
}

/**
 * Main runner
 */
async function run(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL missing');
  }

  /**
   * Connect DB
   */
  await db.connect();

  console.log('Connected to PostgreSQL ✅');

  /**
   * Initialize pgvector
   */
  await initializeDatabase();

  /**
   * Folder path
   */
  const folder = path.join(
    process.cwd(),
    'documents'
  );

  if (!fs.existsSync(folder)) {
    console.error('Missing folder:', folder);

    process.exit(1);
  }

  /**
   * Find PDFs
   */
  const files = fs
    .readdirSync(folder)
    .filter((f) =>
      f.toLowerCase().endsWith('.pdf')
    );

  console.log(`Found ${files.length} PDF files`);

  /**
   * Process files
   */
  for (const file of files) {
    await ingestFile(path.join(folder, file));
  }

  console.log('\nALL DONE — RAG READY ✅');

  /**
   * Close DB
   */
  await db.end();
}

/**
 * Start app
 */
run().catch(async (err) => {
  console.error('\nERROR:', err);

  try {
    await db.end();
  } catch {}

  process.exit(1);
});