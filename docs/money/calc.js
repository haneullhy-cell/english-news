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

  /* ---------- 지자체 지원금 ---------- */
  function localItems(sido, sgg) {
    var L = DATA.local && DATA.local[sido];
    if (!L) return [];
    return (L.city || []).concat((L.sgg && L.sgg[sgg]) || []);
  }
  function hasLocal(sido) { return !!(DATA.local && DATA.local[sido]); }

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

    var rows = {};     // i → { i, k(월령), items:{id:amount}, sum }
    var totals = {};
    function add(i, k, id, amt) {
      if (!amt) return;
      var row = rows[i] || (rows[i] = { i: i, k: k, items: {}, sum: 0 });
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

    // 지자체(시·도, 시·군·구) 지원금: DATA.local 에 공식 확인된 곳만 있습니다
    var once = [];
    var local = localItems(p.sido, p.sgg), localOut = [];
    local.forEach(function (it) {
      if (it.bornFrom && born && fmtDate(b) < it.bornFrom) return;
      if (it.type === 'monthly') {
        var sum = 0;
        it.bands.forEach(function (bd) {
          for (var kk = bd.from; kk < bd.to; kk++) {
            var ii = birthI + kk;
            if (ii >= startI && !it.unconfirmed) { add(ii, kk, it.id, bd.amount); sum += bd.amount; }
          }
        });
        localOut.push({ item: it, total: sum, upcoming: sum > 0 });
      } else {
        // 한 번 받는 돈: 신청 기한(태어난 날부터 N개월) 안이면 앞으로 받을 돈으로 셉니다
        var up = !born || daysBetween(t, addDays(addMonthsDate(b, it.applyMonths), -1)) >= 0;
        once.push({ id: it.id, amount: it.amount, upcoming: up && !it.unconfirmed, local: true });
        localOut.push({ item: it, total: it.amount, upcoming: up, unconfirmed: !!it.unconfirmed });
      }
    });

    // 육아휴직 급여 (계획을 넣고 '총액에 넣기'를 켠 경우)
    var lv = null;
    if (p.leave && p.leave.include) {
      lv = leave(p.leave);
      lv.parents.forEach(function (q) {
        q.monthly.forEach(function (v, j) {
          var kk = q.startK + j, ii = birthI + kk;
          if (ii >= startI) add(ii, kk, 'leave', v);
        });
      });
    }
    var months = Object.keys(rows).map(function (x) { return rows[x]; }).sort(function (a, c) { return a.i - c.i; });

    // 한 번에 받는 돈
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
      total: total, totals: totals, once: once, leave: lv, local: localOut,
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
      if (td.when === 'leave' && !(p.leave && (p.leave.parents || []).some(function (q) {
        var r = DATA.leave.jobs[q.job]; return r && r.canLeave && +q.months > 0; }))) return;
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
    // 지자체 지원금 신청 기한
    localItems(p.sido, p.sgg).forEach(function (it) {
      if (!it.todo || (it.bornFrom && born && fmtDate(b) < it.bornFrom)) return;
      var due = it.todo.dueDays !== undefined ? addDays(b, it.todo.dueDays) : addDays(addMonthsDate(b, it.todo.dueMonths), -1);
      var left = daysBetween(t, due);
      if (born && left < -30) return;                     // 기한이 한참 지난 건 안 보여 줌
      list.push({ id: 'local-' + it.id, title: it.todo.title, body: it.todo.body, src: it.src, when: 'local',
        first: false, due: fmtDate(due), dLeft: left });
    });
    return list;
  }

  /* ---------- 육아휴직 급여 ----------
   * plan = { single:bool, parents:[{ job, wage(월 통상임금, 원), months, startK(휴직 시작 때 아이 개월) }] }
   * 직업별 규칙은 DATA.leave.jobs 에 있습니다. 월 단위로만 계산합니다(일할 계산·회사 지급 금품 감액은 빼고). */
  function bandPay(bands, floor, wage, m) {
    for (var j = 0; j < bands.length; j++) {
      if (m <= bands[j].upTo) {
        var v = Math.round(wage * bands[j].rate);
        if (bands[j].cap && v > bands[j].cap) v = bands[j].cap;
        if (floor && v < floor) v = floor;
        return v;
      }
    }
    return 0;
  }
  function leave(plan) {
    var L = DATA.leave;
    var ps = (plan.parents || []).slice(0, plan.single ? 1 : 2).map(function (q) {
      var rule = L.jobs[q.job] || L.jobs.none;
      return { job: q.job, rule: rule, wage: Math.max(0, +q.wage || 0), want: rule.canLeave ? Math.max(0, +q.months || 0) : 0, startK: Math.max(0, +q.startK || 0) };
    });
    var two = !plan.single && ps.length === 2;
    // 남녀고용평등법 제19조②: 부모가 각각 3개월 이상 쓰거나 한부모면 6개월 더
    var longer = plan.single || (two && ps[0].want >= L.extendNeedEach && ps[1].want >= L.extendNeedEach);
    var maxMonths = L.baseMonths + (longer ? L.extendMonths : 0);
    ps.forEach(function (q) { q.months = Math.min(q.want, maxMonths); q.over = q.want > maxMonths; });
    // 부모가 모두 쉴 때 상한이 올라가는 특례. 직업마다 방식이 다릅니다.
    //  common(회사원 6+6): 둘 다 아이 18개월 전에 시작, 둘이 같이 쓴 개월(최대 6)만
    //  second(공무원 등): 두 번째로 휴직한 사람이 처음 6개월 (기간 조건 없음, 첫 번째 사람은 일반)
    var both = two && ps[0].months > 0 && ps[1].months > 0;
    var windowMiss = false;
    ps.forEach(function (q, j) {
      var o = two ? ps[1 - j] : null, sx = q.rule.sixsix;
      q.boost = 0; q.sameStart = false;
      if (!sx || !both) return;
      if (sx.mode === 'common') {
        if (q.startK < sx.windowMonths && o.startK < sx.windowMonths) q.boost = Math.min(q.months, o.months, sx.maxMonths);
        else windowMiss = true;
      } else if (sx.mode === 'second') {
        if (q.startK > o.startK) q.boost = Math.min(q.months, sx.maxMonths);
        else if (q.startK === o.startK) q.sameStart = true;
      }
    });
    var total = 0;
    ps.forEach(function (q) {
      var r = q.rule, monthly = [];
      q.noWage = r.canLeave && q.months > 0 && !q.wage;   // 월급을 안 넣었으면 하한(70만)으로 채우지 않고 0으로 둠
      for (var m = 1; m <= q.months; m++) {
        var v;
        if (q.noWage) v = 0;
        else if (m <= q.boost) v = bandPay([{ upTo: m, rate: r.sixsix.rate, cap: r.sixsix.caps[m - 1] }], r.floor, q.wage, m);
        else v = bandPay(plan.single && r.singleBands ? r.singleBands : r.bands, r.floor, q.wage, m);
        monthly.push(v);
      }
      q.monthly = monthly;
      q.total = monthly.reduce(function (a, b) { return a + b; }, 0);
      total += q.total;
    });
    var together = ps.some(function (q) { return q.boost > 0; });
    return { parents: ps, total: total, together: together, both: both, windowMiss: windowMiss, maxMonths: maxMonths };
  }
  // 부부가 합쳐 n개월 쉴 때 나누는 방법별 금액 (많은 순)
  function leaveSplits(plan, n) {
    var out = [];
    for (var a = 0; a <= n; a++) {
      var p2 = { single: false, parents: plan.parents.map(function (q, j) { var c = {}; for (var k in q) c[k] = q[k]; c.months = j === 0 ? a : n - a; return c; }) };
      var r = leave(p2);
      if (r.parents[0].over || r.parents[1].over) continue;
      if (!r.parents[0].rule.canLeave && a > 0) continue;
      if (!r.parents[1].rule.canLeave && n - a > 0) continue;
      out.push({ a: a, b: n - a, total: r.total, together: r.together });
    }
    out.sort(function (x, y) { return y.total - x.total || Math.abs(x.a - x.b) - Math.abs(y.a - y.b); });
    return out;
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
    DATA: DATA, calc: calc, todos: todos, regionClass: regionClass, localItems: localItems, hasLocal: hasLocal, leave: leave, leaveSplits: leaveSplits,
    allowAgeLimit: allowAgeLimit, man: man,
    parseDate: parseDate, monthIdx: monthIdx, idxYear: idxYear, idxMonth: idxMonth,
    fmtDate: fmtDate, addDays: addDays, daysBetween: daysBetween
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Money;
  else root.Money = Money;
})(typeof window !== 'undefined' ? window : this);
