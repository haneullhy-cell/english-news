#!/usr/bin/env node
// 넷리파이 빌드 때 실행한다(netlify.toml 의 build.command).
// src/places.js 의 장소마다 OpenStreetMap 데이터를 Overpass 에서 미리 받아 data/ 에 둔다.
// 휴대폰이 그때그때 공개 지도 서버(자주 바쁨)에 의존하지 않고 사이트에서 바로 지도를 읽게 하려는 것이다.
// 실패해도 빌드는 성공으로 끝낸다. 그 장소는 앱이 열릴 때 Overpass 에 직접 요청한다.
//   node tools/fetch-osm.mjs              모든 장소
//   node tools/fetch-osm.mjs dj_cityhall  특정 장소만
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLACES, PREBUILT_RADIUS } from '../src/places.js';
import { bboxAround, networkQuery, contextQuery, fetchOverpass, slimOsm, OVERPASS_ENDPOINTS_BUILD } from '../src/osm.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 테스트용: PREFETCH_OUT(출력 폴더), PREFETCH_ENDPOINTS(쉼표로 구분한 Overpass 주소)
const outDir = process.env.PREFETCH_OUT || path.join(root, 'data');
const ENDPOINTS = process.env.PREFETCH_ENDPOINTS ? process.env.PREFETCH_ENDPOINTS.split(',') : OVERPASS_ENDPOINTS_BUILD;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEADLINE = Date.now() + 9 * 60 * 1000; // 넷리파이 빌드 시간 안에서 끝낸다
const HEADERS = { 'User-Agent': 'chorokbul-navi/1.0 (+https://chorokbul-navi.netlify.app) build prefetch' };
// 이미 배포된 사이트의 지도가 이만큼 새것이면 Overpass 에 다시 묻지 않고 그대로 쓴다(넷리파이가 URL 을 넣어 준다).
const SITE = (process.env.PREFETCH_SITE || process.env.URL || '').replace(/\/+$/, '');
const MAX_AGE_MS = 14 * 24 * 3600 * 1000;
const FORCE = !!process.env.PREFETCH_FORCE;

async function getJson(url) {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
let deployed = null;
if (SITE && !FORCE) {
  try { deployed = await getJson(`${SITE}/data/index.json`); console.log(`배포된 사이트(${SITE})의 지도 목록을 읽었습니다.`); }
  catch (e) { console.log(`배포된 사이트의 지도 목록이 없습니다 (${e.message}).`); }
}
async function reuseDeployed(key) {
  const prev = deployed && deployed.places && deployed.places[key];
  if (!prev || prev.radius !== PREBUILT_RADIUS || !(Date.now() - Date.parse(prev.fetchedAt) < MAX_AGE_MS)) return null;
  const net = await getJson(`${SITE}/data/${key}.network.json`);
  if (!net || !Array.isArray(net.elements) || net.elements.length < 20) return null;
  fs.writeFileSync(path.join(outDir, `${key}.network.json`), JSON.stringify(net));
  if (prev.context > 0) {
    try { fs.writeFileSync(path.join(outDir, `${key}.context.json`), JSON.stringify(await getJson(`${SITE}/data/${key}.context.json`))); } catch { /* 건물은 없어도 된다 */ }
  }
  return prev;
}

async function fetchWithRetry(query, label) {
  let last = null;
  for (let attempt = 1; attempt <= 3 && Date.now() < DEADLINE; attempt++) {
    try {
      return await fetchOverpass(query, { endpoints: ENDPOINTS, timeoutMs: 90000, headers: HEADERS });
    } catch (e) {
      last = e;
      console.log(`  ${label} ${attempt}번째 실패: ${e.message}`);
      await sleep((Number(process.env.PREFETCH_RETRY_MS) || 5000) * attempt);
    }
  }
  throw last || new Error('시간이 모자랍니다');
}

fs.mkdirSync(outDir, { recursive: true });
const only = process.argv.slice(2);
const indexPath = path.join(outDir, 'index.json');
let index = { places: {} };
try { index = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch { /* 처음 */ }
index.radius = PREBUILT_RADIUS;
index.places = index.places || {};
let ok = 0, fail = 0;
for (const [key, pl] of Object.entries(PLACES)) {
  if (only.length && !only.includes(key)) continue;
  if (Date.now() > DEADLINE) { console.log(`${key}: 시간이 모자라 건너뜀`); fail++; continue; }
  const bbox = bboxAround(pl.lat, pl.lon, PREBUILT_RADIUS);
  const t0 = Date.now();
  try {
    const reused = await reuseDeployed(key);
    if (reused) { index.places[key] = reused; ok++; console.log(`${key}: 배포된 사이트의 지도를 다시 씀 (${reused.fetchedAt.slice(0, 10)} 기준)`); continue; }
  } catch (e) { console.log(`  ${key}: 배포된 지도를 다시 쓰지 못함 (${e.message}), 새로 받습니다`); }
  try {
    const net = slimOsm(await fetchWithRetry(networkQuery(bbox), `${key} 길`), 'network');
    if (net.elements.length < 20) throw new Error(`요소가 너무 적습니다(${net.elements.length})`);
    const netFile = path.join(outDir, `${key}.network.json`);
    fs.writeFileSync(netFile, JSON.stringify(net));
    let ctxCount = 0, ctxBytes = 0;
    try {
      const ctx = slimOsm(await fetchWithRetry(contextQuery(bbox), `${key} 건물`), 'context');
      const ctxFile = path.join(outDir, `${key}.context.json`);
      fs.writeFileSync(ctxFile, JSON.stringify(ctx));
      ctxCount = ctx.elements.length; ctxBytes = fs.statSync(ctxFile).size;
    } catch (e) { console.log(`  ${key} 건물: 건너뜀 (${e.message})`); }
    index.places[key] = { name: pl.name, lat: pl.lat, lon: pl.lon, radius: PREBUILT_RADIUS, network: net.elements.length, networkBytes: fs.statSync(netFile).size, context: ctxCount, contextBytes: ctxBytes, fetchedAt: new Date().toISOString() };
    ok++;
    console.log(`${key}: 길·노드 ${net.elements.length}개, 건물 ${ctxCount}개 (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
  } catch (e) {
    fail++;
    console.log(`${key}: 실패, 앱이 열릴 때 직접 받습니다 (${e.message})`);
  }
  await sleep(Number(process.env.PREFETCH_PAUSE_MS) || 1500);
}
index.fetchedAt = new Date().toISOString();
fs.writeFileSync(indexPath, JSON.stringify(index, null, 1));
console.log(`미리 받기 완료: 성공 ${ok}, 실패 ${fail}`);
