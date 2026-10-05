// 대전 시청역 주변 실제 OpenStreetMap 데이터(2026-10-05 Overpass, ODbL)를 Overpass JSON(out body geom) 형태로 묶는다.
// 원본: cityhall-ways.txt (way id | node ids | tags), cityhall-coords.txt (node id | lat | lon), cityhall-tagged-nodes.txt
import fs from 'node:fs';
const here = new URL('.', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, here), 'utf8').trim().split('\n').filter(Boolean);
const parseTags = (s) => Object.fromEntries((s || '').split(';').filter(Boolean).map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
const coords = new Map();
for (const line of read('cityhall-coords.txt')) { const [id, lat, lon] = line.split('|'); coords.set(Number(id), { lat: Number(lat), lon: Number(lon) }); }
const tagged = [];
for (const line of read('cityhall-tagged-nodes.txt')) {
  const [id, lat, lon, tags] = line.split('|');
  const c = { lat: Number(lat), lon: Number(lon) };
  const old = coords.get(Number(id));
  if (old && (Math.abs(old.lat - c.lat) > 1e-7 || Math.abs(old.lon - c.lon) > 1e-7)) throw new Error(`좌표 불일치 ${id}`);
  coords.set(Number(id), c);
  tagged.push({ type: 'node', id: Number(id), ...c, tags: parseTags(tags) });
}
const ways = read('cityhall-ways.txt').map((line) => {
  const [id, nodes, tags] = line.split('|');
  const ids = nodes.split(',').map(Number);
  for (const n of ids) if (!coords.has(n)) throw new Error(`좌표 없음 ${n} (way ${id})`);
  return { type: 'way', id: Number(id), nodes: ids, geometry: ids.map((n) => coords.get(n)), tags: parseTags(tags) };
});
const out = { version: 0.6, generator: 'Overpass API (maps.mail.ru, overpass-api.de) 2026-10-05', osm3s: { copyright: 'The data included in this document is from www.openstreetmap.org. The data is made available under ODbL.' }, elements: [...tagged, ...ways] };
fs.writeFileSync(new URL('../daejeon-cityhall.json', here), JSON.stringify(out));
console.log(`daejeon-cityhall.json: 노드 ${tagged.length}개(태그), 길 ${ways.length}개, 좌표 ${coords.size}개`);
