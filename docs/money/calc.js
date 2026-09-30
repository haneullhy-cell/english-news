/* 받을돈 – 계산 엔진
 * 금액·조건은 모두 DATA 한 곳에만 둡니다. 숫자마다 공식 출처(src)와 확인한 날(asOf)을 붙입니다.
 * 브라우저에서는 window.Money, node에서는 module.exports 로 씁니다. */
(function (root) {
  'use strict';

  var DATA = {
    asOf: '2026-09-30',
    // 출처 목록: 화면의 '출처' 링크와 테스트에서 같이 씁니다.
    src: {},
    firstMeet: null,     // 첫만남이용권
    parentPay: null,     // 부모급여
    homeCare: null,      // 가정양육수당 (부모급여 끝난 뒤)
    childAllow: null,    // 아동수당
    pregVoucher: null,   // 임신·출산 진료비 (국민행복카드)
    regions: null        // 시·도 / 인구감소지역 구분
  };

  /* ---------- 날짜 도우미 (달 단위 정수: y*12 + (m-1)) ---------- */
  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return null;
    return { y: +m[1], m: +m[2], d: +m[3] };
  }
  function monthIdx(dt) { return dt.y * 12 + (dt.m - 1); }
  function idxYear(i) { return Math.floor(i / 12); }
  function idxMonth(i) { return (i % 12) + 1; }
  function daysBetween(a, b) {
    return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
  }
  function addDays(dt, n) {
    var t = new Date(Date.UTC(dt.y, dt.m - 1, dt.d) + n * 86400000);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  function addMonthsDate(dt, n) {
    var i = monthIdx(dt) + n, y = idxYear(i), m = idxMonth(i);
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { y: y, m: m, d: Math.min(dt.d, last) };
  }
  function fmtDate(dt) {
    return dt.y + '-' + (dt.m < 10 ? '0' : '') + dt.m + '-' + (dt.d < 10 ? '0' : '') + dt.d;
  }

  /* ---------- 지역 ---------- */
  // 돌려주는 값: 'metro' | 'nonmetro' | 'depopPref' | 'depopSpecial'
  function regionClass(sido, sgg) {
    var R = DATA.regions;
    if (!R || !sido) return null;
    var s = R.sido[sido];
    if (!s) return null;
    if (sgg && s.sgg && s.sgg[sgg]) return s.sgg[sgg];
    return s.metro ? 'metro' : 'nonmetro';
  }

  /* ---------- 아동수당 ---------- */
  // 아동수당법 부칙 제2조①: 2026년 9세, 2027년 10세 … 2030년부터 제4조① 13세
  function allowAgeLimit(year) {
    var A = DATA.childAllow.ageLimit, lim = A.base;
    for (var y in A.byYear) if (year >= +y) lim = Math.max(lim, A.byYear[y]);
    return lim;
  }
  // 부칙 제2조②: 2017년생은 2026~2029년에 나이와 관계없이 1~12월분을 받습니다.
  function allowSpecialYear(birthYear, year) {
    var sp = DATA.childAllow.special;
    if (!sp) return false;
    for (var j = 0; j < sp.length; j++) {
      if (sp[j].birthYear === birthYear && year >= sp[j].from && year <= sp[j].to) return true;
    }
    return false;
  }
  function allowAmount(cls, localCurrency) {
    var t = DATA.childAllow.amount[cls];
    if (!t) return 0;
    return localCurrency && t.local ? t.local : t.cash;
  }

  /* ---------- 본 계산 ----------
   * p = { born:bool, date:'YYYY-MM-DD', order:1|2|3, sido, sgg, local:bool,
   *       careAt: 개월(어린이집·유치원 다니기 시작하는 월령) 또는 null(초등 입학 전까지 집에서) }
   * today = 'YYYY-MM-DD' */
  function calc(p, today) {
    var t = parseDate(today), b = parseDate(p.date);
    if (!t || !b) return null;
    var birthI = monthIdx(b), nowI = monthIdx(t);
    var ageDays = daysBetween(b, t);                 // 음수면 아직 안 태어남
    var born = !!p.born && ageDays >= 0;
    var within60 = born && ageDays <= 59;             // 출생일 포함 60일 이내 → 출생월부터 소급
    var PP = DATA.parentPay, HC = DATA.homeCare, FM = DATA.firstMeet;

    // 앞으로 받을 돈을 세기 시작하는 달
    var startI;
    if (!born || within60) startI = birthI;
    else startI = t.d < PP.payDay ? nowI : nowI + 1;

    var cls = regionClass(p.sido, p.sgg) || 'metro';
    var careAt = (p.careAt === null || p.careAt === undefined) ? null : +p.careAt;

    var months = [];   // { i, k(월령), items:{id:amount} }
    var totals = {};
    function add(i, k, id, amt) {
      if (!amt) return;
      var row = months[months.length - 1];
      if (!row || row.i !== i) { row = { i: i, k: k, items: {}, sum: 0 }; months.push(row); }
      row.items[id] = (row.items[id] || 0) + amt;
      row.sum += amt;
      totals[id] = (totals[id] || 0) + amt;
    }

    var lastK = 12 * 13 + 12; // 넉넉히 (아동수당 최대 13세 미만)
    for (var k = 0; k <= lastK; k++) {
      var i = birthI + k;
      if (i < startI) continue;
      var y = idxYear(i);
      // 부모급여
      if (k < 12) add(i, k, 'parentPay', PP.age0);
      else if (k < 24) add(i, k, 'parentPay', PP.age1);
      // 가정양육수당: 부모급여가 끝난 뒤, 기관에 다니기 전까지
      if (k >= HC.fromMonth && k < HC.toMonth && (careAt === null || k < careAt)) add(i, k, 'homeCare', HC.amount);
      // 아동수당: 그해 나이 기준(L)이 되는 생일이 든 달의 전달까지 (아동수당법 제10조①, 부칙 제2조)
      if (k < 12 * allowAgeLimit(y) || allowSpecialYear(b.y, y)) add(i, k, 'childAllow', allowAmount(cls, !!p.local));
    }

    // 한 번에 받는 돈
    var once = [];
    var fmAmt = (p.order || 1) >= 2 ? FM.second : FM.first;
    var fmUpcoming = !born || within60;
    // 지금 금액(200만/300만)은 2024.1.1 이후 출생아에게만 맞습니다. 그 전에 태어났으면 보여 주지 않습니다.
    if (!born || fmtDate(b) >= FM.fromBirth) once.push({ id: 'firstMeet', amount: fmAmt, upcoming: fmUpcoming });
    if (!born) once.push({ id: 'pregVoucher', amount: DATA.pregVoucher.single, upcoming: true });
    once.forEach(function (o) { if (o.upcoming) totals[o.id] = (totals[o.id] || 0) + o.amount; });

    var total = 0;
    for (var id in totals) total += totals[id];

    // 달력 기준 이번 달·다음 달
    function monthSum(i) {
      for (var j = 0; j < months.length; j++) if (months[j].i === i) return months[j];
      return null;
    }

    // 나이(만)별 합계
    var byAge = [];
    months.forEach(function (r) {
      var a = Math.floor(r.k / 12);
      if (!byAge[a]) byAge[a] = { age: a, sum: 0, items: {}, from: r.i, to: r.i };
      byAge[a].sum += r.sum;
      byAge[a].to = r.i;
      for (var id in r.items) byAge[a].items[id] = (byAge[a].items[id] || 0) + r.items[id];
    });

    return {
      born: born, within60: within60, cls: cls, allowMonthly: allowAmount(cls, !!p.local),
      birthIdx: birthI, startIdx: startI, nowIdx: nowI,
      total: total, totals: totals, once: once,
      months: months, byAge: byAge.filter(Boolean),
      thisMonth: monthSum(Math.max(nowI, startI))
    };
  }

  /* ---------- 할 일 (마감일 계산) ---------- */
  function todos(p, today) {
    var b = parseDate(p.date), t = parseDate(today);
    if (!b || !t) return [];
    var ageDays = daysBetween(b, t);
    var born = !!p.born && ageDays >= 0;
    var list = [];
    (DATA.todos || []).forEach(function (td) {
      if (td.when === 'pregnant' && born) return;
      if (td.when === 'early' && born && ageDays > 90) return;
      if (td.when === 'under3' && born && daysBetween(t, addMonthsDate(b, 36)) <= 0) return;
      if (td.when === 'birthYear' && born && !(b.y === t.y || (b.y === t.y - 1 && t.m <= 2))) return;
      var due = null;
      if (td.dueDays !== undefined) due = addDays(b, td.dueDays);
      if (td.dueMonths !== undefined) due = addMonthsDate(b, td.dueMonths);
      if (due && td.dueAdjDays) due = addDays(due, td.dueAdjDays);
      list.push({
        id: td.id, title: td.title, body: td.body, src: td.src, when: td.when, first: !!td.first,
        due: due ? fmtDate(due) : null,
        dLeft: due ? daysBetween(t, due) : null
      });
    });
    return list;
  }

  /* ---------- 표시 ---------- */
  function man(won) {           // 105000 → '10.5만', 20000000 → '2,000만'
    var v = won / 10000;
    var s = (Math.round(v * 10) / 10).toString();
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.') + '만';
  }

  var Money = {
    DATA: DATA, calc: calc, todos: todos, regionClass: regionClass,
    allowAgeLimit: allowAgeLimit, man: man,
    parseDate: parseDate, monthIdx: monthIdx, idxYear: idxYear, idxMonth: idxMonth,
    fmtDate: fmtDate, addDays: addDays, daysBetween: daysBetween
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Money;
  else root.Money = Money;
})(typeof window !== 'undefined' ? window : this);
