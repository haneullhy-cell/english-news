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

// ---------- 육아휴직 급여 (고용보험법 시행령 제95조·제95조의3) ----------
const ei = (wage, months, startK = 3) => ({ job: 'ei', wage: wage * MAN, months, startK });
const leaveTotal = plan => M.leave(plan).total / MAN;

test('혼자 12개월, 월급 300만: 250×3 + 200×3 + 160×6 = 2,310만', () => {
  const r = M.leave({ single: false, parents: [ei(300, 12), ei(300, 0)] });
  assert.deepEqual(r.parents[0].monthly.map(v => v / MAN), [250, 250, 250, 200, 200, 200, 160, 160, 160, 160, 160, 160]);
  assert.equal(r.total / MAN, 2310);
  assert.equal(r.together, false);
});

test('정부 예시: 부부가 18개월 안에 각각 1년 → 각각 2,960만, 합계 5,920만', () => {
  assert.equal(leaveTotal({ parents: [ei(500, 12), ei(500, 12, 9)] }), 5920);
});

test('6+6: 둘 다 6개월, 월급이 높으면 각각 250·250·300·350·400·450', () => {
  const r = M.leave({ parents: [ei(600, 6), ei(600, 6, 9)] });
  assert.equal(r.together, true);
  assert.deepEqual(r.parents[1].monthly.map(v => v / MAN), [250, 250, 300, 350, 400, 450]);
  assert.equal(r.total / MAN, 4000);
});

test('6+6은 공통 개월만: 4개월 + 5개월이면 4개월까지 특례, 5개월째는 일반(상한 200만)', () => {
  const r = M.leave({ parents: [ei(500, 4), ei(500, 5, 6)] });
  assert.equal(r.parents[0].boost, 4);
  assert.equal(r.parents[1].boost, 4);
  assert.deepEqual(r.parents[0].monthly.map(v => v / MAN), [250, 250, 300, 350]);
  assert.deepEqual(r.parents[1].monthly.map(v => v / MAN), [250, 250, 300, 350, 200]);
});

test('통상임금이 상한보다 낮으면 월급만큼, 70만 원보다 낮으면 70만 원', () => {
  const r = M.leave({ parents: [ei(320, 6), ei(50, 6, 9)] });
  assert.deepEqual(r.parents[0].monthly.map(v => v / MAN), [250, 250, 300, 320, 320, 320]);
  assert.deepEqual(r.parents[1].monthly.map(v => v / MAN), [70, 70, 70, 70, 70, 70]);
});

test('아이 18개월이 지나 시작하면 6+6 없음', () => {
  const r = M.leave({ parents: [ei(500, 6), ei(500, 6, 18)] });
  assert.equal(r.together, false);
  assert.equal(r.windowMiss, true);
  assert.equal(r.total / MAN, 2 * (250 * 3 + 200 * 3));
});

test('기간: 둘 다 3개월 이상이면 한 사람 18개월까지, 아니면 12개월에서 자름', () => {
  const long = M.leave({ parents: [ei(300, 18), ei(300, 3, 9)] });
  assert.equal(long.maxMonths, 18);
  assert.equal(long.parents[0].months, 18);
  const short = M.leave({ parents: [ei(300, 18), ei(300, 2, 9)] });
  assert.equal(short.maxMonths, 12);
  assert.equal(short.parents[0].months, 12);
  assert.equal(short.parents[0].over, true);
});

test('한부모 12개월, 월급 400만: 300×3 + 200×3 + 160×6 = 2,460만', () => {
  assert.equal(leaveTotal({ single: true, parents: [ei(400, 12), ei(0, 0)] }), 2460);
});

test('자영업·일하지 않음은 육아휴직 급여 0, 6+6도 없음', () => {
  const r = M.leave({ parents: [ei(400, 6), { job: 'self', wage: 300 * MAN, months: 6, startK: 3 }] });
  assert.equal(r.parents[1].total, 0);
  assert.equal(r.together, false);
});

