// 서울 T-Data '신호제어기 신호 잔여시간 정보서비스' 응답을 앱이 쓰는 형태로 바꾼다.
// 응답 필드: itstId, trsmUtcTime, {nt,et,st,wt,ne,se,sw,nw}PdsgRmdrCs(보행신호 잔여, 1/10초), {..}PdsgStatNm(보행신호 상태)
export const DIRS = ['nt', 'et', 'st', 'wt', 'ne', 'se', 'sw', 'nw'];

// 상태 문자열을 green / flash / red / unknown 으로 정리한다.
// SAE J2735(SPaT) 이름("protected-Movement-Allowed", "stop-And-Remain", "protected-clearance")과 한글 표기를 모두 받는다.
export function mapState(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s || s.includes('unavail') || s.includes('dark')) return 'unknown';
  if (s.includes('clearance') || s.includes('점멸') || s.includes('flash')) return 'flash';
  if (s.includes('allowed') || s.includes('녹') || s.includes('green') || s.includes('walk') || s.includes('pre-movement')) return 'green';
  if (s.includes('stop') || s.includes('적') || s.includes('red') || s.includes('caution')) return 'red';
  return 'unknown';
}

export function parseTs(rec) {
  const v = rec.trsmUtcTime;
  if (typeof v === 'string' && /^\d{14}$/.test(v)) {
    const d = new Date(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(8, 10)}:${v.slice(10, 12)}:${v.slice(12, 14)}Z`);
    return d.getTime() / 1000;
  }
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n > 1e12 ? n / 1000 : n > 1e9 ? n : null;
  return null;
}

export function normalizeRecord(rec, divisor = 10) {
  const legs = {};
  for (const dir of DIRS) {
    const r = rec[`${dir}PdsgRmdrCs`];
    const s = rec[`${dir}PdsgStatNm`];
    if ((r === undefined || r === null || r === '') && (s === undefined || s === null || s === '')) continue;
    const remain = r === undefined || r === null || r === '' ? null : Number(r) / divisor;
    legs[dir] = { state: mapState(s), remain: Number.isFinite(remain) ? remain : null };
  }
  return { itstId: String(rec.itstId), ts: parseTs(rec), legs };
}

// 응답 포장 형태가 확실하지 않아 itstId 와 *PdsgRmdrCs 를 가진 객체를 재귀로 찾는다.
export function findRecords(json) {
  const out = [];
  (function walk(x) {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if ('itstId' in x && Object.keys(x).some((k) => /PdsgRmdrCs$/.test(k))) { out.push(x); return; }
    Object.values(x).forEach(walk);
  })(json);
  return out;
}

// 데모 교차로의 다리(leg) 이름을 T-Data 방향 필드에 연결한다. legMap 이 없으면 같은 이름을 쓴다.
export function remapLegs(legs, legMap) {
  if (!legMap) return legs;
  const o = {};
  for (const [demoLeg, dir] of Object.entries(legMap)) if (legs[dir]) o[demoLeg] = legs[dir];
  return o;
}
