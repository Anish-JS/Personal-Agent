#!/usr/bin/env tsx
/**
 * One-time script to create the Managed Agent in Anthropic.
 * Run: tsx scripts/register-agent.ts
 * Then save the printed AGENT_ID to Doppler: doppler secrets set AGENT_ID=agt_...
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, '..', 'config', 'agent.yaml');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as {
  name: string;
  model: string;
  description: string;
  system_prompt: string;
  tools: string[];
  mcp_servers: Array<{ id: string; description: string; vault_ref: string }>;
};

const agent = await (client.beta as any).agents.create(
  {
    name: config.name,
    model: config.model,
    description: config.description,
    system_prompt: config.system_prompt,
    tools: config.tools.map((t: string) => ({ type: t })),
    mcp_servers: config.mcp_servers,
  },
  { headers: { 'anthropic-beta': 'managed-agents-2026-04-01' } }
);

console.log(`Agent created: ${agent.id}`);
console.log(`\nNext step — save to Doppler:`);
console.log(`  doppler secrets set AGENT_ID=${agent.id}`);
