(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./roster.js'));
  else root.ScheduleStore = factory(root.Roster);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Roster) {
  const copy = records => (records || []).map(r => Object.assign({}, r));
  const sort = records => records.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  function effective(imported, overrides) {
    return sort(copy(imported).filter(r => !Object.prototype.hasOwnProperty.call(overrides, r.date)).concat(...Object.values(overrides).map(copy)));
  }
  function normalize(profile) {
    const importedRecords = copy(profile.importedRecords || profile.records);
    const manualOverrides = Object.fromEntries(Object.entries(profile.manualOverrides || {}).map(([date, records]) => [date, copy(records)]));
    const importHistory = (profile.importHistory || (profile.fileName ? [{ id: 'legacy-import', fileName: profile.fileName, importedAt: profile.importedAt, records: copy(importedRecords) }] : [])).slice();
    return Object.assign({}, profile, { importedRecords, manualOverrides, importHistory, records: effective(importedRecords, manualOverrides) });
  }
  function editDay(profile, date, records) {
    const p = normalize(profile);
    if (!records.length || records.some(r => r.date !== date || r.person !== p.key)) throw new Error('请核对日期和排班人员。');
    const resolved = Roster.resolve(records, {});
    Roster.mergeRoster([], resolved);
    const overrides = Object.assign({}, p.manualOverrides, { [date]: resolved.map(r => Object.assign({}, r, { source: 'manual' })) });
    const changes = Roster.mergeRoster(p.records, resolved).changes;
    return Object.assign({}, p, { manualOverrides: overrides, records: effective(p.importedRecords, overrides), changes });
  }
  function importBatch(profile, person, incoming, definitions, metadata) {
    const p = normalize(profile || { key: person.key, label: person.label, records: [] });
    const transfer = p.key !== person.key;
    if (transfer && p.key !== 'manual:personal') throw new Error('不能将其他人员的排班合并到这里。');
    const imported = transfer ? [] : p.importedRecords;
    const overrides = Object.fromEntries(Object.entries(p.manualOverrides).map(([date, records]) => [date, records.map(r => Object.assign({}, r, { person: person.key, name: person.name }))]));
    const prior = transfer ? p.records.map(r => Object.assign({}, r, { person: person.key, name: person.name })) : p.records;
    const merged = Roster.mergeRoster(imported, incoming);
    const records = effective(merged.records, overrides);
    const touched = new Set(incoming.map(r => r.date));
    const changes = Roster.mergeRoster(prior, records.filter(r => touched.has(r.date))).changes;
    const batch = { id: metadata.id, fileName: metadata.fileName, importedAt: metadata.importedAt, records: copy(incoming) };
    return Object.assign({}, p, metadata, { key: person.key, label: person.label, definitions, importedRecords: merged.records, manualOverrides: overrides, records, changes, importHistory: p.importHistory.concat(batch) });
  }
  return { normalize, editDay, importBatch };
});
