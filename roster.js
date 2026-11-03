const text = value => value == null ? '' : String(value).trim();
const pad = value => String(value).padStart(2, '0');
const aliases = {
  name: ['姓名', '员工姓名', '人员', '员工', 'name'],
  id: ['工号', '员工编号', '人员编号', 'employeeid'],
  date: ['日期', '排班日期', '工作日期', 'date'],
  shift: ['班次', '班别', '班次名称', 'shift'],
  start: ['上班时间', '开始时间', '上班', 'start'],
  end: ['下班时间', '结束时间', '下班', 'end'],
  post: ['岗位', '岗位名称', 'post'],
  location: ['地点', '工作地点', '位置', 'location']
};
function dateKey(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m || date.getUTCDate() !== d) return '';
  return `${y}-${pad(m)}-${pad(d)}`;
}
function parseDate(value, month) {
  if (value instanceof Date) return dateKey(value.getFullYear(), value.getMonth() + 1, value.getDate());
  if (typeof value === 'number' && value > 10000) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return dateKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  const v = text(value);
  let match = v.match(/^(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})(?:日)?(?:\s.*)?$/);
  if (match) return dateKey(+match[1], +match[2], +match[3]);
  if (!/^\d{4}-\d{2}$/.test(month || '')) return '';
  const [year, mon] = month.split('-').map(Number);
  match = v.match(/^(\d{1,2})[月/.-](\d{1,2})日?$/);
  if (match) return dateKey(year, +match[1], +match[2]);
  match = v.match(/^(\d{1,2})日?$/);
  return match ? dateKey(year, mon, +match[1]) : '';
}
function parseTime(value) {
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const mins = Math.round(value * 1440) % 1440;
    return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
  }
  const match = text(value).match(/^(\d{1,2})[:：](\d{2})(?::\d{2})?$/);
  return match && +match[1] < 24 && +match[2] < 60 ? `${pad(+match[1])}:${match[2]}` : '';
}
function isRest(shift) { return /^(休|休息|休假|轮休|公休|off)$/i.test(text(shift)); }
function columns(header) {
  const result = {};
  Object.keys(aliases).forEach(key => {
    result[key] = header.findIndex(v => aliases[key].includes(text(v).replace(/\s/g, '').toLowerCase()));
  });
  return result;
}
function detect(rows, month) {
  let best = null;
  rows.slice(0, 30).forEach((row, header) => {
    const cols = columns(row);
    if (cols.name < 0) return;
    const dates = row.map((v, i) => i !== cols.name && i !== cols.id && !!parseDate(v, month)).filter(Boolean).length;
    const type = cols.date >= 0 ? 'list' : dates ? 'matrix' : '';
    if (!type) return;
    const score = type === 'list' ? 10 + Object.values(cols).filter(v => v >= 0).length : 10 + dates;
    if (!best || score > best.score) best = { header, type, cols, score };
  });
  return best;
}
function parseRows(rows, options) {
  const opts = options || {};
  const auto = detect(rows, opts.month);
  const header = opts.header == null ? (auto ? auto.header : -1) : opts.header;
  if (header < 0 || !rows[header]) throw new Error('未识别表头，请指定表头行、表格格式和姓名列。');
  const cols = Object.assign(columns(rows[header]), opts.cols || {});
  const type = opts.type || (auto && auto.type);
  if (cols.name < 0) throw new Error('请指定姓名列。');
  if (!['list', 'matrix'].includes(type)) throw new Error('请选择横向排班表或逐条记录表。');
  if (type === 'list' && (cols.date < 0 || (cols.shift < 0 && (cols.start < 0 || cols.end < 0)))) {
    throw new Error('逐条记录表需要日期列，以及班次列或上下班时间列。');
  }
  const records = [], warnings = [], people = {}, matrixPeople = new Set();
  function add(row, rowIndex, date, shift, start, end) {
    const name = text(row[cols.name]);
    if (!name) return;
    const id = cols.id >= 0 ? text(row[cols.id]) : '';
    const person = id ? `id:${id}` : `name:${name}`;
    people[person] = { key: person, name, id, label: id ? `${name}（${id}）` : name };
    records.push({ person, name, date, shift: shift || '值班', start, end,
      rest: isRest(shift), post: text(row[cols.post]), location: text(row[cols.location]), row: rowIndex + 1 });
  }
  const dateCols = type === 'matrix' ? rows[header].map((v, i) => ({ i, date: parseDate(v, opts.month) }))
    .filter(c => c.date && !Object.values(cols).includes(c.i)) : [];
  if (type === 'matrix' && !dateCols.length) throw new Error('未识别日期列。若表头只有 1、2、3，请先设置排班年月。');
  const datesSeen = new Set();
  dateCols.forEach(c => { if (datesSeen.has(c.date)) throw new Error(`日期表头重复：${c.date}，请整理后重新导入。`); datesSeen.add(c.date); });
  rows.slice(header + 1).forEach((row, offset) => {
    const index = header + 1 + offset;
    if (!text(row[cols.name]) || row.every(v => !text(v))) return;
    if (cols.id >= 0 && !text(row[cols.id])) {
      warnings.push(`第 ${index + 1} 行缺少工号，已跳过，请补充后重新导入`);
      return;
    }
    if (type === 'list') {
      const date = parseDate(row[cols.date], opts.month);
      if (!date) { warnings.push(`第 ${index + 1} 行日期无效，已跳过`); return; }
      const startRaw = row[cols.start], endRaw = row[cols.end];
      if ((text(startRaw) && !parseTime(startRaw)) || (text(endRaw) && !parseTime(endRaw))) {
        warnings.push(`第 ${index + 1} 行时间格式无效，请修正原表后导入`); return;
      }
      if (!text(row[cols.shift]) && !text(startRaw) && !text(endRaw)) return;
      add(row, index, date, text(row[cols.shift]), parseTime(startRaw), parseTime(endRaw));
    } else {
      const identity = cols.id >= 0 ? text(row[cols.id]) : text(row[cols.name]);
      if (matrixPeople.has(identity)) throw new Error(`横向表中的“${identity}”重复，请使用工号区分人员，并确保每人只有一行。`);
      matrixPeople.add(identity);
      dateCols.forEach(c => {
        const shift = text(row[c.i]);
        if (!shift) return;
        const range = shift.match(/^(\d{1,2}[:：]\d{2})\s*[-~～—至]\s*(\d{1,2}[:：]\d{2})$/);
        add(row, index, c.date, range ? '值班' : shift, range ? parseTime(range[1]) : '', range ? parseTime(range[2]) : '');
      });
    }
  });
  if (!records.length) throw new Error('没有找到有效班次，请检查表头、月份和列设置。');
  warnings.push('空白格不视为休息，也不会删除旧排班；休息请在原表中明确填写“休息”。');
  return { type, header, cols, records, people: Object.values(people), warnings };
}
function resolve(records, definitions) {
  return records.map(record => {
    const rule = definitions[record.shift] || {};
    const rest = record.rest || rule.rest === true;
    const result = Object.assign({}, record, {
      rest, start: rest ? '' : (record.start || parseTime(rule.start)),
      end: rest ? '' : (record.end || parseTime(rule.end)),
      post: record.post || text(rule.post), location: record.location || text(rule.location)
    });
    if (!rest && (!result.start || !result.end)) throw new Error(`请补充“${record.shift}”的上下班时间。`);
    if (!rest && result.start === result.end) throw new Error(`“${record.shift}”上下班时间相同，请核对。`);
    result.overnight = !rest && result.end < result.start;
    return result;
  });
}
function group(records) {
  const result = {};
  records.forEach(r => { (result[r.date] || (result[r.date] = [])).push(r); });
  return result;
}
function signature(records) {
  return records.map(r => JSON.stringify([r.shift, r.start, r.end, r.rest, r.post, r.location])) .sort().join('|');
}
function mergeRoster(previous, incoming) {
  if (!incoming.length) throw new Error('没有选中人员的有效排班。');
  const person = incoming[0].person;
  if (incoming.some(r => r.person !== person) || previous.some(r => r.person !== person)) throw new Error('不能混合不同人员的排班。');
  const old = group(previous), next = group(incoming), changes = [];
  Object.keys(next).sort().forEach(date => {
    const seen = new Set();
    next[date].forEach(r => {
      const key = signature([r]);
      if (seen.has(key)) throw new Error(`${date} 存在重复班次，请检查原表。`);
      seen.add(key);
    });
    if (next[date].some(r => r.rest) && next[date].length > 1) throw new Error(`${date} 同时存在休息和值班，请检查原表。`);
    if (signature(old[date] || []) !== signature(next[date])) changes.push({ date, kind: old[date] ? '修改' : '新增', before: old[date] || [], after: next[date] });
  });
  return { records: previous.filter(r => !next[r.date]).concat(incoming).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)), changes };
}
const rosterAPI = { parseDate, parseTime, detect, columns, parseRows, resolve, mergeRoster, isRest };

if (typeof module !== 'undefined' && module.exports) module.exports = rosterAPI; else globalThis.Roster = rosterAPI;
