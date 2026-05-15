import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';

import { groq } from '../llm/groq';
import { searchShareholderLettersTool } from '../tools/shareholder-letters-tool';

const BERKSHIRE_INSTRUCTIONS = `
You are an expert financial analyst specializing in:

- Warren Buffett
- Berkshire Hathaway
- Value investing
- Insurance businesses
- Capital allocation
- Long-term investing

Rules:
- ALWAYS use the shareholder letters search tool before answering
- Only answer from retrieved context
- Never hallucinate facts
- If information is unavailable, clearly say:
  "I could not find this information in the Berkshire shareholder letters."
- Keep answers concise but insightful
- Mention years when relevant
- Cite Berkshire insights accurately
`;

export const berkshireAgent = new Agent({
  id: 'berkshire-hathaway-agent',

  name: 'Berkshire Hathaway Intelligence',

  instructions: BERKSHIRE_INSTRUCTIONS,

  model: groq('llama-3.1-8b-instant'),

  tools: {
    searchShareholderLetters: searchShareholderLettersTool,
  },

  memory: new Memory({
    options: {
      lastMessages: 10,
    },
  }),
});