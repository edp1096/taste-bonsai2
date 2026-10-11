import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const cachePath = path.join(here, '.cache', 'links.json');

export function parseGoogleReply(text) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('[[')) continue;
    let frames;
    try { frames = JSON.parse(line); } catch { continue; }
    for (const frame of frames) {
      if (frame[0] !== 'wrb.fr' || frame[1] !== 'Fbv4je' || typeof frame[2] !== 'string') continue;
      const inner = JSON.parse(frame[2]);
      if (inner[0] === 'garturlres' && typeof inner[1] === 'string') {
        const url = new URL(inner[1]);
        if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.hostname !== 'news.google.com') return url.href;
      }
    }
  }
  throw new Error('Google did not return a publisher URL');
}

async function resolveGoogle(url, deadline) {
  const parsed = new URL(url);
  if (parsed.hostname !== 'news.google.com') throw new Error('Not a Google News link');
  const id = parsed.pathname.match(/\/(?:articles|read)\/([A-Za-z0-9_-]+)/)?.[1];
  if (!id) throw new Error('Invalid Google News article identifier');
  const request = async (url, options = {}) => {
    const remaining = deadline - Date.now();
    if (remaining < 100) throw new Error('Link resolution time limit reached');
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(Math.min(6000, remaining)) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Google returned HTTP ${response.status}`); }
    return response;
  };
  const page = await request(`https://news.google.com/rss/articles/${id}`);
  const html = await page.text();
  const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const timestamp = Number(html.match(/data-n-a-ts="([^"]+)"/)?.[1]);
  if (!signature || !Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error('Google article metadata is unavailable');
  const context = [['X','X',['X','X'],null,null,1,1,'US:en',null,1,null,null,null,null,null,0,1], 'X','X',1,[1,1,1],1,1,null,0,0,null,0];
  const inner = JSON.stringify(['garturlreq', context, id, timestamp, signature]);
  const payload = JSON.stringify([[['Fbv4je', inner]]]);
  const cookies = page.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ');
  const response = await request('https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je', {
    method: 'POST', headers: { 'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8',
      Origin:'https://news.google.com', Referer:'https://news.google.com/', 'X-Same-Domain':'1', ...(cookies ? {Cookie:cookies} : {}) },
    body: new URLSearchParams({'f.req':payload}).toString()
  });
  return parseGoogleReply(await response.text());
}

async function checkPublisher(url, deadline) {
  let response;
  try {
    const remaining = deadline - Date.now();
    if (remaining < 100) return { link_status: 'not_checked_time_limit', http_status: null };
    response = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(Math.min(4000, remaining)) });
    const status = response.status;
    return { link_status: response.ok ? 'reachable' : [401,403,429].includes(status) ? 'access_restricted' : 'http_error', http_status: status };
  } catch (error) { return { link_status: 'check_failed', http_status: null, check_error: error.message }; }
  finally { await response?.body?.cancel().catch(() => {}); }
}

export async function resolveArticles(articles) {
  let cache = {};
  try { cache = JSON.parse(await fs.readFile(cachePath, 'utf8')); } catch {}
  const deadline = Date.now() + 45000;
  let next = 0;
  const results = new Array(articles.length);
  async function worker() {
    while (next < articles.length) {
      const index = next++;
      const article = articles[index];
      const googleUrl = article.url;
      try {
        const cached = cache[googleUrl];
        const publisherUrl = cached && Date.now() - cached.created < 86400000 ? cached.url : await resolveGoogle(googleUrl, deadline);
        cache[googleUrl] = {url:publisherUrl, created:Date.now()};
        const checked = await checkPublisher(publisherUrl, deadline);
        results[index] = { ...article, url:publisherUrl, original_url:publisherUrl,
          url_kind:'publisher', ...checked, citation:`[${article.source || 'Source'}](${publisherUrl})` };
      } catch (error) {
        results[index] = { ...article, original_url:null, google_news_url:googleUrl,
          url_kind:'google_news_fallback', link_status:'original_unresolved', http_status:null,
          resolution_error:error.message, citation:`[Google News](${googleUrl})` };
      }
    }
  }
  await Promise.all(Array.from({length:Math.min(3, articles.length)}, worker));
  const compact = Object.fromEntries(Object.entries(cache).filter(([, entry]) => Date.now() - entry.created < 86400000).slice(-1000));
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive:true });
    const temp = cachePath + `.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(compact)); await fs.rename(temp, cachePath);
  } catch {}
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    console.log(JSON.stringify(await resolveArticles(JSON.parse(input))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
