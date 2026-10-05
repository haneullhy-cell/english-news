// 좌표 도우미. 데모 지역은 강남역 사거리를 원점(0,0)으로 하는 로컬 미터 좌표(x: 동, y: 북)를 쓴다.
export const ORIGIN = { lat: 37.49795, lon: 127.02764 };
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

export function toLocal(lat, lon) {
  return { x: (lon - ORIGIN.lon) * M_PER_DEG_LON, y: (lat - ORIGIN.lat) * M_PER_DEG_LAT };
}
export function toLatLon(x, y) {
  return { lat: ORIGIN.lat + y / M_PER_DEG_LAT, lon: ORIGIN.lon + x / M_PER_DEG_LON };
}
export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
// 점 p에서 선분 ab까지의 거리와 투영 비율(0~1)
export function pointToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1e-9;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const q = { x: a.x + t * dx, y: a.y + t * dy };
  return { d: dist(p, q), t, q };
}
export function fmtDist(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}
export function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60), r = s % 60;
  if (m === 0) return `${r}초`;
  return r === 0 ? `${m}분` : `${m}분 ${r}초`;
}
export function fmtSigned(sec) {
  const s = Math.round(sec);
  return (s >= 0 ? '+' : '−') + fmtDur(Math.abs(s));
}
export function fmtClock(tSec) {
  const d = new Date(tSec * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getHours()}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
