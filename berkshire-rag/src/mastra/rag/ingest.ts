import path from 'node:path';

import 'dotenv/config';

import { mastra } from '../index';
import { vectorStore } from '../vector/store';

async function run(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL missing');
  }

  const workflow = mastra.getWorkflow('ingestWorkflow');
  const wfRun = await workflow.createRun();

  const result = await wfRun.start({
    inputData: { folder: path.join(process.cwd(), 'documents') },
  });

  if (result.status === 'success') {
    const summaries = result.result;
    const totalFiles = Array.isArray(summaries) ? summaries.length : 0;
    const totalChunks = Array.isArray(summaries)
      ? summaries.reduce((sum, s) => sum + (s?.chunkCount ?? 0), 0)
      : 0;

    console.log(`\nALL DONE — ${totalFiles} files, ${totalChunks} chunks ✅`);
  } else {
    console.error('Ingest workflow did not succeed:', result.status);
    if ('error' in result) console.error(result.error);
  }

  await vectorStore.disconnect();
}

run().catch(async (err) => {
  console.error('\nERROR:', err);
  try {
    await vectorStore.disconnect();
  } catch {}
  process.exit(1);
});
