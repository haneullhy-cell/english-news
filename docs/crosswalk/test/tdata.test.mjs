import test from 'node:test';
import assert from 'node:assert/strict';
import { mapState, normalizeRecord, findRecords, remapLegs, parseTs } from '../server/tdata.js';

test('상태 문자열 정리: J2735 이름과 한글 모두', () => {
  assert.equal(mapState('protected-Movement-Allowed'), 'green');
  assert.equal(mapState('permissive-Movement-Allowed'), 'green');
  assert.equal(mapState('protected-clearance'), 'flash');
  assert.equal(mapState('stop-And-Remain'), 'red');
  assert.equal(mapState('녹색'), 'green');
  assert.equal(mapState('녹색점멸'), 'flash');
  assert.equal(mapState('적색'), 'red');
  assert.equal(mapState('unavailable'), 'unknown');
  assert.equal(mapState(undefined), 'unknown');
});

test('응답 포장을 몰라도 교차로 기록을 찾아 정리한다', () => {
  const payload = { response: { header: { resultCode: '00' }, body: { items: { item: [{
    itstId: '1537', trsmUtcTime: 1759600000000,
    ntPdsgRmdrCs: 123, ntPdsgStatNm: 'protected-Movement-Allowed',
    etPdsgRmdrCs: 455, etPdsgStatNm: 'stop-And-Remain',
    stPdsgRmdrCs: '', stPdsgStatNm: '',
    wtPdsgStatNm: 'stop-And-Remain',
  }] } } } };
  const recs = findRecords(payload);
  assert.equal(recs.length, 1);
  const n = normalizeRecord(recs[0], 10);
  assert.equal(n.itstId, '1537');
  assert.deepEqual(n.legs.nt, { state: 'green', remain: 12.3 });
  assert.deepEqual(n.legs.et, { state: 'red', remain: 45.5 });
  assert.equal(n.legs.st, undefined);
  assert.deepEqual(n.legs.wt, { state: 'red', remain: null });
  assert.equal(n.ts, 1759600000);
});

test('legMap 으로 데모 횡단보도 이름을 바꿔 붙인다', () => {
  const legs = { nt: { state: 'green', remain: 5 }, et: { state: 'red', remain: 50 } };
  assert.deepEqual(remapLegs(legs, { xw: 'nt' }), { xw: { state: 'green', remain: 5 } });
  assert.equal(remapLegs(legs, null), legs);
});

test('전송 시각 해석: 밀리초, 초, YYYYMMDDHHmmss', () => {
  assert.equal(parseTs({ trsmUtcTime: 1759600000000 }), 1759600000);
  assert.equal(parseTs({ trsmUtcTime: 1759600000 }), 1759600000);
  assert.equal(parseTs({ trsmUtcTime: '20261005120000' }), Date.UTC(2026, 9, 5, 12) / 1000);
  assert.equal(parseTs({}), null);
});
