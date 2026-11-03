const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const Cycle = require('../schedule-cycle.js');

test('starts with rest, early, late and repeats from the fixed anchor', () => {
  assert.equal(Cycle.anchorDate, '2026-11-03');
  const expected = [
    ['2026-11-03', '休息'],
    ['2026-11-04', '早班'],
    ['2026-11-05', '晚班'],
    ['2026-11-06', '休息'],
    ['2026-11-07', '早班'],
    ['2026-11-08', '晚班']
  ];
  for (const [date, shift] of expected) {
    const row = Cycle.record(date);
    assert.equal(row.shift, shift, date);
    assert.equal(row.rest, shift === '休息', date);
  }
});

test('continues across month and year boundaries without resetting', () => {
  const expected = [
    ['2026-11-30', '休息'],
    ['2026-12-01', '早班'],
    ['2026-12-02', '晚班'],
    ['2026-12-31', '早班'],
    ['2027-01-01', '晚班'],
    ['2027-01-02', '休息']
  ];
  for (const [date, shift] of expected) assert.equal(Cycle.record(date).shift, shift, date);
});

test('counts leap day as one ordinary day in the cycle', () => {
  assert.equal(Cycle.record('2028-02-28').shift, '晚班');
  assert.equal(Cycle.record('2028-02-29').shift, '休息');
  assert.equal(Cycle.record('2028-03-01').shift, '早班');
  assert.equal(Cycle.record('2028-03-02').shift, '晚班');
});

test('returns complete records without guessing working hours', () => {
  assert.deepEqual(Cycle.record('2026-11-04'), {
    person: 'manual:personal', name: '我的排班', date: '2026-11-04',
    shift: '早班', start: '', end: '', rest: false, post: '', location: '',
    overnight: false, source: 'cycle'
  });
  const row = Cycle.record('2026-11-05', { key: 'name:小岛', label: '小岛' });
  assert.equal(row.person, 'name:小岛');
  assert.equal(row.name, '小岛');
  row.shift = 'changed';
  assert.equal(Cycle.record('2026-11-05').shift, '晚班');
});

test('does not backfill history or accept invalid calendar dates', () => {
  for (const date of ['2026-11-02', '2025-01-01', '2026-02-29', '2027-02-29',
    '2026-11-31', '2026-13-01', '2026-00-01', '2026-11-00', '2026-11-32',
    '2026-1-1', '2026-11-03T00:00:00Z', '2026-11-03 ', '', null, undefined, 20261103]) {
    assert.equal(Cycle.record(date), null, String(date));
  }
});

test('browser reloads keep the same fixed anchor', () => {
  const source = fs.readFileSync(require.resolve('../schedule-cycle.js'), 'utf8');
  const first = {};
  const reloaded = {};
  vm.runInNewContext(source, first);
  vm.runInNewContext(source, reloaded);
  assert.equal(first.ScheduleCycle.anchorDate, '2026-11-03');
  assert.equal(reloaded.ScheduleCycle.record('2027-01-01').shift, first.ScheduleCycle.record('2027-01-01').shift);
});
