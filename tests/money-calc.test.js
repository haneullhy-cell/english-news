// 받을돈 계산 엔진 테스트: node --test tests/money-calc.test.js
// 기대값은 법령 문구로 손으로 계산한 값입니다 (엔진 출력을 복사하지 않음).
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../docs/money/calc.js');
require('../docs/money/data.js');

const base = { born: true, order: 1, sido: '서울특별시', sgg: '', local: false, careAt: 36 };
const MAN = 10000;

test('신생아 첫째·서울·세 돌에 기관: 부모급여 1,800만 + 양육수당 120만 + 아동수당 156개월 + 첫만남 200만', () => {
  const r = M.calc({ ...base, date: '2026-09-15' }, '2026-09-30');
  assert.equal(r.within60, true);
  assert.equal(r.totals.parentPay, (12 * 100 + 12 * 50) * MAN);
  assert.equal(r.totals.homeCare, 12 * 10 * MAN);          // 24~35개월
  assert.equal(r.totals.childAllow, 156 * 10 * MAN);       // 13세 생일 든 달의 전달까지 (0~155개월)
  assert.equal(r.totals.firstMeet, 200 * MAN);
  assert.equal(r.total, 3680 * MAN);
  // 9월분: 부모급여 100만 + 아동수당 10만
  assert.equal(r.thisMonth.sum, 110 * MAN);
});

test('60일이 지나면 태어난 달부터 소급하지 않고 이번 달(25일 전)부터 셈', () => {
  const r = M.calc({ ...base, date: '2026-07-10' }, '2026-09-18');
  assert.equal(r.within60, false);
  assert.equal(r.startIdx, M.monthIdx({ y: 2026, m: 9, d: 1 }));
  assert.equal(r.totals.parentPay, (10 * 100 + 12 * 50) * MAN);  // 2~11개월, 12~23개월
  assert.equal(r.totals.firstMeet, undefined);                 // 이미 받았을 것으로 보고 합계에서 뺌
});

test('25일이 지났으면 다음 달부터 셈', () => {
  const r = M.calc({ ...base, date: '2025-01-10' }, '2026-09-30');
  assert.equal(r.startIdx, M.monthIdx({ y: 2026, m: 10, d: 1 }));
});

test('2019년 6월생: 2032년 5월분까지 아동수당 68개월', () => {
  const r = M.calc({ ...base, date: '2019-06-10', careAt: null }, '2026-09-30');
  assert.equal(r.totals.parentPay, undefined);
  assert.equal(r.totals.homeCare, undefined);                // 86개월 넘음
  assert.equal(r.totals.childAllow, 68 * 10 * MAN);          // 2026.10 ~ 2032.5
  assert.equal(r.once.length, 0);                            // 2024년 전 출생: 첫만남이용권 안 보여 줌
  assert.equal(r.total, 680 * MAN);
});

test('2017년생 특례: 2026~2029년 1~12월분 모두, 2030년은 13세 생일 든 달 전달까지', () => {
  const r = M.calc({ ...base, date: '2017-07-20', careAt: null }, '2026-09-30');
  // 2026.10~12 (3) + 2027~2029 (36) + 2030.1~6 (6)
  assert.equal(r.totals.childAllow, 45 * 10 * MAN);
  const last = r.months[r.months.length - 1];
  assert.equal(M.idxYear(last.i), 2030);
  assert.equal(M.idxMonth(last.i), 6);
});

test('2016년생은 받을 돈 없음', () => {
  const r = M.calc({ ...base, date: '2016-12-01', careAt: null }, '2026-09-30');
  assert.equal(r.total, 0);
});

test('2018년 3월생: 해마다 기준 나이가 올라 끊기지 않고 2031년 2월분까지', () => {
  const r = M.calc({ ...base, date: '2018-03-05', careAt: null }, '2026-09-30');
  const months = r.months.filter(m => m.items.childAllow);
  // 2026.10 ~ 2031.2 = 3 + 12*4 + 2 = 53개월, 사이에 빠진 달 없음
  assert.equal(months.length, 53);
  for (let j = 1; j < months.length; j++) assert.equal(months[j].i - months[j - 1].i, 1);
});

