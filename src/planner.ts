import { ingestOfficialPage,fetchText } from './sources.js';
import {weekStart} from './schedule.js';
import type { Store } from './store.js';

const meetingIndex = (year: number, isoWeek: number) => `https://wol.jw.org/es/wol/meetings/r4/lp-s/${year}/${isoWeek}`;
function isoWeek(date: Date) { const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day); const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7); }
function monday(date: Date) { const d = new Date(date); const day = d.getDay() || 7; d.setDate(d.getDate() - day + 1); d.setHours(0,0,0,0); return d; }

export async function discoverCurrentWeek(store: Store, date = new Date()) {
  const start = new Date(weekStart(date)+'T12:00:00Z'); const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
  const thursday=new Date(start);thursday.setUTCDate(start.getUTCDate()+3);
  const url = meetingIndex(thursday.getUTCFullYear(), isoWeek(start));
  const html = await fetchText(url);
  const blockLink = (heading: string) => {
    const block = html.match(new RegExp(`<h2>${heading}[\\s\\S]*?<a[^>]+href=["']([^"']+)["']`, 'i'));
    return block ? new URL(block[1], url).toString() : undefined;
  };
  const midweek = blockLink('Vida y Ministerio');
  const weekend = blockLink('Estudio de La Atalaya');
  const results = [];
  if (midweek) results.push(await ingestOfficialPage(midweek, start.toISOString().slice(0,10), end.toISOString().slice(0,10), 'midweek'));
  if (weekend) results.push(await ingestOfficialPage(weekend, start.toISOString().slice(0,10), end.toISOString().slice(0,10), 'weekend'));
  if (results.length < 2) throw new Error(`Could not discover both meetings from ${url}`);
  for (const material of results) await store.saveMaterial(material);
  return results;
}
