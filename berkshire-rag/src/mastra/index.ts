import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { Observability, MastraStorageExporter, MastraPlatformExporter, SensitiveDataFilter } from '@mastra/observability';
import { weatherWorkflow } from './workflows/weather-workflow';
import { weatherAgent } from './agents/weather-agent';
import { berkshireAgent } from './agents/berkshire-agent';
import { toolCallAppropriatenessScorer, completenessScorer, translationScorer } from './scorers/weather-scorer';

export const mastra = new Mastra({
  workflows: { weatherWorkflow },
  agents: { weatherAgent, berkshireAgent },
  scorers: { toolCallAppropriatenessScorer, completenessScorer, translationScorer },
  // LibSQL only — DuckDB file locks on Windows when dev restarts or Cursor holds mastra.duckdb
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: 'file:./mastra.db',
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
          new MastraStorageExporter(), // Persists observability events to Mastra Storage
          new MastraPlatformExporter(), // Sends observability events to Mastra Platform (if MASTRA_PLATFORM_ACCESS_TOKEN is set)
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
      },
    },
  }),
  server: {
    apiRoutes: [
      {
        path: '/chat',
        method: 'POST',
        createHandler: async ({ mastra }) => {
          return async (c) => {
            try {
              const body = (await c.req.json()) as {
                message?: string;
                threadId?: string;
              };
              const message = body?.message;
              const threadId =
                typeof body?.threadId === 'string' && body.threadId.length > 0
                  ? body.threadId
                  : 'default-thread';

              if (!message || typeof message !== 'string') {
                return c.json({ error: 'message is required' }, 400);
              }

              const agent = mastra.getAgent('berkshireAgent');
              if (!agent) {
                return c.json({ error: 'berkshireAgent is not registered' }, 500);
              }

              const streamResult = await agent.stream(message, {
                memory: { thread: threadId, resource: 'berkshire-ui' },
                maxSteps: 8,
              });

              const encoder = new TextEncoder();
              const readable = new ReadableStream({
                async start(controller) {
                  const reader = streamResult.textStream.getReader();
                  try {
                    while (true) {
                      const { done, value } = await reader.read();
                      if (done) break;
                      if (value) controller.enqueue(encoder.encode(value));
                    }
                    const full = await streamResult.getFullOutput();
                    const chunks: {
                      id: string;
                      excerpt: string;
                      sourceFile: string;
                      year?: string;
                      score: number;
                    }[] = [];
                    const seen = new Set<string>();
                    for (const step of full.steps) {
                      for (const tr of step.toolResults) {
                        if (tr.payload.toolName !== 'searchShareholderLetters') continue;
                        const res = tr.payload.result as { chunks?: typeof chunks } | undefined;
                        for (const ch of res?.chunks ?? []) {
                          if (!seen.has(ch.id)) {
                            seen.add(ch.id);
                            chunks.push(ch);
                          }
                        }
                      }
                    }
                    controller.enqueue(
                      encoder.encode(`\n---SOURCES---\n${JSON.stringify({ chunks })}`),
                    );
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    controller.enqueue(encoder.encode(`\n[stream error] ${msg}\n`));
                  } finally {
                    controller.close();
                  }
                },
              });

              return new Response(readable, {
                headers: {
                  'Content-Type': 'text/plain; charset=utf-8',
                  'Cache-Control': 'no-cache',
                },
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              return c.json({ error: message }, 500);
            }
          };
        },
      },
    ],
  },
});
