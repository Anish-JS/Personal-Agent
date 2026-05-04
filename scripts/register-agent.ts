#!/usr/bin/env tsx
/**
 * One-time script to create the Managed Agent in Anthropic.
 *
 * Prerequisites:
 *   pnpm add -Dw js-yaml @types/js-yaml     (already in devDependencies)
 *
 * Run:
 *   doppler run -- pnpm register-agent
 *
 * Then save the printed AGENT_ID:
 *   doppler secrets set AGENT_ID=agt_...
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, '..', 'config', 'agent.yaml');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is required');
  process.exit(1);
}

interface AgentConfig {
  name: string;
  model: string;
  description: string;
  system_prompt: string;
  tools: string[];
  mcp_servers: Array<{ id: string; description: string; vault_ref: string }>;
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as AgentConfig;

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

console.log(`\nAgent created: ${agent.id}`);
console.log('\nNext step — save to Doppler:');
console.log(`  doppler secrets set AGENT_ID=${agent.id}`);
