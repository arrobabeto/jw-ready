import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import { OFFICIAL_HOSTS, type SourceExcerpt, type WeeklyMaterial } from './types.js';

export const fetchText = async (url: string, redirects=0): Promise<string> => {
  const parsed = new URL(url);
  if (parsed.protocol!=='https:' || parsed.username || parsed.password || !OFFICIAL_HOSTS.has(parsed.hostname)) throw new Error('Non-official source blocked');
  const response = await fetch(url, { redirect:'manual',signal:AbortSignal.timeout(20000), headers: { 'user-agent': 'JW-Ready personal study bot/0.1' } });
  if(response.status>=300 && response.status<400) { if(redirects>=4 || !response.headers.get('location')) throw new Error('Invalid redirect'); return fetchText(new URL(response.headers.get('location')!,url).href,redirects+1); }
  if (!response.ok) throw new Error(`Source returned ${response.status}: ${url}`);
  return response.text();
};

function hash(input: string) { return crypto.createHash('sha256').update(input).digest('hex'); }
function canonical(base: string, href: string) { return new URL(href, base).toString(); }

export function parseOfficialPage(url: string, html: string): { title: string; excerpts: SourceExcerpt[]; sections: WeeklyMaterial['sections'] } {
  const $ = cheerio.load(html);
  const title = $('meta[property="og:title"]').attr('content') || $('h1').first().text().trim() || $('title').text().trim();
  if (!title) throw new Error('Official page has no title');
  const excerpts: SourceExcerpt[] = [];
  const sections: WeeklyMaterial['sections'] = [];
  $('.bodyTxt h3, .bodyTxt h2').each((_, heading) => {
    const headingText = $(heading).text().replace(/\s+/g, ' ').trim();
    if (!headingText) return;
    const sourceIds: string[] = [];
    const textParts: string[] = [];
    let node = $(heading).next();
    for (let i = 0; i < 12 && node.length; i++, node = node.next()) {
      if (node.is('h2, h3')) break;
      const text = node.text().replace(/\s+/g, ' ').trim();
      if (text) textParts.push(text);
      node.find('[data-pid], a.jsBibleLink, a.pub-it, a.pub-w').each((__, el) => {
        const pid = $(el).attr('data-pid') ?? $(el).attr('data-targetverses') ?? $(el).attr('data-page-id');
        if (pid) sourceIds.push(pid);
      });
    }
    const text = textParts.join(' ').slice(0, 4000);
    if (text) sections.push({ title: headingText, text, sourceIds: [...new Set(sourceIds)] });
  });
  $('p[data-pid], p[id^="p"]').each((_, el) => {
    const id = $(el).attr('data-pid') ?? $(el).attr('id');
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (id && text) excerpts.push({ id: `${hash(url)}:${id}`, url, title, text: text.slice(0, 1800), anchor: '#' + ($(el).attr('id') || 'p'+id), host: new URL(url).hostname });
  });
  return { title, excerpts, sections };
}

export function validateMaterial(material: WeeklyMaterial): string[] {
  const errors: string[] = [];
  if (!material.validated) errors.push('material-not-validated');
  try { const u=new URL(material.url); if(u.protocol!=='https:'||!OFFICIAL_HOSTS.has(u.hostname)) errors.push('non-official-url'); } catch {errors.push('non-official-url');}
  if (!material.title || material.sections.length === 0) errors.push('missing-structure');
  if (material.excerpts.length === 0) errors.push('missing-excerpts');
  const ids=new Set<string>();
  for(const excerpt of material.excerpts) {
    try {const u=new URL(excerpt.url);if(u.protocol!=='https:'||u.username||u.password||!OFFICIAL_HOSTS.has(u.hostname)||u.hostname!==excerpt.host) errors.push('non-official-excerpt');}
    catch {errors.push('non-official-excerpt');}
    if(!excerpt.id||ids.has(excerpt.id)||!excerpt.text.trim()) errors.push('invalid-excerpt');
    ids.add(excerpt.id);
  }
  return errors;
}

export async function ingestOfficialPage(url: string, weekStart: string, weekEnd: string, meeting: 'midweek' | 'weekend'): Promise<WeeklyMaterial> {
  const html = await fetchText(url);
  const parsed = parseOfficialPage(url, html);
  const material: WeeklyMaterial = { id: `${meeting}:${weekStart}`, weekStart, weekEnd, meeting, title: parsed.title, url, sections: parsed.sections, excerpts: parsed.excerpts, validated: true, hash: hash(html) };
  const errors = validateMaterial(material);
  if (errors.length) throw new Error(`Material validation failed: ${errors.join(', ')}`);
  return material;
}

/** On-demand, bounded research. Failed references are omitted, never invented. */
export async function deepenMaterial(material:WeeklyMaterial):Promise<WeeklyMaterial> {
  const queue:Array<{url:string;depth:number}>=[{url:material.url,depth:0}],seen=new Set<string>(),extra:SourceExcerpt[]=[];
  while(queue.length&&seen.size<6) {
    const item=queue.shift()!,base=item.url.split('#')[0]; if(seen.has(base)) continue;seen.add(base);
    try {
      const html=await fetchText(base);
      if(item.depth>0) extra.push(...parseOfficialPage(base,html).excerpts.slice(0,24));
      if(item.depth>=2) continue;
      const $=cheerio.load(html);
      $('.bodyTxt a[href]').each((_,el)=>{
        if(queue.length>=12) return;
        try {const u=new URL($(el).attr('href')!,base);if(u.protocol==='https:'&&OFFICIAL_HOSTS.has(u.hostname)&&(/\/wol\/d\/|\/biblia\/|\/libros\/|\/revistas\//.test(u.pathname)))queue.push({url:u.href,depth:item.depth+1});}catch{}
      });
    }catch{/* source unavailable */}
  }
  return {...material,excerpts:[...material.excerpts,...extra]};
}

export function extractLinkedOfficialUrls(baseUrl: string, html: string): string[] {
  const $ = cheerio.load(html); const urls = new Set<string>();
  $('a[href]').each((_, el) => { try { const u = new URL(canonical(baseUrl, $(el).attr('href')!)); if (OFFICIAL_HOSTS.has(u.hostname)) urls.add(u.toString()); } catch {} });
  return [...urls];
}
