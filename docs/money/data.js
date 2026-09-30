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

  // 할 일: when = 'pregnant'(태어나기 전만) | 'early'(태어나기 전 ~ 생후 90일) | 'under3'(3살 전) | 'birthYear'(태어난 해까지) | 'always'
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
    { id: 'tax-birth', when: 'birthYear', title: '연말정산 때 출산 세액공제 챙기기',
      body: '아이가 태어난 해의 연말정산(다음 해 1~2월)에 첫째 30만 원, 둘째 50만 원, 셋째 이상 70만 원을 세금에서 빼 줘요.', src: ['lawTax'] }
  ];

  D.notIncluded = [
    '<b>우리 동네 출산지원금·축하금</b> – 시·군·구마다 달라요. <a href="https://plus.gov.kr/portal/benefitV2/" target="_blank" rel="noopener">정부24 혜택알리미</a>에서 확인해요.',
    '<b>육아휴직 급여</b> – 고용보험에서 나와요.',
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
