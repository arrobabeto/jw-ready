import { loadNodes } from './config.js';
import { LlmClient } from './llm.js';
import { proposeImprovement, promoteNode } from './nodes.js';
import type { Store } from './store.js';

export async function runImprovement(store: Store, nodeId: string, configDir = process.env.NODE_CONFIG_DIR ?? 'nodes') {
  const nodes = loadNodes(configDir); const candidate = await proposeImprovement(store, nodes, new LlmClient(), nodeId);
  return candidate ?? { message: 'Se necesitan al menos cinco casos de feedback explícito para ese nodo.' };
}
export async function acceptCandidate(store: Store, candidateId: string, configDir = process.env.NODE_CONFIG_DIR ?? 'nodes') {
  const candidate = (await store.listCandidates()).find((c) => c.id === candidateId); if (!candidate) throw new Error('Candidate not found');
  const backup = promoteNode(loadNodes(configDir), candidate, configDir); await store.updateCandidateStatus(candidateId, 'accepted'); return backup;
}
