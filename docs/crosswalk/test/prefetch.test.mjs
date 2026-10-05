import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fetchOverpass, slimOsm, buildOsmWorld } from '../src/osm.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dj = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'daejeon-cityhall.json'), 'utf8'));
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('fetchOverpass: 모두 504면 busy, 서버별 이유를 모은다', async () => {
  await assert.rejects(
    fetchOverpass('q', { endpoints: ['https://a.example/x', 'https://b.example/x'], fetchImpl: async () => resp(504, {}) }),
    (e) => e.kind === 'busy' && e.details.length === 2 && /a\.example: HTTP 504 · b\.example: HTTP 504/.test(e.message));
});

test('fetchOverpass: 요청 자체가 막히면 blocked', async () => {
  await assert.rejects(
    fetchOverpass('q', { endpoints: ['https://a.example/x'], fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }),
    (e) => e.kind === 'blocked');
});

test('fetchOverpass: 200 이어도 runtime error remark 면 다음 서버로', async () => {
  let n = 0;
  const r = await fetchOverpass('q', {
    endpoints: ['https://a.example/x', 'https://b.example/x'],
    fetchImpl: async () => (++n === 1 ? resp(200, { elements: [{ type: 'node', id: 1 }], remark: 'runtime error: Query timed out in "query" at line 3 after 61 seconds.' }) : resp(200, { elements: [] })),
  });
  assert.equal(n, 2);
  assert.deepEqual(r.elements, []);
});

test('fetchOverpass: 시간 초과도 busy 로 분류한다', async () => {
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  await assert.rejects(fetchOverpass('q', { endpoints: ['https://a.example/x'], fetchImpl: hang, timeoutMs: 30 }), (e) => e.kind === 'busy' && /응답 없음/.test(e.message));
});

test('slimOsm: 앱이 쓰는 태그만 남기고, 결과로 같은 그래프가 나온다', () => {
  const slim = slimOsm(dj, 'network');
  const before = JSON.stringify(dj).length, after = JSON.stringify(slim).length;
  assert.ok(after < before, `${before} -> ${after}`);
  const way = slim.elements.find((e) => e.type === 'way' && e.tags.name === '둔산로');
  assert.equal(way.tags['name:en'], undefined);
  assert.equal(way.tags.smoothness, undefined);
  const crossing = slim.elements.find((e) => e.type === 'node' && e.tags && e.tags['traffic_signals:countdown']);
  assert.equal(crossing.tags.button_operated, 'yes');
  const opts = { center: { lat: 36.351406, lon: 127.3867 } };
  assert.deepEqual(buildOsmWorld(slim, null, opts).stats, buildOsmWorld(dj, null, opts).stats);
});

test('tools/fetch-osm.mjs: 받은 지도를 줄여 data/ 에 쓰고, 실패한 장소는 건너뛴다', async () => {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const q = decodeURIComponent(body.replace(/^data=/, '').replace(/\+/g, ' '));
      const daejeon = /\[bbox:36\./.test(q);
      if (!daejeon) { res.writeHead(504); res.end('busy'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(/way\[building\]/.test(q) ? { elements: [] } : dj));
    });
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'prefetch-'));
  const log = await new Promise((resolve, reject) => execFile(process.execPath, [path.join(here, '..', 'tools', 'fetch-osm.mjs'), 'dj_cityhall', 'gangnam'], {
    env: { ...process.env, PREFETCH_OUT: out, PREFETCH_ENDPOINTS: `http://127.0.0.1:${port}/api/interpreter`, PREFETCH_RETRY_MS: '1', PREFETCH_PAUSE_MS: '1' },
  }, (err, stdout) => (err ? reject(err) : resolve(stdout))));
  server.close();
  assert.match(log, /dj_cityhall: 길·노드 \d+개/);
  assert.match(log, /gangnam: 실패/);
  assert.match(log, /성공 1, 실패 1/);
  const net = JSON.parse(fs.readFileSync(path.join(out, 'dj_cityhall.network.json'), 'utf8'));
  assert.equal(net.generator, 'chorokbul-navi slimOsm');
  assert.ok(!fs.existsSync(path.join(out, 'gangnam.network.json')));
  const index = JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8'));
  assert.equal(index.radius, 700);
  assert.ok(index.places.dj_cityhall.network >= 20);
});

test('좌표가 아주 많아도 범위 계산이 터지지 않는다', () => {
  const N = 200000;
  const nodes = Array.from({ length: N }, (_, i) => 1e9 + i);
  const geometry = nodes.map((_, i) => ({ lat: 36.35 + (i % 1000) * 1e-6, lon: 127.38 + Math.floor(i / 1000) * 1e-6 }));
  const g = buildOsmWorld({ elements: [{ type: 'way', id: 1, nodes, geometry, tags: { highway: 'footway' } }] }, null, { center: { lat: 36.35, lon: 127.38 } });
  assert.ok(Number.isFinite(g.bounds.minX) && g.bounds.maxX > g.bounds.minX);
});
