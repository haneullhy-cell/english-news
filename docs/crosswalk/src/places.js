// 실제 지도 불러오기 목록. 앱과 tools/fetch-osm.mjs(넷리파이 빌드 때 지도를 미리 받아 두는 스크립트)가 함께 쓴다.
export const PLACES = {
  dj_cityhall: { lat: 36.351406, lon: 127.3867, name: '대전 시청역·둔산 주변' },
  dj_complex: { lat: 36.357675, lon: 127.381019, name: '대전 정부청사역 주변' },
  dj_station: { lat: 36.331331, lon: 127.433019, name: '대전역 주변' },
  dj_yuseong: { lat: 36.353707, lon: 127.341349, name: '대전 유성온천역 주변' },
  gangnam: { lat: 37.49795, lon: 127.02764, name: '강남역 주변' },
  yeoksam: { lat: 37.50062, lon: 127.03644, name: '역삼역 주변' },
};
// 미리 받아 두는 반경(m). 이보다 작거나 같은 반경을 고르면 미리 받아 둔 지도를 쓴다.
export const PREBUILT_RADIUS = 700;
