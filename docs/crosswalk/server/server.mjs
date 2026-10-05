#!/usr/bin/env node
// 초록불 내비 서버: 정적 파일 + 서울 T-Data 신호 잔여시간 프록시.
//   실제 데이터: TDATA_API_KEY=발급키 node server/server.mjs
//   모의 데이터: node server/server.mjs --mock   (키 없이 실시간 연결 흐름을 확인)
// 환경변수: PORT(기본 8787), TDATA_ENDPOINT, TDATA_REMAIN_DIVISOR(기본 10: 1/10초 단위)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemo } from '../src/network.js';
import { legState } from '../src/signal.js';
import { normalizeRecord, findRecords, remapLegs } from './tdata.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const PORT = Number(process.env.PORT || 8787);
const API_KEY = process.env.TDATA_API_KEY || '';
const ENDPOINT = process.env.TDATA_ENDPOINT || 'https://t-data.seoul.go.kr/apig/apiman-gateway/tapi/v2xSignalPhaseTimingFusionInformation/1.0';
const DIVISOR = Number(process.env.TDATA_REMAIN_DIVISOR || 10);
const MOCK = process.argv.includes('--mock');
const MOCK_SHIFT = 37; // 모의 데이터는 앱의 시뮬레이션과 다른 옵셋을 써서 '실시간 반영'이 눈에 보이게 한다.

const cfg = JSON.parse(fs.readFileSync(path.join(here, 'intersections.json'), 'utf8'));
const mapping = Object.entries(cfg.intersections).filter(([, m]) => m.itstId);
const graph = buildDemo();
const mode = MOCK ? 'mock' : API_KEY ? 'live' : 'nokey';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2' };

let cache = { t: 0, body: null };

async function fetchOne(demoId, m) {
  const url = new URL(ENDPOINT);
  url.searchParams.set('apiKey', API_KEY);
  url.searchParams.set('itstId', m.itstId);
  url.searchParams.set('type', 'json');
  url.searchParams.set('pageNo', '1');
  url.searchParams.set('numOfRows', '1');
  const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const recs = findRecords(await r.json());
  if (!recs.length) throw new Error('응답에 교차로 기록이 없습니다');
  const n = normalizeRecord(recs[0], DIVISOR);
  return { itstId: m.itstId, ts: n.ts, legs: remapLegs(n.legs, m.legMap) };
}

async function liveData() {
  if (cache.body && Date.now() - cache.t < 1000) return cache.body;
  const out = { ts: Date.now() / 1000, mode: 'live', intersections: {} };
  await Promise.all(mapping.map(async ([demoId, m]) => {
    try { out.intersections[demoId] = await fetchOne(demoId, m); }
    catch (e) { out.intersections[demoId] = { itstId: m.itstId, error: String(e.message || e) }; }
  }));
  cache = { t: Date.now(), body: out };
  return out;
}

function mockData() {
  const t = Date.now() / 1000;
  const out = { ts: t, mode: 'mock', intersections: {} };
  for (const it of graph.intersections.values()) {
    const legs = {};
    for (const leg of Object.keys(it.legs)) {
      const s = legState(it.plan, leg, t + MOCK_SHIFT);
      legs[leg] = { state: s.state, remain: Math.round(s.remain * 10) / 10 };
    }
    out.intersections[it.id] = { itstId: 'mock', ts: t, legs };
  }
  return out;
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function serveStatic(req, res, pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) return send(res, 403, { error: 'forbidden' });
  fs.stat(file, (err, st) => {
    const target = !err && st.isDirectory() ? path.join(file, 'index.html') : file;
    fs.readFile(target, (e2, buf) => {
      if (e2) return send(res, 404, { error: 'not found' });
      send(res, 200, buf, TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream');
    });
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (pathname === '/api/health') return send(res, 200, { ok: true, mode, intersections: MOCK ? graph.intersections.size : mapping.length, endpoint: MOCK ? null : ENDPOINT });
  if (pathname === '/api/signals') {
    if (MOCK) return send(res, 200, mockData());
    if (!API_KEY) return send(res, 503, { error: 'TDATA_API_KEY 환경변수가 없습니다. --mock 으로 실행하거나 키를 넣어주세요.' });
    if (!mapping.length) return send(res, 503, { error: 'server/intersections.json 에 itstId 가 채워진 교차로가 없습니다.' });
    try { return send(res, 200, await liveData()); } catch (e) { return send(res, 502, { error: String(e.message || e) }); }
  }
  if (pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
  return serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`초록불 내비 서버  http://localhost:${PORT}  (mode: ${mode}${MOCK ? '' : `, 교차로 ${mapping.length}곳`})`);
  if (mode === 'nokey') console.log('실시간 신호를 받으려면 TDATA_API_KEY 를 설정하세요. 모의 데이터는 --mock 옵션으로 켤 수 있습니다.');
});
