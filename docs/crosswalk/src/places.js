// 실제 지도 불러오기 목록. 앱과 tools/fetch-osm.mjs(넷리파이 빌드 때 지도를 미리 받아 두는 스크립트)가 함께 쓴다.
export const PLACES = {
  dj_cityhall: { lat: 36.351406, lon: 127.3867, name: '대전 시청역·둔산 주변' },
  dj_complex: { lat: 36.357675, lon: 127.381019, name: '대전 정부청사역 주변' },
  dj_station: { lat: 36.331331, lon: 127.433019, name: '대전역 주변' },
  dj_yuseong: { lat: 36.353707, lon: 127.341349, name: '대전 유성온천역 주변' },
  gangnam: { lat: 37.49795, lon: 127.02764, name: '강남역 주변' },
  yeoksam: { lat: 37.50062, lon: 127.03644, name: '역삼역 주변' },
};
// 미리 받아 두는 반경(m). 목록의 장소는 고른 반경과 상관없이 미리 받아 둔 지도를 먼저 쓴다.
export const PREBUILT_RADIUS = 700;

// 좌표가 어느 장소의 미리 받아 둔 범위 안에 있으면 그 장소 키(가장 가까운 것), 없으면 null.
// margin 은 범위 가장자리에서 안쪽으로 남겨 둘 여유(m): 내 위치 주변이 지도 밖으로 너무 잘리지 않게.
export function placeCovering(lat, lon, available = null, margin = 250) {
  let best = null, bd = Infinity;
  for (const [key, pl] of Object.entries(PLACES)) {
    if (available && !available.includes(key)) continue;
    const dy = (lat - pl.lat) * 110574, dx = (lon - pl.lon) * 111320 * Math.cos((pl.lat * Math.PI) / 180);
    const d = Math.hypot(dx, dy);
    if (d <= PREBUILT_RADIUS - margin && d < bd) { bd = d; best = key; }
  }
  return best;
}
