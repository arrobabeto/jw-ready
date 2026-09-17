import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOfficialPage, validateMaterial } from '../src/sources.js';
import {material} from './helpers.js';

const html = `<html><head><meta property="og:title" content="Vida y Ministerio 14-20"/></head><body><div class="bodyTxt"><h3 id="p5">1. Jehová recompensa</h3><p id="p6">(10 mins.)</p><p id="p7">Los recabitas obedecieron (<a class="jsBibleLink" data-targetverses="24035005-24035006">Jer 35:5, 6</a>).</p><h3 id="p11">2. Perlas</h3><p id="p12">¿Qué perlas ha encontrado?</p></div></body></html>`;

test('parsea páginas oficiales semánticas y conserva anclas', () => {
  const result = parseOfficialPage('https://www.jw.org/es/test', html);
  assert.equal(result.title, 'Vida y Ministerio 14-20');
  assert.equal(result.excerpts.length, 3);
  assert.equal(result.sections.length, 2);
  assert.ok(result.sections[0].sourceIds.includes('24035005-24035006'));
});

test('rechaza material sin estructura o sin extractos', () => {
  const errors = validateMaterial({ id: 'x', weekStart: '2026-09-14', weekEnd: '2026-09-20', meeting: 'midweek', title: '', url: 'https://www.jw.org', sections: [], excerpts: [], validated: false, hash: 'x' });
  assert.deepEqual(errors, ['material-not-validated', 'missing-structure', 'missing-excerpts']);
});
test('rejects untrusted or duplicate excerpts inside official material',()=>{
 const m=structuredClone(material);m.excerpts[0].url='https://example.com/fake';
 assert.ok(validateMaterial(m).includes('non-official-excerpt'));
 m.excerpts.push({...m.excerpts[0]});assert.ok(validateMaterial(m).includes('invalid-excerpt'));
});
