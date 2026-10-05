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

test('tools/fetch-osm.mjs: 배포된 사이트에 2주 안의 지도가 있으면 Overpass 에 묻지 않고 다시 쓴다', async () => {
  const slim = slimOsm(dj, 'network');
  let overpassCalls = 0;
  const site = http.createServer((req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/data/index.json') return send(200, { radius: 700, places: {
      dj_cityhall: { name: '대전 시청역·둔산 주변', radius: 700, network: slim.elements.length, context: 0, fetchedAt: new Date().toISOString() },
      dj_station: { name: '대전역 주변', radius: 700, network: 999, context: 0, fetchedAt: '2020-01-01T00:00:00Z' },
    } });
    if (req.url === '/data/dj_cityhall.network.json') return send(200, slim);
    if (req.method === 'POST') { overpassCalls++; return send(200, dj); }
    send(404, {});
  });
  await new Promise((r) => site.listen(0, r));
  const base = `http://127.0.0.1:${site.address().port}`;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'prefetch-reuse-'));
  const log = await new Promise((resolve, reject) => execFile(process.execPath, [path.join(here, '..', 'tools', 'fetch-osm.mjs'), 'dj_cityhall', 'dj_station'], {
    env: { ...process.env, PREFETCH_OUT: out, PREFETCH_SITE: base, PREFETCH_ENDPOINTS: `${base}/api/interpreter`, PREFETCH_RETRY_MS: '1', PREFETCH_PAUSE_MS: '1' },
  }, (err, stdout) => (err ? reject(err) : resolve(stdout))));
  site.close();
  assert.match(log, /dj_cityhall: 배포된 사이트의 지도를 다시 씀/);
  assert.match(log, /dj_station: 길·노드 \d+개/);          // 오래된 지도는 새로 받는다
  assert.equal(overpassCalls, 2);                          // dj_station 의 길·건물 두 번뿐
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'dj_cityhall.network.json'), 'utf8')), slim);
});

test('placeCovering: 좌표가 미리 받아 둔 장소 범위 안이면 그 장소', async () => {
  const { placeCovering, PLACES } = await import('../src/places.js');
  const c = PLACES.dj_cityhall;
  assert.equal(placeCovering(c.lat, c.lon), 'dj_cityhall');
  assert.equal(placeCovering(c.lat + 0.002, c.lon), 'dj_cityhall');           // 북쪽 약 220 m
  assert.equal(placeCovering(c.lat + 0.006, c.lon, ['dj_cityhall']), null);    // 약 660 m: 가장자리 여유 밖
  assert.equal(placeCovering(c.lat, c.lon, ['dj_station']), null);            // 준비된 목록에 없으면
  assert.equal(placeCovering(37.0, 127.0), null);
  // 시청역과 정부청사역 사이(둘 다 범위 안)면 더 가까운 쪽
  const m = PLACES.dj_complex;
  assert.equal(placeCovering(m.lat - 0.0005, m.lon), 'dj_complex');
});
