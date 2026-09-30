/* 받을돈 – 금액·조건 자료
 * 여기 있는 숫자는 모두 공식 출처(법령, 보건복지부, 정부24, 한전 등)에서 직접 확인한 것만 넣습니다.
 * 바꿀 때는 출처(src)와 asOf 날짜도 같이 고칩니다. */
(function (M) {
  'use strict';
  var D = M.DATA;
  D.asOf = '2026-09-30';

  D.src = {
    lawAllow:      { label: '아동수당법', url: 'https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=286729' },
    lawAllowDec:   { label: '아동수당법 시행령', url: 'https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=289533' },
    mohwAllow:     { label: '보건복지부 보도자료(2026.4.23)', url: 'https://www.mohw.go.kr/board.es?mid=a10503010100&bid=0027&act=view&list_no=1490257&tag=&nPage=1' },
    mohwAllowInfo: { label: '보건복지부 아동수당 안내', url: 'https://www.mohw.go.kr/menu.es?mid=a10711030100' },
    gov24Allow:    { label: '정부24 아동수당', url: 'https://www.gov.kr/portal/service/serviceInfo/135200000120' },
    mohwParent:    { label: '보건복지부 부모급여 안내', url: 'https://www.mohw.go.kr/menu.es?mid=a10711030600' },
    gov24Parent:   { label: '정부24 부모급여', url: 'https://www.gov.kr/portal/service/serviceInfo/135200000143' },
    koreaParent:   { label: '정책브리핑 부모급여 안내', url: 'https://www.korea.kr/multi/visualNewsView.do?newsId=148957936' },
    careGuide:     { label: '2026 보육사업안내', url: 'https://central.childcare.go.kr/ccef/community/data/DataSl.jsp?BBSGB=385&flag=Sl&BID=109590' },
    mohwFirst:     { label: '보건복지부 첫만남이용권 안내', url: 'https://www.mohw.go.kr/menu.es?mid=a10711020100' },
    gov24First:    { label: '정부24 첫만남이용권', url: 'https://www.gov.kr/portal/service/serviceInfo/135200005015' },
    gov24Preg:     { label: '정부24 임신·출산 진료비', url: 'https://www.gov.kr/portal/service/serviceInfo/SD0000007672' },
    mohwPreg:      { label: '보건복지부 임신·출산 진료비 안내', url: 'https://www.mohw.go.kr/menu.es?mid=a10705020100' },
    gov24Elec:     { label: '정부24 출산가구 전기요금 할인', url: 'https://www.gov.kr/portal/rcvfvrSvc/dtlEx/B41000200003' },
    gov24OneStop:  { label: '정부24 행복출산 원스톱', url: 'https://www.gov.kr/portal/service/serviceInfo/174000000029' },
    lawFamily:     { label: '가족관계등록법 제44조', url: 'https://www.law.go.kr/LSW/lsInfoP.do?lsId=010444' },
    lawTax:        { label: '소득세법 제59조의2', url: 'https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=280405' },
    mohwMomBaby:   { label: '2026 산모·신생아 건강관리 사업안내', url: 'https://www.mohw.go.kr/board.es?mid=a10409020000&bid=0026&list_no=1488490&act=view' },
    bojo24:        { label: '정부24 혜택알리미(보조금24)', url: 'https://plus.gov.kr/portal/benefitV2/' },
    eiDecree:      { label: '고용보험법 시행령 제95조·제95조의3', url: 'https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=288717&efYd=20260918' },
    equalAct:      { label: '남녀고용평등법 제19조', url: 'https://www.law.go.kr/법령/남녀고용평등과일ㆍ가정양립지원에관한법률' },
    moel66:        { label: '고용노동부 6+6 부모육아휴직제 Q&A', url: 'https://www.moel.go.kr/policy/policydata/view.do?bbs_seq=20240102052' },
    gov24Leave:    { label: '정부24 육아휴직 급여', url: 'https://www.gov.kr/portal/rcvfvrSvc/dtlEx/999000000008' },
    djGov24:       { label: '정부24 대전형 양육기본수당', url: 'https://www.gov.kr/portal/rcvfvrSvc/dtlEx/630000000124' },
    djPage:        { label: '대전광역시 양육기본수당 안내', url: 'https://www.daejeon.go.kr/drh/DrhContentsHtmlView.do?menuSeq=7205' },
    djOrd:         { label: '대전광역시 출산장려 및 양육 지원 조례', url: 'https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=2000997' },
    dgPage:        { label: '대전 동구 출생축하금 안내', url: 'https://www.donggu.go.kr/dg/kor/contents/111' },
    dgOrd:         { label: '대전 동구 조례', url: 'https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=2171499' },
    jgOrd:         { label: '대전 중구 조례', url: 'https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=2169431' },
    jgPress:       { label: '대전 중구 보도자료(2023.8.20)', url: 'https://www.djjunggu.go.kr/prog/bbsArticle/BBSMSTR_000000000137/view.do?nttId=B000000202571Ih6eL4' },
    sgPage:        { label: '대전 서구 출산지원금 안내', url: 'https://www.seogu.go.kr/kor/sub06_04_02_01.do' },
    sgOrd:         { label: '대전 서구 조례', url: 'https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=2171533' },
    ysOrd:         { label: '대전 유성구 조례', url: 'https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=2171589' },
    ddOrd:         { label: '대전 대덕구 조례', url: 'https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=1991557' },
    ddMomPage:     { label: '대덕구보건소 산모회복비 안내', url: 'https://www.daedeok.go.kr/chc/goContents.do?link=%2Fchc%2Fchc02%2FCHC020408&menuId=CHC020408' },
    sgGov24:       { label: '정부24 서구 출산지원금', url: 'https://www.gov.kr/portal/rcvfvrSvc/dtlEx/366000000107' },
    ysGov24:       { label: '정부24 유성구 출산장려금', url: 'https://www.gov.kr/portal/rcvfvrSvc/dtlEx/367000000120' },
    ddGov24:       { label: '정부24 대덕구 출생축하금', url: 'https://www.gov.kr/portal/rcvfvrSvc/dtlEx/368000000114' },
    ddMomGov24:    { label: '정부24 대덕구 산모회복비', url: 'https://www.gov.kr/portal/rcvfvrSvc/dtlEx/368000000497' },
    govAllow:      { label: '공무원수당 등에 관한 규정 제11조의3', url: 'https://www.law.go.kr/법령/공무원수당등에관한규정' },
    mpmLeave:      { label: '인사혁신처 공무원 보수·수당 업무지침', url: 'https://www.mpm.go.kr/mpm/info/resultPay/payBoard/?boardId=bbs_0000000000000035&mode=view&cntId=693' },
    privSchoolDecree: { label: '사립학교법 시행령 제24조의9', url: 'https://www.law.go.kr/법령/사립학교법시행령' },
    gov24NoEiBirth: { label: '정부24 고용보험 미적용자 출산급여', url: 'https://www.gov.kr/portal/service/serviceInfo/149200000153' },
    eiAct:         { label: '고용보험법 제70조', url: 'https://www.law.go.kr/법령/고용보험법' },
    regionNotice:  { label: '아동수당 추가지급 대상지역 고시', url: 'https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000276802' },
    lawJeonnamGwangju: { label: '전남광주통합특별시 설치법', url: 'https://www.law.go.kr/법령/전남광주통합특별시설치를위한특별법' }
  };

  // 첫만남이용권: 아동수당법 시행령 제10조의3 (2024.1.1 이후 출생아)
  D.firstMeet = { first: 2000000, second: 3000000, useYears: 2, fromBirth: '2024-01-01' };

  // 부모급여: 아동수당법 시행령 제2조① / 매월 25일 (시행령 제9조①)
  D.parentPay = { age0: 1000000, age1: 500000, payDay: 25 };
  D.payDayNote = '부모급여·아동수당은 매월 25일에 들어와요 (주말·공휴일이면 그 전날).';

  // 가정양육수당: 2026 보육사업안내 – 24개월 이상 86개월 미만, 월 10만 원 (일반)
  D.homeCare = { fromMonth: 24, toMonth: 86, amount: 100000 };

  // 아동수당: 아동수당법 제4조① "13세 미만", 부칙(법률 제21489호) 연도별 연령, 시행령 제2조② 지역 추가분
  D.childAllow = {
    ageLimit: {
      base: 9,                                   // 2026년
      byYear: { 2027: 10, 2028: 11, 2029: 12, 2030: 13 }
    },
    // 부칙 제2조②: 2017년생은 2026~2029년 1~12월분 모두 지급
    special: [{ birthYear: 2017, from: 2026, to: 2029 }],
    amount: {
      metro:        { cash: 100000 },
      nonmetro:     { cash: 105000 },
      depopPref:    { cash: 110000, local: 120000 },
      depopSpecial: { cash: 120000, local: 130000 }
    }
  };

  // 육아휴직 급여
  // 고용보험: 고용보험법 시행령 제95조①(일반), 제95조의3①(부모 함께 = 6+6), 제95조의3③(한부모) [시행 2026.9.18]
  // 기간: 남녀고용평등법 제19조② – 1년, 부모가 각각 3개월 이상 쓰거나 한부모면 6개월 더
  // 공무원: 공무원수당 등에 관한 규정 제11조의3 (지방은 지방공무원 수당 등에 관한 규정, 같은 내용)
  //   ① 1~3개월 월봉급액 100%·상한 250만, 4~6개월 200만, 7개월부터 80%·160만, 하한 70만
  //   ②1 부모가 모두 휴직하고 '두 번째'로 휴직한 사람이 공무원이면 그 사람만 1~6개월 상한 250·250·300·350·400·450만 (기간 조건 없음)
  //   ②2 한부모 1~3개월 상한 300만 / ⑥⑦ 수당은 12개월, 부모가 각각 3개월 이상·한부모면 18개월
  //   국공립 교원(교육공무원), 사립학교 교원(사립학교법 시행령 제24조의9 준용), 군인도 같은 규정
  var BANDS = [{ upTo: 3, rate: 1, cap: 2500000 }, { upTo: 6, rate: 1, cap: 2000000 }, { upTo: 999, rate: 0.8, cap: 1600000 }];
  var SINGLE = [{ upTo: 3, rate: 1, cap: 3000000 }, { upTo: 6, rate: 1, cap: 2000000 }, { upTo: 999, rate: 0.8, cap: 1600000 }];
  var CAPS6 = [2500000, 2500000, 3000000, 3500000, 4000000, 4500000];
  function govLike(label, extra) {
    var j = { label: label, canLeave: true, floor: 700000, bands: BANDS, singleBands: SINGLE,
      sixsix: { mode: 'second', maxMonths: 6, rate: 1, caps: CAPS6 },
      wageLabel: '월봉급액(호봉 봉급)', src: ['govAllow', 'mpmLeave'] };
    for (var k in extra || {}) j[k] = extra[k];
    return j;
  }
  D.leave = {
    baseMonths: 12, extendMonths: 6, extendNeedEach: 3,
    jobOrder: ['ei', 'gov', 'teacher', 'military', 'privStaff', 'self', 'none'],
    jobs: {
      ei: {
        label: '회사원', canLeave: true, floor: 700000, bands: BANDS, singleBands: SINGLE,
        // 6+6: 아이 18개월 전에 부모 모두 시작 (고용노동부 Q&A), 같이 쓴 개월만. 배우자가 공무원이어도 적용(고용노동부 상담 답변)
        sixsix: { mode: 'common', windowMonths: 18, maxMonths: 6, rate: 1, caps: CAPS6 },
        wageLabel: '고용보험 · 월 통상임금', src: ['eiDecree', 'equalAct', 'moel66', 'gov24Leave']
      },
      gov: govLike('공무원'),
      teacher: govLike('교사(국공립·사립)', { src: ['govAllow', 'privSchoolDecree'] }),
      military: govLike('군인'),
      privStaff: govLike('사립학교 사무직원', { warn: '사립학교 사무직원은 학교(법인) 정관에 따라 달라요. 공무원 기준으로 계산했으니 학교에 꼭 확인하세요.' }),
      self: { label: '자영업·프리랜서', canLeave: false, note: '육아휴직 급여 대상이 아니에요.' },
      none: { label: '일 안 해요', canLeave: false, note: '' }
    }
  };

  // 지자체 지원금: 공식 자료로 확인한 지역만 넣습니다 (2026-09-30 확인).
  //  type 'monthly' = 매달 (bands: 아이 개월 [from, to)), 'once' = 한 번 (applyMonths: 태어난 날부터 신청 기한)
  //  unconfirmed: 2026년 금액을 공식 자료로 확인 못 함 → 보여 주되 합계에서 뺌
  //  max: 영수증 정산 등 '최대' 금액
  D.local = {
    '대전광역시': {
      city: [{
        id: 'djParent', name: '대전형 양육기본수당', payer: '대전광역시', type: 'monthly',
        bands: [{ from: 0, to: 24, amount: 150000 }, { from: 24, to: 36, amount: 300000 }],
        short: '0~23개월 월 15만 · 24~35개월 월 30만',
        what: '대전에 사는 0~2세 아이에게 매달 현금으로 줘요. 0~1세(0~23개월)는 월 15만 원, 2세(24~35개월)는 월 30만 원이에요. 소득이나 몇째와 상관없고 부모급여·아동수당과 같이 받아요.',
        who: '아이가 대전에 주민등록이 있고, 부 또는 모가 출생일 기준 대전에 6개월 이상 주민등록이 있어야 해요. 6개월이 안 됐으면 6개월을 채운 뒤부터 받아요.',
        how: '동 행정복지센터에 방문해 신청해요. 출생일로부터 60일 안에 신청하면 태어난 달부터 소급해 줘요.',
        src: ['djGov24', 'djPage', 'djOrd'],
        todo: { title: '대전형 양육기본수당 신청 (출생 후 60일 안)', dueDays: 59,
          body: '이 날까지 동 행정복지센터에 신청하면 태어난 달부터 소급해서 받아요. 부 또는 모가 대전에 6개월 이상 살았어야 해요.' }
      }],
      sgg: {
        '동구': [{
          id: 'dgBirth', name: '동구 출생축하금', payer: '대전 동구', type: 'once', amount: 300000, applyMonths: 12,
          short: '출생아당 30만 원 · 한 번',
          what: '태어난 아이 한 명당 30만 원을 한 번 줘요 (2026년 기준, 소득·몇째 상관없음).',
          who: '출생신고일부터 신청일까지 부 또는 모가 동구에 주민등록을 두고 아이와 함께 살아야 해요.',
          how: '동 행정복지센터에 방문해 신청해요. 태어나고 1년 안에 해야 해요.',
          src: ['dgPage', 'dgOrd'],
          todo: { title: '동구 출생축하금 신청 (태어나고 1년 안)', dueMonths: 12, body: '동 행정복지센터에서 신청해요. 30만 원을 한 번 받아요.' }
        }],
        '중구': [{
          id: 'jgBirth', name: '중구 출생축하금', payer: '대전 중구', type: 'once', amount: 300000, applyMonths: 12, unconfirmed: true,
          short: '2023년 자료 기준 30만 원 · 2026년 금액 확인 중 (합계에서 뺐어요)',
          what: '중구도 출생축하금(옛 출산장려금)을 줘요. 2023년 중구 보도자료에는 30만 원으로 나와 있지만, 2026년 금액을 공식 자료로 확인하지 못해서 합계에는 넣지 않았어요. 2026년부터 지역화폐(중구통)로 줄 수도 있어요.',
          who: '출생신고일 기준 부 또는 모가 중구에 주민등록을 두고 아이와 함께 살아야 해요.',
          how: '태어나고 1년 안에 신청해요. 금액은 중구청에 확인해 주세요.',
          src: ['jgOrd', 'jgPress'],
          todo: { title: '중구 출생축하금 신청 (태어나고 1년 안)', dueMonths: 12, body: '동 행정복지센터에서 신청해요. 금액은 중구청에 확인해 주세요.' }
        }],
        '서구': [{
          id: 'sgBirth', name: '서구 출산지원금', payer: '대전 서구', type: 'once', amount: 300000, applyMonths: 12,
          short: '첫째부터 30만 원 · 한 번',
          what: '첫째 아이부터 30만 원을 한 번 줘요.',
          who: '출생신고일 기준 부 또는 모가 서구에 주민등록을 두고 살아야 해요.',
          how: '동 행정복지센터에 방문해 신청해요. 태어나고 1년 안에 해야 해요.',
          src: ['sgGov24', 'sgPage', 'sgOrd'],
          todo: { title: '서구 출산지원금 신청 (태어나고 1년 안)', dueMonths: 12, body: '동 행정복지센터에서 신청해요. 30만 원을 한 번 받아요.' }
        }],
        '유성구': [{
          id: 'ysBirth', name: '유성구 출산장려금', payer: '대전 유성구', type: 'once', amount: 300000, applyMonths: 12, bornFrom: '2023-01-01',
          short: '첫째부터 30만 원 · 한 번 (2023년 이후 출생아)',
          what: '2023년 1월 1일 이후 태어난 아이는 첫째부터 30만 원을 한 번 줘요.',
          who: '출생신고일부터 신청일까지 부 또는 모가 유성구에 주민등록을 두고 아이와 함께 살아야 해요 (2026년 9월 조례 개정 기준).',
          how: '동 행정복지센터에 방문해 신청해요. 태어나고 1년 안에 해야 해요.',
          src: ['ysGov24', 'ysOrd'],
          todo: { title: '유성구 출산장려금 신청 (태어나고 1년 안)', dueMonths: 12, body: '동 행정복지센터에서 신청해요. 30만 원을 한 번 받아요.' }
        }],
        '대덕구': [{
          id: 'ddBirth', name: '대덕구 출생축하금', payer: '대전 대덕구', type: 'once', amount: 500000, applyMonths: 12,
          short: '출생아당 50만 원 · 한 번',
          what: '태어난 아이 한 명당 50만 원을 한 번 줘요.',
          who: '출생신고일 기준 부 또는 모가 대덕구에 주민등록을 두고 아이와 함께 살아야 해요.',
          how: '동 행정복지센터에 신분증과 통장 사본을 가지고 가서 신청해요. 태어나고 1년 안에 해요.',
          src: ['ddGov24', 'ddOrd'],
          todo: { title: '대덕구 출생축하금 신청 (태어나고 1년 안)', dueMonths: 12, body: '신분증과 통장 사본을 가지고 동 행정복지센터에서 신청해요. 50만 원을 한 번 받아요.' }
        }, {
          id: 'ddMom', name: '대덕구 산모회복비', payer: '대전 대덕구', type: 'once', amount: 500000, applyMonths: 6, bornFrom: '2025-01-01', max: true,
          short: '최대 50만 원 · 영수증 정산',
          what: '산후조리원, 병의원, 약국, 산모·신생아 건강관리 본인부담금으로 쓴 돈을 영수증으로 정산해서 50만 원까지 줘요 (출산 의료비는 빼요).',
          who: '2025년 이후 출산하고 대덕구에 출생신고를 한 산모 (신청일에 대덕구 주민등록)',
          how: '대덕구보건소에 태어나고 6개월 안에 신청해요.',
          src: ['ddMomGov24', 'ddMomPage'],
          todo: { title: '대덕구 산모회복비 신청 (태어나고 6개월 안)', dueMonths: 6, body: '산후조리원·병원·약국 영수증을 모아 대덕구보건소에 내면 50만 원까지 정산해 줘요.' }
        }]
      },
      extra: '부모가 장애인인 가정은 대전시·구에서 출산지원금을 더 받을 수 있고, 세 자녀 이상 가정 지원도 있어요 (이 계산에는 빠져 있어요).'
    }
  };
  D.localIndex = {};
  Object.keys(D.local).forEach(function (sd) {
    var L = D.local[sd], all = (L.city || []).slice();
    Object.keys(L.sgg || {}).forEach(function (g) { all = all.concat(L.sgg[g]); });
    all.forEach(function (it) { D.localIndex[it.id] = it; });
  });

  // 임신·출산 진료비(국민행복카드): 단태아 100만 원, 다태아 140만 원 기본(태아당 100만 원까지 추가), 분만취약지 +20만 원
  D.pregVoucher = { single: 1000000, multiBase: 1400000, perFetus: 1000000, remote: 200000 };

  D.info = {
    pregVoucher: {
      name: '임신·출산 진료비', short: '국민행복카드 바우처 · 임신 1회',
      what: '임신·출산 진료비를 국민행복카드로 지원해요. 임신 1회당 100만 원이고, 다태아는 140만 원을 기본으로 태아당 100만 원이 되도록 더 줘요. 분만취약지는 20만 원을 더 받아요.',
      who: '건강보험에 가입한 임신부 (임신이 확인된 뒤)',
      how: '병원에서 임신확인서를 받아 카드사·건강보험공단·정부24에서 신청해요. 분만 예정일(출산일)로부터 2년까지 써요.',
      src: ['gov24Preg', 'mohwPreg']
    },
    firstMeet: {
      name: '첫만남이용권', short: '태어날 때 한 번 · 국민행복카드 바우처',
      what: '아이가 태어나면 한 번 주는 바우처예요. 첫째 200만 원, 둘째부터 300만 원이에요 (2024년 1월 1일 이후 태어난 아이).',
      who: '출생신고를 한 아이',
      how: '출생신고 때 행복출산 원스톱으로 같이 신청하거나 복지로·주민센터에서 신청해요. 태어난 날부터 2년 안에 써야 해요.',
      src: ['gov24First', 'mohwFirst', 'lawAllowDec']
    },
    parentPay: {
      name: '부모급여', short: '0~11개월 월 100만 · 12~23개월 월 50만',
      what: '만 0세(0~11개월)는 매월 100만 원, 만 1세(12~23개월)는 매월 50만 원이에요. 어린이집에 다니면 보육료(2026년 0세반 58.4만, 1세반 51.5만 원)를 먼저 내고 남는 돈만 현금으로 받아요. 그래서 12~23개월에 어린이집에 다니면 현금은 없어요.',
      who: '만 2세 미만 아이를 키우는 가정',
      how: '출생일을 포함해 60일 안에 신청하면 태어난 달부터 받아요. 복지로·정부24·주민센터·행복출산 원스톱에서 신청해요.',
      src: ['mohwParent', 'gov24Parent', 'koreaParent', 'lawAllow']
    },
    homeCare: {
      name: '가정양육수당', short: '24~85개월 · 집에서 키우면 월 10만',
      what: '어린이집·유치원·종일제 아이돌봄을 쓰지 않고 집에서 키우면 24개월부터 86개월이 되기 전까지 매월 10만 원을 받아요. 농어촌 가정과 장애아동은 더 받아요 (이 계산에는 빠져 있어요).',
      who: '초등학교에 가지 않은 24개월 이상 86개월 미만 아이',
      how: '어린이집·유치원에 다니기 시작하면 멈추고, 보육료·유아학비 지원으로 바뀌어요.',
      src: ['careGuide']
    },
    childAllow: {
      name: '아동수당', short: '',
      what: '2026년에는 만 9세 미만 아이가 받아요. 법에 따라 받는 나이가 해마다 한 살씩 늘어 2030년부터는 13세 미만이 받아요. 수도권 10만 원, 비수도권 10.5만 원, 인구감소지역 11만 원(특별지역 12만 원)이고, 인구감소지역은 지역사랑상품권으로 받으면 1만 원을 더 줄 수 있어요 (지자체 조례가 있어야 해요).',
      who: '나이 기준에 맞는 모든 아이 (소득 상관없음)',
      how: '출생일을 포함해 60일 안에 신청하면 태어난 달부터 받아요. 복지로·정부24·주민센터·행복출산 원스톱에서 신청해요.',
      src: ['lawAllow', 'lawAllowDec', 'mohwAllow', 'regionNotice', 'gov24Allow']
    }
  };

  D.info.leave = {
    name: '육아휴직 급여', short: '',
    what: '회사원(고용보험)은 휴직 1~3개월 통상임금 100%(월 250만 원까지), 4~6개월 100%(월 200만 원까지), 7개월부터 80%(월 160만 원까지)를 받아요. 최소 월 70만 원이에요. 아이가 18개월이 되기 전에 부모가 모두 휴직을 시작하면(같이 써도, 차례로 써도 돼요), 둘이 같이 쓴 처음 6개월은 상한이 월 250·250·300·350·400·450만 원으로 올라가요. 한부모는 1~3개월 상한이 월 300만 원이에요.',
    who: '고용보험에 180일 이상 가입한 근로자 (30일 이상 휴직)',
    how: '휴직을 시작하고 1개월 뒤부터 고용24에서 매월 신청해요.',
    src: ['eiDecree', 'equalAct', 'moel66', 'gov24Leave']
  };
  D.leaveNotes = [
    '월급은 <b>휴직을 시작하는 날 기준 월 통상임금</b>으로 계산해요. 성과급처럼 매달 고정이 아닌 돈은 빼요.',
    '휴직 중에 회사에서 돈을 받아서 급여와 합한 금액이 통상임금보다 많으면, 넘는 만큼 급여에서 빼요.',
    '한 달이 안 되는 기간은 쉰 날수만큼 나눠서 줘요. 이 계산은 달 단위로만 했어요.',
    '육아휴직은 한 사람당 1년이고, 부모가 각각 3개월 이상 쓰거나 한부모면 6개월 더 쓸 수 있어요. 3번까지 나눠 쓸 수 있어요.',
    '신청은 휴직 시작 1개월 뒤부터 해요. 법에는 휴직이 끝나고 12개월 안이라고 되어 있지만, 시행규칙은 매달 다음 달 말일까지 신청하라고 해요. 매달 챙기는 게 안전해요.',
    '<b>공무원·교사·군인</b>은 고용보험 대신 공무원수당 규정의 육아휴직수당을 받아요. <b>월봉급액(호봉 봉급)</b>이 기준이고, 부모가 모두 휴직하면 <b>두 번째로 휴직한 사람</b>이 처음 6개월 상한이 올라가요 (아이 나이 조건 없음). 휴직은 3년까지 되지만 수당은 12개월(부모가 각각 3개월 이상 쓰거나 한부모면 18개월)만 나와요.',
    '부부 중 한 명은 회사원, 한 명은 공무원·교사여도 서로의 휴직을 인정해요. 회사원 쪽 6+6은 고용노동부 상담 답변 기준이에요 (배우자 휴직 증빙 제출).',
    '<b>자영업·프리랜서</b>는 육아휴직 급여가 없어요. 고용보험에 가입하지 않은 엄마는 <a href="https://www.gov.kr/portal/service/serviceInfo/149200000153" target="_blank" rel="noopener">출산급여 150만 원</a>(월 50만 원 × 3개월)을 받을 수 있어요.'
  ];

  // 할 일: when = 'pregnant'(태어나기 전만) | 'early'(태어나기 전 ~ 생후 90일) | 'under3'(3살 전) | 'birthYear'(태어난 해까지) | 'leave'(휴직 계획이 있을 때) | 'always'
  D.todos = [
    { id: 'preg-voucher', when: 'pregnant', first: true, title: '임신·출산 진료비(국민행복카드) 신청',
      body: '병원에서 임신확인서를 받아 신청하면 100만 원(다태아 140만 원 이상)을 진료비로 써요.', src: ['gov24Preg'] },
    { id: 'momcare', when: 'early', title: '산모·신생아 건강관리 지원 알아보기',
      body: '건강관리사가 집으로 와서 산모 회복과 신생아 돌봄을 도와주는 바우처예요. 소득 기준(기준중위소득 150% 이하 등)이 있고, 시·도에 따라 넓혀 주기도 해요.', src: ['mohwMomBaby'] },
    { id: 'birth-report', when: 'always', dueMonths: 1, title: '출생신고 + 행복출산 원스톱 신청',
      body: '출생신고는 태어나고 1개월 안에 해야 해요. 이때 첫만남이용권·부모급여·아동수당·양육수당·전기요금 할인 등을 한 번에 신청할 수 있어요 (임신 진료비, 산모·신생아 건강관리는 따로 신청).', src: ['lawFamily', 'gov24OneStop'] },
    { id: 'apply-60', when: 'always', dueDays: 59, title: '부모급여·아동수당 신청 (출생일 포함 60일 안)',
      body: '이 날까지 신청하면 태어난 달부터 소급해서 받아요. 60일이 지나면 태어난 달부터 소급받을 수 없어요.', src: ['lawAllow', 'gov24Parent'] },
    { id: 'electric', when: 'under3', title: '출산가구 전기요금 할인 신청',
      body: '태어난 날부터 3년이 안 된 아이가 있는 집은 주택용 전기요금을 30% 깎아 줘요 (월 1만 6천 원까지). 한전ON, 123 전화, 주민센터, 행복출산 원스톱에서 신청해요.', src: ['gov24Elec'] },
    { id: 'first-meet-use', when: 'always', dueMonths: 24, dueAdjDays: -1, title: '첫만남이용권 기한 안에 다 쓰기',
      body: '태어난 날부터 2년 안에 써야 해요. 남은 금액이 있으면 없어져요.', src: ['gov24First'] },
    { id: 'leave-apply', when: 'leave', title: '육아휴직 급여 매달 신청하기',
      body: '휴직을 시작하고 1개월이 지나면 고용24에서 신청해요. 시행규칙은 매달 다음 달 말일까지 신청하라고 하니 매달 챙겨요.', src: ['eiAct', 'gov24Leave'] },
    { id: 'tax-birth', when: 'birthYear', title: '연말정산 때 출산 세액공제 챙기기',
      body: '아이가 태어난 해의 연말정산(다음 해 1~2월)에 첫째 30만 원, 둘째 50만 원, 셋째 이상 70만 원을 세금에서 빼 줘요.', src: ['lawTax'] }
  ];

  D.notIncluded = [
    '<b>우리 동네 출산지원금·축하금</b> – 시·군·구마다 달라요. <a href="https://plus.gov.kr/portal/benefitV2/" target="_blank" rel="noopener">정부24 혜택알리미</a>에서 확인해요.',
    '<b>육아휴직 급여</b> – 휴직 탭에서 계획을 넣으면 합계에 더할 수 있어요.',
    '<b>어린이집·유치원 비용 지원</b> – 보육료·유아학비는 기관으로 바로 가요.',
    '<b>출산가구 전기요금 할인</b> – 30%, 월 1만 6천 원까지 (할 일 탭 참고).',
    '<b>세금 공제</b> – 출산 세액공제 등.',
    '<b>농어촌·장애아동 양육수당 추가분, 다태아 추가분</b>'
  ];

  D.about =
    '<p style="margin:0 0 8px"><b>받을돈은 정부·공공기관 앱이 아니에요.</b> 법령, 보건복지부, 정부24 같은 공식 자료를 ' + D.asOf.replace(/-/g, '.') +
    ' 기준으로 정리해서 계산한 <b>예상 금액</b>이에요. 실제로 받을 수 있는지와 금액은 복지로·정부24·주민센터에서 꼭 확인하세요.</p>' +
    '<p style="margin:0 0 8px">입력한 정보는 이 폰에만 저장되고 어디에도 보내지 않아요.</p>' +
    '<p style="margin:0"><b>출처</b><br>' + Object.keys(D.src).map(function (k) {
      return '<a class="src" href="' + D.src[k].url + '" target="_blank" rel="noopener">' + D.src[k].label + '</a>';
    }).join(' · ') + '</p>';
  D.footer = '정부 앱이 아니에요 · 공식 자료 ' + D.asOf.replace(/-/g, '.') + ' 기준 예상 금액';

  // 보건복지부고시 제2026-59호 「아동수당 추가지급 대상지역 고시」 별표 1(인구감소지역 우대·특별)·별표 2(비수도권)에서 그대로 옮김.
  // 광주광역시·전라남도는 2026.7.1부터 전남광주통합특별시 (시·군·구 이름은 그대로). 수도권(서울·인천·경기)은 인구감소지역만 따로 적음.
  // 인구감소지역은 5년마다 다시 지정해요(첫 지정 2021.10). 새 지정이 나오면 이 고시가 바뀌는지 확인할 것.
  D.regions = {
    order: ["서울특별시", "부산광역시", "대구광역시", "인천광역시", "대전광역시", "울산광역시", "세종특별자치시", "경기도", "강원특별자치도", "충청북도", "충청남도", "전북특별자치도", "전남광주통합특별시", "경상북도", "경상남도", "제주특별자치도"],
    sido: {
      "서울특별시": { metro: true, sgg: {} },
      "부산광역시": { metro: false, sgg: {"강서구": "nonmetro", "금정구": "nonmetro", "기장군": "nonmetro", "남구": "nonmetro", "동구": "depopPref", "동래구": "nonmetro", "부산진구": "nonmetro", "북구": "nonmetro", "사상구": "nonmetro", "사하구": "nonmetro", "서구": "depopPref", "수영구": "nonmetro", "연제구": "nonmetro", "영도구": "depopPref", "중구": "nonmetro", "해운대구": "nonmetro"} },
      "대구광역시": { metro: false, sgg: {"군위군": "depopPref", "남구": "depopPref", "달서구": "nonmetro", "달성군": "nonmetro", "동구": "nonmetro", "북구": "nonmetro", "서구": "depopPref", "수성구": "nonmetro", "중구": "nonmetro"} },
      "인천광역시": { metro: true, sgg: {"강화군": "depopPref", "옹진군": "depopPref"} },
      "대전광역시": { metro: false, sgg: {"대덕구": "nonmetro", "동구": "nonmetro", "서구": "nonmetro", "유성구": "nonmetro", "중구": "nonmetro"} },
      "울산광역시": { metro: false, sgg: {"남구": "nonmetro", "동구": "nonmetro", "북구": "nonmetro", "울주군": "nonmetro", "중구": "nonmetro"} },
      "세종특별자치시": { metro: false, sgg: {} },
      "경기도": { metro: true, sgg: {"가평군": "depopPref", "연천군": "depopPref"} },
      "강원특별자치도": { metro: false, sgg: {"강릉시": "nonmetro", "고성군": "depopPref", "동해시": "nonmetro", "삼척시": "depopPref", "속초시": "nonmetro", "양구군": "depopSpecial", "양양군": "depopPref", "영월군": "depopPref", "원주시": "nonmetro", "인제군": "nonmetro", "정선군": "depopPref", "철원군": "depopPref", "춘천시": "nonmetro", "태백시": "depopPref", "평창군": "depopPref", "홍천군": "depopPref", "화천군": "depopSpecial", "횡성군": "depopPref"} },
      "충청북도": { metro: false, sgg: {"괴산군": "depopSpecial", "단양군": "depopSpecial", "보은군": "depopSpecial", "영동군": "depopSpecial", "옥천군": "depopPref", "음성군": "nonmetro", "제천시": "depopPref", "증평군": "nonmetro", "진천군": "nonmetro", "청주시": "nonmetro", "충주시": "nonmetro"} },
      "충청남도": { metro: false, sgg: {"계룡시": "nonmetro", "공주시": "depopPref", "금산군": "depopPref", "논산시": "depopPref", "당진시": "nonmetro", "보령시": "depopPref", "부여군": "depopSpecial", "서산시": "nonmetro", "서천군": "depopSpecial", "아산시": "nonmetro", "예산군": "depopPref", "천안시": "nonmetro", "청양군": "depopSpecial", "태안군": "depopPref", "홍성군": "nonmetro"} },
      "전북특별자치도": { metro: false, sgg: {"고창군": "depopSpecial", "군산시": "nonmetro", "김제시": "depopPref", "남원시": "depopPref", "무주군": "depopSpecial", "부안군": "depopSpecial", "순창군": "depopSpecial", "완주군": "nonmetro", "익산시": "nonmetro", "임실군": "depopSpecial", "장수군": "depopSpecial", "전주시": "nonmetro", "정읍시": "depopPref", "진안군": "depopSpecial"} },
      "전남광주통합특별시": { metro: false, sgg: {"강진군": "depopSpecial", "고흥군": "depopSpecial", "곡성군": "depopSpecial", "광양시": "nonmetro", "광주 광산구": "nonmetro", "광주 남구": "nonmetro", "광주 동구": "nonmetro", "광주 북구": "nonmetro", "광주 서구": "nonmetro", "구례군": "depopSpecial", "나주시": "nonmetro", "담양군": "depopPref", "목포시": "nonmetro", "무안군": "nonmetro", "보성군": "depopSpecial", "순천시": "nonmetro", "신안군": "depopSpecial", "여수시": "nonmetro", "영광군": "depopPref", "영암군": "depopPref", "완도군": "depopSpecial", "장성군": "depopSpecial", "장흥군": "depopSpecial", "진도군": "depopPref", "함평군": "depopSpecial", "해남군": "depopSpecial", "화순군": "depopPref"} },
      "경상북도": { metro: false, sgg: {"경산시": "nonmetro", "경주시": "nonmetro", "고령군": "depopPref", "구미시": "nonmetro", "김천시": "nonmetro", "문경시": "depopPref", "봉화군": "depopSpecial", "상주시": "depopSpecial", "성주군": "depopPref", "안동시": "depopPref", "영덕군": "depopSpecial", "영양군": "depopSpecial", "영주시": "depopPref", "영천시": "depopPref", "예천군": "nonmetro", "울릉군": "depopPref", "울진군": "depopPref", "의성군": "depopSpecial", "청도군": "depopSpecial", "청송군": "depopSpecial", "칠곡군": "nonmetro", "포항시": "nonmetro"} },
      "경상남도": { metro: false, sgg: {"거제시": "nonmetro", "거창군": "depopPref", "고성군": "depopSpecial", "김해시": "nonmetro", "남해군": "depopSpecial", "밀양시": "depopPref", "사천시": "nonmetro", "산청군": "depopPref", "양산시": "nonmetro", "의령군": "depopSpecial", "진주시": "nonmetro", "창녕군": "depopPref", "창원시": "nonmetro", "통영시": "nonmetro", "하동군": "depopSpecial", "함안군": "depopPref", "함양군": "depopSpecial", "합천군": "depopSpecial"} },
      "제주특별자치도": { metro: false, sgg: {"서귀포시": "nonmetro", "제주시": "nonmetro"} }
    }
  };
})(typeof module !== 'undefined' && module.exports ? require('./calc.js') : window.Money);
