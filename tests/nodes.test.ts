import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNodes } from '../src/config.js';

test('todos los nodos iniciales tienen versiones y guardrails', () => {
  const nodes = loadNodes('nodes');
  assert.ok(nodes.size >= 9);
  for (const node of nodes.values()) {
    assert.match(node.version, /^\d+\.\d+\.\d+$/);
    assert.ok(node.instructions.length > 20);
    assert.ok(node.guardrails.length > 0);
  }
});