test('나누는 방법 비교: 엄마 300만·아빠 500만, 합쳐 12개월이면 6+6이 1위 (3,700만)', () => {
  const sp = M.leaveSplits({ parents: [ei(300, 12), ei(500, 0, 9)] }, 12);
  assert.equal(sp[0].a, 6);
  assert.equal(sp[0].b, 6);
  assert.equal(sp[0].total / MAN, 1700 + 2000);
  const alone = sp.find(x => x.a === 12);
  assert.equal(alone.total / MAN, 2310);
});

// ---------- 공무원 등 (공무원수당 등에 관한 규정 제11조의3) ----------
const gov = (wage, months, startK = 3, job = 'gov') => ({ job, wage: wage * MAN, months, startK });

test('공무원 혼자 12개월: 회사원과 같은 상한 250·200·160 (월봉급액 기준)', () => {
  assert.equal(leaveTotal({ parents: [gov(300, 12), gov(300, 0)] }), 2310);
});

test('공무원 부부: 두 번째로 휴직한 사람만 처음 6개월 특례, 첫 번째는 일반', () => {
  const r = M.leave({ parents: [gov(600, 12, 3), gov(600, 6, 15)] });
  assert.equal(r.parents[0].boost, 0);
  assert.deepEqual(r.parents[0].monthly.slice(0, 6).map(v => v / MAN), [250, 250, 250, 200, 200, 200]);
  assert.equal(r.parents[1].boost, 6);
  assert.deepEqual(r.parents[1].monthly.map(v => v / MAN), [250, 250, 300, 350, 400, 450]);
  assert.equal(r.maxMonths, 18);                             // 둘 다 3개월 이상
});

test('공무원 특례는 아이 나이 조건이 없고, 두 번째 사람 기간만큼(최대 6개월)', () => {
  const r = M.leave({ parents: [gov(600, 2, 3), gov(600, 3, 30)] });
  assert.equal(r.parents[1].boost, 3);                       // 첫 번째가 2개월만 써도 됨, 30개월에 시작해도 됨
  assert.deepEqual(r.parents[1].monthly.map(v => v / MAN), [250, 250, 300]);
});

test('공무원 부부가 같은 달에 시작하면 특례 없이 표시만', () => {
  const r = M.leave({ parents: [gov(600, 6, 3), gov(600, 6, 3)] });
  assert.equal(r.together, false);
  assert.equal(r.parents[0].sameStart, true);
});

test('회사원 엄마 + 공무원 아빠(두 번째): 둘 다 특례 → 각각 2,000만', () => {
  const r = M.leave({ parents: [ei(600, 6, 3), gov(600, 6, 9)] });
  assert.equal(r.parents[0].boost, 6);                       // 회사원 6+6 (18개월 안, 같이 쓴 6개월)
  assert.equal(r.parents[1].boost, 6);                       // 공무원 두 번째
  assert.equal(r.total / MAN, 4000);
});

test('공무원 엄마(첫 번째) + 회사원 아빠: 엄마는 일반, 아빠만 6+6', () => {
  const r = M.leave({ parents: [gov(600, 6, 3), ei(600, 6, 9)] });
  assert.equal(r.parents[0].total / MAN, 250 * 3 + 200 * 3);
  assert.equal(r.parents[1].total / MAN, 2000);
});

test('교사·군인·사립 사무직원은 공무원과 같은 계산, 한부모 공무원은 1~3개월 300만', () => {
  for (const job of ['teacher', 'military', 'privStaff']) {
    assert.equal(leaveTotal({ parents: [gov(600, 6, 3), gov(600, 6, 9, job)] }), 1350 + 2000);
  }
  assert.equal(leaveTotal({ single: true, parents: [gov(400, 12), gov(0, 0)] }), 2460);
});

