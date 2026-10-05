// 강남 일대의 OSM 태깅 방식을 흉내 낸 합성 데이터. 실제 Overpass 응답과 같은 형태(out body geom)로 만든다.
// 구성: 큰길(primary, 상하행 분리) × 세로길(secondary) 사거리 + 보도·횡단보도, 노드로만 표시된 중간 횡단보도,
// 비신호 횡단보도, 끊긴 보도, 지하보도, 계단, 건물·공원, 지하철 출입구.
import { makeProjection } from '../../src/geo.js';

export function makeFixture() {
  const proj = makeProjection(37.5, 127.03);
  let next = 1000;
  const nodes = new Map();
  const ways = [];
  const key = (x, y) => `${x},${y}`;
  const byPos = new Map();
  const N = (x, y, tags) => {
    const k = key(x, y);
    if (byPos.has(k)) { const id = byPos.get(k); if (tags) nodes.get(id).tags = { ...(nodes.get(id).tags || {}), ...tags }; return id; }
    const id = next++; nodes.set(id, { x, y, tags }); byPos.set(k, id); return id;
  };
  const W = (pts, tags) => { const id = next++; ways.push({ id, nodes: pts.map(([x, y]) => N(x, y)), tags }); return id; };

  const xs = [-400, -250, -30, 0, 30, 250, 400];
  W(xs.map((x) => [x, 10]), { highway: 'primary', name: '큰길', oneway: 'yes', lanes: '4' });
  W(xs.map((x) => [x, -10]), { highway: 'primary', name: '큰길', oneway: 'yes', lanes: '4' });
  W([-400, -250, -30, -10, 10, 30, 250, 400].map((y) => [0, y]), { highway: 'secondary', name: '세로길', lanes: '3' });
  N(0, 10, { junction: 'yes', name: '테스트사거리', highway: 'traffic_signals' });
  // 큰길 양측 보도
  W([[-400, 22], [-250, 22], [-200, 22], [-30, 22], [-12, 22]], { highway: 'footway', footway: 'sidewalk' });
  W([[12, 22], [30, 22], [140, 22], [150, 22], [160, 22], [250, 22], [300, 22], [400, 22]], { highway: 'footway', footway: 'sidewalk' });
  W([[-400, -22], [-250, -22], [-30, -22], [-12, -22]], { highway: 'footway', footway: 'sidewalk' });
  W([[12, -22], [30, -22], [250, -22], [400, -22]], { highway: 'footway', footway: 'sidewalk' });
  // 세로길 양측 보도 (동측 북쪽 끝은 계단)
  W([[-12, 22], [-12, 30], [-12, 250], [-12, 300]], { highway: 'footway', footway: 'sidewalk' });
  W([[-12, -22], [-12, -30], [-12, -250], [-12, -300]], { highway: 'footway', footway: 'sidewalk' });
  W([[12, 22], [12, 30], [12, 250]], { highway: 'footway', footway: 'sidewalk' });
  W([[12, 250], [12, 300]], { highway: 'steps' });
  W([[12, -22], [12, -30], [12, -250], [12, -300]], { highway: 'footway', footway: 'sidewalk' });
  // 사거리 횡단보도 4개
  W([[-12, 30], [0, 30], [12, 30]], { highway: 'footway', footway: 'crossing', crossing: 'traffic_signals' });
  W([[-12, -30], [0, -30], [12, -30]], { highway: 'footway', footway: 'crossing', crossing: 'traffic_signals' });
  W([[30, 22], [30, 10], [30, -10], [30, -22]], { highway: 'footway', footway: 'crossing' });
  N(30, 10, { highway: 'crossing', crossing: 'traffic_signals' });
  N(30, -10, { highway: 'crossing', crossing: 'traffic_signals' });
  W([[-30, 22], [-30, 10], [-30, -10], [-30, -22]], { highway: 'footway', footway: 'crossing', crossing: 'traffic_signals', 'crossing:island': 'no' });
  // 노드로만 표시된 중간 횡단보도(두 차도에 하나씩)
  N(250, 10, { highway: 'crossing', crossing: 'traffic_signals' });
  N(250, -10, { highway: 'crossing', crossing: 'traffic_signals' });
  // 뒷골목과 비신호 횡단보도
  W([[150, 22], [150, 100], [150, 300]], { highway: 'residential', name: '뒷골목' });
  W([[140, 22], [140, 100]], { highway: 'footway', footway: 'sidewalk' });
  W([[160, 22], [160, 100]], { highway: 'footway', footway: 'sidewalk' });
  W([[140, 100], [150, 100], [160, 100]], { highway: 'footway', footway: 'crossing', crossing: 'marked' });
  // 끊긴 보도(끝이 윗골목에서 6m 떨어짐)와 윗골목
  W([[-200, 22], [-200, 60]], { highway: 'footway', footway: 'sidewalk' });
  W([[-300, 66], [-100, 66]], { highway: 'residential', name: '윗골목' });
  // 지하보도
  W([[-250, 22], [-250, 0], [-250, -22]], { highway: 'footway', tunnel: 'yes', layer: '-1' });
  // 걷지 못하는 길(자전거 전용)과 사유지
  W([[300, 22], [300, 120]], { highway: 'cycleway', foot: 'no' });
  W([[400, 22], [400, 120]], { highway: 'service', access: 'private' });
  // 지하철
  N(20, 40, { railway: 'subway_entrance', description: '테스트역 1번 출구', ref: '1' });
  N(-250, -40, { railway: 'subway_entrance', ref: '2' });
  N(0, 60, { railway: 'station', station: 'subway', name: '테스트역' });
  // 건물과 공원 (context)
  const ctxWays = [];
  const C = (pts, tags) => { const id = next++; ctxWays.push({ id, pts, tags }); };
  C([[100, 60], [140, 60], [140, 100], [100, 100], [100, 60]], { building: 'yes', name: '테스트빌딩' });
  C([[-140, -100], [-100, -100], [-100, -60], [-140, -60], [-140, -100]], { building: 'apartments' });
  C([[200, 100], [300, 100], [300, 200], [200, 200], [200, 100]], { leisure: 'park', name: '테스트공원' });

  const ll = (x, y) => { const p = proj.toLatLon(x, y); return { lat: +p.lat.toFixed(7), lon: +p.lon.toFixed(7) }; };
  const elements = [];
  for (const [id, n] of nodes) if (n.tags) elements.push({ type: 'node', id, ...ll(n.x, n.y), tags: n.tags });
  for (const w of ways) elements.push({ type: 'way', id: w.id, nodes: w.nodes, geometry: w.nodes.map((id) => ll(nodes.get(id).x, nodes.get(id).y)), tags: w.tags });
  const network = { version: 0.6, generator: 'fixture', elements };
  const context = { version: 0.6, generator: 'fixture', elements: ctxWays.map((w) => ({ type: 'way', id: w.id, nodes: w.pts.map(() => next++), geometry: w.pts.map(([x, y]) => ll(x, y)), tags: w.tags })) };
  return { network, context, center: { lat: 37.5, lon: 127.03 }, nodeAt: (x, y) => byPos.get(key(x, y)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import('node:fs');
  const { network, context } = makeFixture();
  fs.writeFileSync(new URL('./osm-sample.json', import.meta.url), JSON.stringify({ network, context }));
  console.log('osm-sample.json written', network.elements.length, 'network elements,', context.elements.length, 'context elements');
}
