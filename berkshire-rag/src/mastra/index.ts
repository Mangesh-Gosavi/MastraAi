import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import {
  Observability,
  MastraStorageExporter,
  MastraPlatformExporter,
  SensitiveDataFilter,
} from '@mastra/observability';
import { PostgresStore } from '@mastra/pg';

import { berkshireAgent } from './agents/berkshire-agent';
import { ensureIndex, vectorStore } from './vector/store';
import { ingestWorkflow } from './workflows/ingest-workflow';

ensureIndex().catch((err) => {
  console.error('[startup] Failed to ensure PgVector index:', err);
});

export const mastra = new Mastra({
  agents: { berkshireAgent },
  workflows: { ingestWorkflow },
  vectors: { berkshireVector: vectorStore },
  storage: new PostgresStore({
    id: 'mastra-storage',
    connectionString: process.env.DATABASE_URL!,
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new MastraStorageExporter(),
          new MastraPlatformExporter(),
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(),
        ],
      },
    },
  }),
});