test('총액에 넣으면 앞으로 받을 돈에 더해짐 (지난달 휴직분은 빼고)', () => {
  const leave = { include: true, parents: [ei(600, 6, 0), ei(600, 6, 0)] };
  const r = M.calc({ ...base, date: '2026-09-15', leave }, '2026-09-30');
  assert.equal(r.totals.leave, 4000 * MAN);
  assert.equal(r.total, (3680 + 4000) * MAN);
  const off = M.calc({ ...base, date: '2026-09-15', leave: { ...leave, include: false } }, '2026-09-30');
  assert.equal(off.totals.leave, undefined);
});

// ---------- 지자체: 대전 (정부24·조례 확인, 2026-09-30) ----------
const dj = (sgg, extra = {}) => ({ ...base, sido: '대전광역시', sgg, date: '2026-09-15', ...extra });
const NATIONAL_DJ = 1800 + 120 + 1638 + 200;                  // 비수도권 아동수당 10.5만 × 156

test('대전 유성구 신생아: 양육기본수당 15만×24 + 30만×12 = 720만, 유성구 30만', () => {
  const r = M.calc(dj('유성구'), '2026-09-30');
  assert.equal(r.totals.djParent, 720 * MAN);
  assert.equal(r.totals.ysBirth, 30 * MAN);
  assert.equal(r.total, (NATIONAL_DJ + 720 + 30) * MAN);
});

test('대전 대덕구: 출생축하금 50만 + 산모회복비 최대 50만', () => {
  const r = M.calc(dj('대덕구'), '2026-09-30');
  assert.equal(r.total, (NATIONAL_DJ + 720 + 50 + 50) * MAN);
});

test('대전 중구: 2026년 금액 미확인이라 보여 주되 합계에서 뺌', () => {
  const r = M.calc(dj('중구'), '2026-09-30');
  assert.equal(r.totals.jgBirth, undefined);
  assert.equal(r.local.find(x => x.item.id === 'jgBirth').unconfirmed, true);
  assert.equal(r.total, (NATIONAL_DJ + 720) * MAN);
});

test('대전 동구 18개월 아이: 양육기본수당은 남은 달만, 1년 지난 출생축하금은 뺌', () => {
  const r = M.calc(dj('동구', { date: '2025-03-10' }), '2026-09-30');
  assert.equal(r.totals.djParent, (5 * 15 + 12 * 30) * MAN);   // 2026.10(19개월)~, 24개월부터 30만
  assert.equal(r.totals.dgBirth, undefined);
  assert.equal(r.local.find(x => x.item.id === 'dgBirth').upcoming, false);
});

test('유성구 출산장려금은 2023년 이후 출생아만, 대덕구 산모회복비는 2025년 이후만', () => {
  assert.ok(!M.calc(dj('유성구', { date: '2022-12-01' }), '2026-09-30').local.some(x => x.item.id === 'ysBirth'));
  assert.ok(!M.calc(dj('대덕구', { date: '2024-12-31' }), '2026-09-30').local.some(x => x.item.id === 'ddMom'));
});

test('대전 할 일: 양육기본수당 60일, 구 지원금 1년, 산모회복비 6개월', () => {
  const t = Object.fromEntries(M.todos(dj('대덕구'), '2026-09-30').map(x => [x.id, x]));
  assert.equal(t['local-djParent'].due, '2026-11-13');
  assert.equal(t['local-ddBirth'].due, '2027-09-14');
  assert.equal(t['local-ddMom'].due, '2027-03-14');
});

test('대전이 아니면 지자체 지원금 없음', () => {
  const r = M.calc({ ...base, date: '2026-09-15' }, '2026-09-30');
  assert.equal(r.local.length, 0);
  assert.equal(M.hasLocal('서울특별시'), false);
});

test('월급을 안 넣은 휴직은 70만 하한으로 채우지 않고 0', () => {
  const r = M.leave({ parents: [{ job: 'ei', wage: 0, months: 12, startK: 3 }, ei(300, 0)] });
  assert.equal(r.total, 0);
  assert.equal(r.parents[0].noWage, true);
});
