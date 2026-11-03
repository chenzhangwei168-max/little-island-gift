(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScheduleCycle = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const anchorDate = '2026-11-03';
  const anchorTime = Date.parse(`${anchorDate}T00:00:00Z`);
  const dayLength = 86400000;
  const shifts = ['休息', '早班', '晚班'];

  function record(date, profile) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const time = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date || time < anchorTime) return null;
    const phase = Math.floor((time - anchorTime) / dayLength) % shifts.length;
    return {
      person: profile && profile.key || 'manual:personal',
      name: profile && profile.label || '我的排班',
      date,
      shift: shifts[phase],
      start: '',
      end: '',
      rest: phase === 0,
      post: '',
      location: '',
      overnight: false,
      source: 'cycle'
    };
  }

  return { anchorDate, record };
});
