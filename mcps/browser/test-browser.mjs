import http from 'node:http';
import assert from 'node:assert/strict';
import { fetchPage } from './browser-mcp.mjs';

const server = http.createServer((req, res) => {
  if (req.url === '/301') { res.writeHead(301, { Location: '/302' }); res.end(); return; }
  if (req.url === '/302') { res.writeHead(302, { Location: '/javascript' }); res.end(); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.url === '/javascript') { res.end('<script>setTimeout(()=>location.replace("/content"),300)</script>Redirecting'); return; }
  res.end(`<!doctype html><html><head><title>Lazy loading test</title></head><body><main><div style="height:1500px">Initial content</div></main><script>
    let count=0, pending=false;
    setTimeout(()=>{const p=document.createElement('p');p.id='ready';p.textContent='Delayed JavaScript content';document.querySelector('main').append(p);},1200);
    addEventListener('scroll',()=>{if(pending || count>=2 || scrollY+innerHeight<document.documentElement.scrollHeight-120)return;
      pending=true;setTimeout(()=>{count++;const section=document.createElement('section');section.style.height='1100px';section.textContent='Lazy section '+count;document.querySelector('main').append(section);pending=false;},350);
    });
  </script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const url = `http://127.0.0.1:${server.address().port}/301`;
  await assert.rejects(fetchPage({ url }), /ports|Private/);
  const result = await fetchPage({ url, wait_for_selector: '#ready', scroll_steps: 20, timeout_seconds: 40 }, { allowLocal: true });
  assert.match(result.final_url, /\/content$/);
  assert.equal(result.title, 'Lazy loading test');
  assert.match(result.text, /Delayed JavaScript content/);
  assert.match(result.text, /Lazy section 1/);
  assert.match(result.text, /Lazy section 2/);
  assert.ok(result.navigation_chain.some(hop => hop.status === 301));
  assert.ok(result.navigation_chain.some(hop => hop.status === 302));
  assert.equal(result.selector_found, true);
  assert.equal(result.stop_reason, 'bottom_stable');
  assert.equal(result.timed_out, false);
  console.log(JSON.stringify({ passed: true, ...result }, null, 2));
} finally { await new Promise(resolve => server.close(resolve)); }
