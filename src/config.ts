import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { NodeConfig } from './types.js';

export const nodeSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/), version: z.string().regex(/^\d+\.\d+\.\d+$/), type: z.enum(['deterministic', 'llm']), enabled: z.boolean(),
  model: z.object({ name: z.string(), reasoning_effort: z.string().optional() }).optional(), instructions: z.string(),
  rules: z.array(z.string()), examples: z.array(z.unknown()).optional(), input_schema: z.record(z.string(), z.unknown()),
  output_schema: z.record(z.string(), z.unknown()), allowed_tools: z.array(z.string()), retrieval_policy: z.record(z.string(), z.unknown()).optional(),
  guardrails: z.array(z.string()), evaluation_suite: z.array(z.string()), fallback_behavior: z.string().optional()
});

export function loadNodes(dir = process.env.NODE_CONFIG_DIR ?? 'nodes'): Map<string, NodeConfig> {
  const nodes = new Map<string, NodeConfig>();
  if (!fs.existsSync(dir)) throw new Error(`Node config directory does not exist: ${dir}`);
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))) {
    const value = nodeSchema.parse(yaml.load(fs.readFileSync(path.join(dir, file), 'utf8')));
    if (nodes.has(value.id)) throw new Error(`Duplicate node id: ${value.id}`);
    nodes.set(value.id, value);
  }
  return nodes;
}

export const protectedGuardrails = new Set(['immutable_policy', 'official_domains_only', 'sources_first', 'retention_90_days', 'human_approval', 'no_code_mutation']);