test('임신 중·둘째·집에서 초등 전까지: 양육수당 62개월, 첫만남 300만, 진료비 100만', () => {
  const r = M.calc({ ...base, born: false, date: '2027-03-10', order: 2, careAt: null }, '2026-09-30');
  assert.equal(r.born, false);
  assert.equal(r.totals.homeCare, 62 * 10 * MAN);            // 24~85개월
  assert.equal(r.totals.firstMeet, 300 * MAN);
  assert.equal(r.totals.pregVoucher, 100 * MAN);
  assert.equal(r.totals.childAllow, 156 * 10 * MAN);
  assert.equal(r.total, (1800 + 620 + 300 + 100 + 1560) * MAN);
});

test('돌 무렵 기관에 가면 양육수당 없음', () => {
  const r = M.calc({ ...base, date: '2026-09-15', careAt: 12 }, '2026-09-30');
  assert.equal(r.totals.homeCare, undefined);
});

test('할 일 마감일: 출생신고 1개월, 60일(출생일 포함), 첫만남이용권 2년', () => {
  const t = Object.fromEntries(M.todos({ ...base, date: '2026-09-15' }, '2026-09-30').map(x => [x.id, x]));
  assert.equal(t['birth-report'].due, '2026-10-15');
  assert.equal(t['apply-60'].due, '2026-11-13');             // 9/15가 1일째 → 11/13이 60일째
  assert.equal(t['apply-60'].dLeft, 44);
  assert.equal(t['first-meet-use'].due, '2028-09-14');
  assert.equal(t['preg-voucher'], undefined);                // 태어났으니 임신 할 일은 없음
  assert.ok(t['electric']);
  assert.ok(t['tax-birth']);
});

test('할 일: 임신 중에는 진료비 신청이 보이고, 네 살이면 전기요금·출산공제는 안 보임', () => {
  const preg = M.todos({ ...base, born: false, date: '2027-03-10' }, '2026-09-30').map(x => x.id);
  assert.ok(preg.includes('preg-voucher'));
  const four = M.todos({ ...base, date: '2022-05-01' }, '2026-09-30').map(x => x.id);
  assert.ok(!four.includes('electric'));
  assert.ok(!four.includes('tax-birth'));
  assert.ok(!four.includes('momcare'));
});

test('만 단위 표시', () => {
  assert.equal(M.man(105000), '10.5만');
  assert.equal(M.man(36800000), '3,680만');
  assert.equal(M.man(16380000), '1,638만');
});

test('지역 구분: 고시 별표 1·2와 광주·전남 통합 반영', () => {
  const R = M.DATA.regions;
  assert.equal(R.order.length, 16);
  const count = c => Object.values(R.sido).reduce((n, s) => n + Object.values(s.sgg).filter(v => v === c).length, 0);
  assert.equal(count('depopPref'), 49);
  assert.equal(count('depopSpecial'), 40);
  assert.equal(count('nonmetro') + 1, 78);                   // + 세종(시·군·구 없음)
  assert.equal(M.regionClass('서울특별시', ''), 'metro');
  assert.equal(M.regionClass('경기도', ''), 'metro');
  assert.equal(M.regionClass('인천광역시', '강화군'), 'depopPref');
  assert.equal(M.regionClass('세종특별자치시', ''), 'nonmetro');
  assert.equal(M.regionClass('부산광역시', '동구'), 'depopPref');
  assert.equal(M.regionClass('부산광역시', '해운대구'), 'nonmetro');
  assert.equal(M.regionClass('전남광주통합특별시', '신안군'), 'depopSpecial');
  assert.equal(M.regionClass('전남광주통합특별시', '광주 광산구'), 'nonmetro');
  assert.equal(M.regionClass('대구광역시', '군위군'), 'depopPref');
  assert.equal(M.regionClass('경상남도', '함안군'), 'depopPref');
  assert.equal(M.regionClass('경상남도', '고성군'), 'depopSpecial');
  assert.equal(M.regionClass('강원특별자치도', '고성군'), 'depopPref');
});

test('지역별 아동수당 월액: 10만 / 10.5만 / 11만 / 12만, 상품권 +1만', () => {
  const at = (sido, sgg, local) => M.calc({ ...base, date: '2026-09-15', sido, sgg, local }, '2026-09-30').allowMonthly;
  assert.equal(at('서울특별시', '', false), 100000);
  assert.equal(at('세종특별자치시', '', false), 105000);
  assert.equal(at('인천광역시', '옹진군', false), 110000);
  assert.equal(at('인천광역시', '옹진군', true), 120000);
  assert.equal(at('전남광주통합특별시', '신안군', false), 120000);
  assert.equal(at('전남광주통합특별시', '신안군', true), 130000);
  assert.equal(at('제주특별자치도', '제주시', true), 105000); // 상품권 추가는 인구감소지역만
});
