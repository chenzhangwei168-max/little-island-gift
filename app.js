(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const R = window.Roster;
  const Store = window.ScheduleStore;
  const Calendar = window.CalendarInfo;
  const Cycle = window.ScheduleCycle;
  const STORAGE = 'little-island-roster-v1';
  const NOTE = 'little-island-note-v1';
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const todayKey = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const shiftDate = (key, n) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const weekday = key => ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][new Date(`${key}T00:00:00Z`).getUTCDay()];
  const shortDate = key => `${+key.slice(5, 7)}月${+key.slice(8)}日`;
  const timeLabel = r => r.rest ? '全天休息' : !r.start || !r.end ? '上下班时间待设置' : `${r.start} – ${r.end}${r.overnight ? '（次日）' : ''}`;
  const describe = records => records.map(r => `${r.shift} ${timeLabel(r)}${r.post ? ` · ${r.post}` : ''}${r.location ? ` · ${r.location}` : ''}`).join('；') || '无记录';
  let db = { profiles: [], activeKey: '', nickname: '' };
  let storageWarning = false;
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE) || 'null');
    if (stored && Array.isArray(stored.profiles)) db = Object.assign(db, stored);
  } catch { storageWarning = true; }
  db.profiles = db.profiles.map(Store.normalize);
  // Keep the personal cycle with its owner when switching between imported people.
  db.cycleProfileKey = db.cycleProfileKey || db.activeKey || db.profiles[0]?.key || 'manual:personal';
  let selectedDate = todayKey();
  let viewMonth = selectedDate.slice(0, 7);
  let demo = null;
  let toastTimer, bubbleTimer;
  let workbook = null, rows = null, cols = {}, parsed = null, rules = [], pending = null;
  let fileName = '', readSequence = 0;
  let pendingSourceKey = '', manualBase = null, manualRows = [];
  let menuDate = '';
  const fields = { name: '姓名', id: '工号', date: '日期', shift: '班次', start: '上班时间', end: '下班时间', post: '岗位', location: '地点' };
  function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3800); }
  function saveDB(next) {
    try { localStorage.setItem(STORAGE, JSON.stringify(next)); db = next; return true; }
    catch { toast('保存失败，请检查浏览器的存储权限或可用空间。'); return false; }
  }
  function profile() { return demo || db.profiles.find(p => p.key === db.activeKey) || db.profiles[0] || newPersonalProfile(); }
  function usesCycle(p) { return !demo && p.key === db.cycleProfileKey; }
  function recordsForDay(p, date) {
    const saved = p.records.filter(r => r.date === date);
    if (saved.length || !usesCycle(p)) return saved;
    const automatic = Cycle.record(date, p);
    return automatic ? [automatic] : [];
  }
  function dayRecords(date) { return recordsForDay(profile(), date); }
  function renderGreeting() {
    const name = db.nickname && String(db.nickname).trim();
    $('greeting').textContent = name ? `嗨，${name}，欢迎回到你的小岛。` : '嗨，欢迎回到你的小岛。';
    $('header-date').textContent = `${todayKey().slice(5).replace('-', ' / ')} · ${weekday(todayKey())}`;
    $('note-date').textContent = todayKey().replaceAll('-', ' / ');
  }
  function renderSummary(container, records) {
    if (!records.length) { container.innerHTML = '<h3>还没有安排</h3><p class="shift-time">给忙碌留一点从容</p><p class="shift-place">自己选时间，或从 Excel 导入</p>'; return; }
    container.innerHTML = records.map(r => `<div><h3>${esc(r.shift)}</h3><p class="shift-time">${esc(timeLabel(r))}</p><p class="shift-place">${esc(r.rest ? '把时间留给喜欢的事' : r.source === 'cycle' ? '上二休一 · 按三天循环' : `${r.post || '岗位未填写'} · ${r.location || '地点未填写'}`)}</p></div>`).join('');
  }
  function renderRest() {
    const p = profile();
    const savedDays = new Map();
    p.records.forEach(r => { if (!savedDays.has(r.date)) savedDays.set(r.date, []); savedDays.get(r.date).push(r); });
    let next = [...savedDays].filter(([date, records]) => date >= todayKey() && records.every(r => r.rest)).map(([date]) => ({ date })).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (usesCycle(p)) {
      let date = todayKey() < Cycle.anchorDate ? Cycle.anchorDate : todayKey();
      while (!Cycle.record(date, p).rest) date = shiftDate(date, 1);
      while (savedDays.has(date) && !savedDays.get(date).every(r => r.rest)) date = shiftDate(date, 3);
      if (!next || date < next.date) next = { date };
    }
    if (!next) { $('rest-countdown').innerHTML = '<span class="rest-empty">等一个悠闲的日子</span>'; return; }
    const days = Math.round((Date.parse(next.date) - Date.parse(todayKey())) / 86400000);
    $('rest-countdown').innerHTML = days ? `<strong>${days}</strong><small>天后休息</small>` : '<strong style="font-size:24px">今天休息</strong>';
  }
  function renderSchedule() {
    const p = profile();
    $('demo-banner').hidden = !demo;
    $('cycle-banner').hidden = !usesCycle(p);
    $('schedule-description').textContent = usesCycle(p) ? '已为你排好：早班 → 晚班 → 休息，每三天循环。' : '自己选时间，也可以从 Excel 导入。';
    $('person-name').textContent = p ? p.label : '我的排班';
    const manualCount = p ? Object.keys(p.manualOverrides || {}).length : 0;
    $('last-import').textContent = demo ? '示例内容 · 导入后换成你自己的排班' : `${p.fileName ? `最近导入 ${p.importedAt} · ${p.fileName}` : usesCycle(p) ? '上二休一 · 自动循环' : '自己安排每一天'}${manualCount ? ` · ${manualCount} 天手动排班` : ''}`;
    $('profile-picker-label').hidden = !!demo || db.profiles.length < 2;
    $('profile-select').innerHTML = db.profiles.map(p => `<option value="${esc(p.key)}">${esc(p.label)}</option>`).join('');
    if (p && !demo) $('profile-select').value = p.key;
    $('today-date').textContent = todayKey().slice(5).replace('-', '.');
    $('tomorrow-date').textContent = shiftDate(todayKey(), 1).slice(5).replace('-', '.');
    renderSummary($('today-summary'), dayRecords(todayKey()));
    renderSummary($('tomorrow-summary'), dayRecords(shiftDate(todayKey(), 1)));
    renderRest(); renderCalendar(); renderDay(); renderChanges();
  }
  function renderCalendar() {
    closeDateMenu();
    const [year, month] = viewMonth.split('-').map(Number);
    $('calendar-title').textContent = `${year}.${pad(month)}`;
    $('calendar-subtitle').textContent = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'][month - 1];
    const first = `${viewMonth}-01`;
    const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
    const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const total = Math.ceil((offset + count) / 7) * 7;
    const p = profile();
    const changed = new Set(p ? (p.changes || []).filter(c => c.kind === '修改').map(c => c.date) : []);
    const buttons = [];
    for (let i = 0; i < total; i++) {
      const key = shiftDate(first, i - offset), records = dayRecords(key);
      const info = Calendar.get(key);
      const rest = records.length && records.every(r => r.rest);
      const label = records.map(r => r.rest ? 'OFF' : `${r.shift} ${timeLabel(r)}`).join(' / ');
      const shifts = records.length ? records.map(r => r.rest ? '<span class="calendar-off">OFF</span>' : !r.start || !r.end ? `<span class="calendar-time"><span>${esc(r.shift)}</span></span>` : `<span class="calendar-time"><span>${esc(r.start)}</span><span>–${esc(r.end)}</span>${r.overnight ? '<small class="calendar-overnight">次日</small>' : ''}</span>`).join('') : '<span class="calendar-unset">未设置</span>';
      const classes = ['calendar-day', key.slice(0, 7) !== viewMonth ? 'other-month' : '', key === todayKey() ? 'is-today' : '', key === selectedDate ? 'is-selected' : '', rest ? 'has-rest' : records.length ? 'has-work' : '', changed.has(key) ? 'has-change' : ''].filter(Boolean).join(' ');
      buttons.push(`<button class="${classes}" data-date="${key}" title="${esc([info.lunar, ...info.labels, label].filter(Boolean).join(' · '))}" aria-label="${key} ${esc(label || '暂无记录')} ${esc(info.labels.join(' '))}" aria-pressed="${key === selectedDate}" aria-haspopup="menu" aria-expanded="false" aria-controls="date-menu"${key === todayKey() ? ' aria-current="date"' : ''}><span class="day-number">${+key.slice(8)}</span><span class="day-festival ${info.festivals.length ? 'is-festival' : ''}">${esc(info.label) || '&nbsp;'}</span><span class="calendar-shifts">${shifts}</span></button>`);
    }
    $('calendar-grid').innerHTML = buttons.join('');
  }
  function renderDay() {
    $('selected-date-title').textContent = shortDate(selectedDate);
    const info = Calendar.get(selectedDate);
    $('selected-weekday').textContent = `${weekday(selectedDate)} · ${info.lunar}${info.labels.length ? ` · ${info.labels.join(' / ')}` : ''}${selectedDate === todayKey() ? ' · 今天' : ''}`;
    const records = dayRecords(selectedDate);
    $('selected-shifts').innerHTML = (records.length ? records.map(r => `<article class="day-shift"><h4>${esc(r.shift)}${r.source === 'manual' ? '<span class="manual-badge">手动</span>' : r.source === 'cycle' ? '<span class="manual-badge">循环</span>' : ''}</h4><div class="detail-time">${esc(timeLabel(r))}</div>${r.rest ? '<div class="detail-line">睡个好觉，做点喜欢的事。</div>' : r.source === 'cycle' ? '<div class="detail-line">上二休一，忙完这一班，也记得照顾自己。</div>' : `<div class="detail-line"><span>岗位</span><span>${esc(r.post || '未填写')}</span></div><div class="detail-line"><span>地点</span><span>${esc(r.location || '未填写')}</span></div>`}</article>`).join('') : '<div class="empty-day">这一天还没有排班记录。<br>选好时间，就替你记在这里。</div>') + `<button class="button secondary full-button" data-action="manual">${records.length ? '编辑这一天' : '为这一天排班'}</button>`;
  }
  function renderChanges() {
    const p = profile(), changes = p ? p.changes || [] : [];
    $('changes-panel').hidden = !changes.length || !!demo;
    const modified = changes.filter(c => c.kind === '修改').length;
    $('change-count').textContent = changes.length ? `${modified} 天修改 · ${changes.length - modified} 天新增 ＋` : '本次没有变化';
    $('changes-list').innerHTML = changes.map(c => `<article class="change-row"><strong>${esc(c.date)} · ${esc(c.kind)}</strong><p>原：${esc(describe(c.before))}</p><div>现：${esc(describe(c.after))}</div></article>`).join('') || '<p class="form-hint">这次导入与已保存的排班一致。</p>';
  }
  function moveMonth(n) {
    const [year, month] = viewMonth.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1 + n, 1));
    viewMonth = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
    renderCalendar();
  }
  $('prev-month').addEventListener('click', () => moveMonth(-1));
  $('next-month').addEventListener('click', () => moveMonth(1));
  $('calendar-today').addEventListener('click', () => { selectedDate = todayKey(); viewMonth = selectedDate.slice(0, 7); renderCalendar(); renderDay(); });
  $('calendar-grid').addEventListener('click', event => {
    const button = event.target.closest('[data-date]'); if (!button) return;
    event.stopPropagation();
    const wasOpen = menuDate === button.dataset.date && !$('date-menu').hidden;
    selectedDate = button.dataset.date; viewMonth = selectedDate.slice(0, 7); renderCalendar(); renderDay();
    if (!wasOpen) openDateMenu(selectedDate); else focusSelectedDate();
  });
  function focusSelectedDate() { $('calendar-grid').querySelector(`[data-date="${selectedDate}"]`)?.focus({ preventScroll: true }); }
  function closeDateMenu(restoreFocus = false) {
    if (menuDate) $('calendar-grid').querySelector(`[data-date="${menuDate}"]`)?.setAttribute('aria-expanded', 'false');
    $('date-menu').hidden = true; menuDate = '';
    if (restoreFocus) focusSelectedDate();
  }
  function openDateMenu(date) {
    const anchor = $('calendar-grid').querySelector(`[data-date="${date}"]`);
    if (!anchor) return;
    menuDate = date;
    const records = dayRecords(date), off = records.length && records.every(r => r.rest);
    $('date-menu-title').textContent = `${shortDate(date)} · ${weekday(date)}`;
    $('date-menu-current').textContent = off ? '当前：OFF' : records.length ? `当前：${records.map(r => `${r.shift} · ${timeLabel(r)}`).join(' / ')}` : '选择这一天的安排';
    $('date-off-check').hidden = !off;
    const menu = $('date-menu'); menu.hidden = false;
    const rect = anchor.getBoundingClientRect(), width = menu.offsetWidth, height = menu.offsetHeight;
    menu.style.left = `${Math.max(10, Math.min(rect.left + rect.width / 2 - width / 2, document.documentElement.clientWidth - width - 10))}px`;
    const below = rect.bottom + 7;
    const top = below + height > window.innerHeight - 10 ? Math.max(10, rect.top - height - 7) : below;
    menu.style.top = `${top}px`;
    anchor.setAttribute('aria-expanded', 'true');
    $('date-work').focus({ preventScroll: true });
  }
  document.addEventListener('click', event => { if (!$('date-menu').hidden && !event.target.closest('#date-menu') && !event.target.closest('#calendar-grid [data-date]')) closeDateMenu(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('date-menu').hidden) { event.preventDefault(); closeDateMenu(true); } });
  $('date-menu').addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); (document.activeElement === $('date-work') ? $('date-off') : $('date-work')).focus({ preventScroll: true }); }
    if (event.key === 'Tab') closeDateMenu(true);
  });
  window.addEventListener('resize', () => closeDateMenu());
  window.addEventListener('scroll', () => closeDateMenu(), { passive: true });
  $('date-work').addEventListener('click', () => { closeDateMenu(); openManual('work'); });
  $('date-off').addEventListener('click', () => {
    if (demo) { demo = null; renderSchedule(); }
    const base = profile() || newPersonalProfile();
    try {
      const off = { person: base.key, name: base.label, date: selectedDate, shift: 'OFF', start: '', end: '', rest: true, post: '', location: '' };
      if (saveManualDay(base, selectedDate, [off])) { closeDateMenu(); focusSelectedDate(); toast(`${shortDate(selectedDate)}已设为 OFF，原导入记录已保留。`); }
    } catch (err) { toast(err.message); }
  });
  $('profile-select').addEventListener('change', event => { if (saveDB(Object.assign({}, db, { activeKey: event.target.value }))) renderSchedule(); });
  $('demo-button').addEventListener('click', () => {
    const records = [];
    for (let offset = -12; offset < 25; offset++) {
      const i = ((offset + 12) % 3), rest = i === 2;
      records.push({ person: 'demo', name: '小岛体验员', date: shiftDate(todayKey(), offset), shift: ['早班', '晚班', '休息'][i], start: rest ? '' : i ? '14:00' : '05:00', end: rest ? '' : i ? '22:00' : '14:00', rest, overnight: false, post: rest ? '' : '示例岗位', location: rest ? '' : '示例航站楼' });
    }
    demo = { label: '小岛体验员 · 示例', records, changes: [] };
    selectedDate = todayKey(); viewMonth = selectedDate.slice(0, 7); renderSchedule(); toast('这是示例排班，你的真实记录没有变化。');
  });
  $('exit-demo').addEventListener('click', () => { demo = null; renderSchedule(); });
  let helloIndex = 0;
  function sayHello() {
    const messages = ['嗨，今天也要照顾好自己呀 ♡', '忙完这一班，就给自己一个拥抱。', '记得喝水，也记得开心。', '小岛一直在，随时欢迎你回来。'];
    clearTimeout(bubbleTimer); $('character-bubble').textContent = messages[helloIndex++ % messages.length]; $('character-bubble').hidden = false;
    $('character').classList.remove('say-hi'); void $('character').offsetWidth; $('character').classList.add('say-hi');
    bubbleTimer = setTimeout(() => { $('character-bubble').hidden = true; $('character').classList.remove('say-hi'); }, 3300);
  }
  $('character').addEventListener('click', sayHello); $('say-hi').addEventListener('click', sayHello);
  document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
  function openImport() { $('import-dialog').showModal(); }
  $('open-import').addEventListener('click', openImport);
  $('selected-shifts').addEventListener('click', event => { if (event.target.closest('[data-action="manual"]')) openManual(); });
  $('open-manual').addEventListener('click', openManual);
  function newManualRow() { return { shift: '值班', start: '', end: '', rest: false, post: '', location: '' }; }
  function newPersonalProfile() { return Store.normalize({ key: 'manual:personal', label: db.nickname || '我的排班', records: [], definitions: {}, changes: [] }); }
  function openManual(mode) {
    closeDateMenu();
    if (demo) { demo = null; renderSchedule(); }
    manualBase = profile() || newPersonalProfile();
    $('manual-person').textContent = `${manualBase.label} · 可以自行选择日期和时间`;
    $('manual-date').value = selectedDate;
    loadManualDay();
    if (mode === 'work' && manualRows.every(r => r.rest)) { manualRows = [newManualRow()]; renderManualRows(); }
    $('manual-dialog').showModal();
    if (mode === 'work') $('manual-shifts').querySelector('input[data-field="start"]')?.focus({ preventScroll: true });
  }
  function loadManualDay() {
    const date = $('manual-date').value;
    if (!R.parseDate(date)) return;
    manualRows = recordsForDay(manualBase, date).map(r => Object.assign({}, r));
    if (!manualRows.length) manualRows = [newManualRow()];
    const info = Calendar.get(date);
    $('manual-calendar-info').textContent = `${weekday(date)} · ${info.lunar}${info.labels.length ? ` · ${info.labels.join(' / ')}` : ''}`;
    $('manual-error').hidden = true; renderManualRows();
  }
  function renderManualRows() {
    $('manual-shifts').innerHTML = manualRows.map((r, i) => `<div class="manual-entry"><div class="rule-title"><strong>第 ${i + 1} 段安排</strong>${manualRows.length > 1 ? `<button type="button" class="text-button" data-remove="${i}">移除这段</button>` : ''}</div><div class="rule-grid"><label>班次名称<input data-manual="${i}" data-field="shift" maxlength="40" value="${esc(r.shift)}" required></label><label class="manual-rest"><span>休息日</span><input type="checkbox" data-manual="${i}" data-field="rest"${r.rest ? ' checked' : ''}></label>${r.rest ? '' : `<label>上班时间<input type="time" data-manual="${i}" data-field="start" value="${esc(r.start)}" required></label><label>下班时间<input type="time" data-manual="${i}" data-field="end" value="${esc(r.end)}" required></label>`}<label>岗位（选填）<input data-manual="${i}" data-field="post" maxlength="80" value="${esc(r.post)}"></label><label>地点（选填）<input data-manual="${i}" data-field="location" maxlength="80" value="${esc(r.location)}"></label></div></div>`).join('');
  }
  $('manual-date').addEventListener('change', loadManualDay);
  $('manual-shifts').addEventListener('input', event => {
    const input = event.target;
    if (!input.dataset.field) return;
    const r = manualRows[+input.dataset.manual];
    r[input.dataset.field] = input.type === 'checkbox' ? input.checked : input.value;
    if (input.dataset.field === 'rest') { if (r.rest) r.shift = '休息'; else if (R.isRest(r.shift)) r.shift = '值班'; renderManualRows(); }
  });
  $('manual-shifts').addEventListener('click', event => {
    const button = event.target.closest('[data-remove]');
    if (button && manualRows.length > 1) { manualRows.splice(+button.dataset.remove, 1); renderManualRows(); }
  });
  $('manual-add').addEventListener('click', () => {
    if (manualRows.some(r => r.rest)) { toast('休息日保留一条安排即可；如要值班，请先取消休息日。'); return; }
    manualRows.push(newManualRow()); renderManualRows();
  });
  function saveManualDay(base, date, rows) {
    const next = Store.editDay(base, date, rows.map(r => Object.assign({}, r, { person: base.key, name: base.label, date, shift: r.shift.trim() })));
    const profiles = db.profiles.slice(), index = profiles.findIndex(p => p.key === next.key);
    if (index >= 0) profiles[index] = next; else profiles.push(next);
    if (!saveDB(Object.assign({}, db, { profiles, activeKey: next.key }))) return false;
    selectedDate = date; viewMonth = date.slice(0, 7); renderSchedule();
    return true;
  }
  $('manual-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const date = $('manual-date').value;
      if (!R.parseDate(date)) throw new Error('请选择有效日期。');
      if (manualRows.some(r => !r.shift.trim())) throw new Error('请填写班次名称。');
      if (!saveManualDay(manualBase, date, manualRows)) return;
      $('manual-dialog').close(); focusSelectedDate(); toast('这一天的排班收好了，导入原记录也还在。');
    } catch (err) { $('manual-error').textContent = err.message; $('manual-error').hidden = false; }
  });
  $('open-history').addEventListener('click', () => {
    const p = demo ? db.profiles.find(p => p.key === db.activeKey) || db.profiles[0] : profile();
    const history = p ? Store.normalize(p).importHistory : [];
    $('history-content').innerHTML = history.length ? history.slice().reverse().map((batch, i) => `<details class="history-batch"${i === 0 ? ' open' : ''}><summary><strong>${esc(batch.fileName)}</strong><span>${esc(batch.importedAt)} · ${batch.records.length} 条原排班</span></summary><div class="preview-scroll"><table><thead><tr><th>日期</th><th>班次</th><th>时间</th><th>岗位 / 地点</th></tr></thead><tbody>${batch.records.map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.shift)}</td><td>${esc(timeLabel(r))}</td><td>${esc(`${r.post || '—'} / ${r.location || '—'}`)}</td></tr>`).join('')}</tbody></table></div></details>`).join('') : '<p class="form-hint">还没有导入记录。手动填写也能使用排班日历，之后随时可以导入 Excel。</p>';
    $('history-dialog').showModal();
  });
  function openName() { $('nickname').value = db.nickname || ''; $('name-dialog').showModal(); $('nickname').focus(); }
  $('customize').addEventListener('click', openName); $('date-pill').addEventListener('click', openName);
  $('name-form').addEventListener('submit', event => { event.preventDefault(); if (saveDB(Object.assign({}, db, { nickname: $('nickname').value.trim().slice(0, 16) }))) { renderGreeting(); $('name-dialog').close(); toast('小岛记住你的名字啦。'); } });
  try { $('note-text').value = localStorage.getItem(NOTE) || ''; } catch { storageWarning = true; }
  $('note-text').addEventListener('input', () => { $('note-state').textContent = '还有心情没收好，记得点保存'; });
  $('save-note').addEventListener('click', () => {
    try { localStorage.setItem(NOTE, $('note-text').value); $('note-state').textContent = '收好了，留给以后的你 ♡'; toast('这份心情，已经替你收好了。'); }
    catch { toast('小纸条保存失败，请检查浏览器存储设置。'); }
  });
  function invalidate() { pending = null; $('import-preview').hidden = true; $('confirm-check').checked = false; $('confirm-import').disabled = true; }
  function error(message) { $('import-error').textContent = message; $('import-error').hidden = !message; }
  async function readFile(file) {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) { error('请选择 .xlsx 或 .xls 格式的排班文件。'); return; }
    if (file.size > 10 * 1024 * 1024) { error('文件超过 10MB，请拆分工作表后再导入。'); return; }
    const sequence = ++readSequence;
    invalidate(); parsed = null; workbook = null; rows = null;
    $('import-config').hidden = true; $('file-label').textContent = '正在读取排班文件……'; error('');
    try {
      const bytes = await file.arrayBuffer();
      if (sequence !== readSequence) return;
      const next = XLSX.read(bytes, { type: 'array', cellDates: false });
      if (!next.SheetNames.length) throw new Error('文件中没有可读取的工作表。');
      if (next.Workbook?.WBProps?.date1904) throw new Error('暂不支持 1904 日期系统，请在 Excel 中改为 1900 日期系统后重试。');
      workbook = next; fileName = file.name;
      $('file-label').textContent = fileName;
      $('import-sheet').innerHTML = next.SheetNames.map((name, i) => `<option value="${i}">${esc(name)}</option>`).join('');
      $('import-month').value = todayKey().slice(0, 7);
      $('import-format').value = '';
      $('import-config').hidden = false; loadSheet();
    } catch (err) { if (sequence === readSequence) { error(`无法读取 Excel：${err.message}`); $('file-label').textContent = '重新选择 Excel 文件'; } }
  }
  $('excel-file').addEventListener('change', event => readFile(event.target.files[0]));
  $('dropzone').addEventListener('dragover', event => { event.preventDefault(); $('dropzone').classList.add('dragging'); });
  $('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('dragging'));
  $('dropzone').addEventListener('drop', event => { event.preventDefault(); $('dropzone').classList.remove('dragging'); readFile(event.dataTransfer.files[0]); });
  function loadSheet() {
    invalidate(); parsed = null; rows = null; $('person-config').hidden = true; $('parsed-info').textContent = '';
    try {
      const sheet = workbook.Sheets[workbook.SheetNames[+$('import-sheet').value]];
      const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
      if (range.e.r > 30000 || range.e.c > 1000) throw new Error('工作表范围过大，请删除多余空行列，或拆分后再导入。');
      rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: true });
      const detected = R.detect(rows, $('import-month').value);
      $('import-header').value = detected ? detected.header + 1 : 1;
      configureColumns();
    } catch (err) { error(err.message); }
  }
  function configureColumns() {
    invalidate();
    if (!rows) return;
    const header = Number($('import-header').value) - 1;
    if (!Number.isInteger(header) || header < 0 || !rows[header]) { parsed = null; $('person-config').hidden = true; error('请输入工作表范围内的表头行号。'); return; }
    cols = R.columns(rows[header]);
    $('column-fields').innerHTML = Object.keys(fields).map(key => `<label>${fields[key]}列<select data-col="${key}"><option value="-1">未设置</option>${rows[header].map((v, i) => `<option value="${i}"${cols[key] === i ? ' selected' : ''}>第${i + 1}列 · ${esc(v || '空表头')}</option>`).join('')}</select></label>`).join('');
    parse();
  }
  function parse() {
    invalidate(); parsed = null; $('person-config').hidden = true; $('parsed-info').textContent = ''; error('');
    try {
      if (!$('import-month').value) throw new Error('请先选择排班年月。');
      const occupied = Object.entries(cols).filter(([, value]) => value >= 0);
      if (new Set(occupied.map(([, value]) => value)).size < occupied.length) throw new Error('同一列被分配给了多个字段，请检查手动列设置。');
      parsed = R.parseRows(rows, { month: $('import-month').value, header: +$('import-header').value - 1, type: $('import-format').value, cols });
      $('parsed-info').textContent = `✓ 已识别${parsed.type === 'matrix' ? '横向排班表' : '逐条记录表'} · ${parsed.people.length} 位人员 · ${parsed.records.length} 条班次`;
      $('import-person').innerHTML = parsed.people.map((p, i) => `<option value="${i}">${esc(p.label)}</option>`).join('');
      const savedIndex = parsed.people.findIndex(p => p.key === db.activeKey);
      if (savedIndex >= 0) $('import-person').value = savedIndex;
      $('person-config').hidden = false;
      $('import-warnings').innerHTML = parsed.warnings.slice(0, 12).map(w => `<p>提示：${esc(w)}</p>`).join('') + (parsed.warnings.length > 12 ? `<p>另有 ${parsed.warnings.length - 12} 条提示，请检查原表无效行后导入。</p>` : '');
      prepareRules();
    } catch (err) { error(err.message); }
  }
  function selectedPerson() { return parsed && parsed.people[+$('import-person').value]; }
  function prepareRules() {
    invalidate();
    const person = selectedPerson();
    if (!person) return;
    const existing = db.profiles.find(p => p.key === person.key), definitions = existing ? existing.definitions : {};
    const mine = parsed.records.filter(r => r.person === person.key);
    rules = [...new Set(mine.map(r => r.shift))].map(shift => Object.assign({ shift, start: '', end: '', post: '', location: '', rest: R.isRest(shift) }, definitions[shift] || {}));
    const missing = mine.some(r => !r.rest && !rules.find(rule => rule.shift === r.shift)?.rest && (!r.start && !definitions[r.shift]?.start || !r.end && !definitions[r.shift]?.end));
    $('rule-hint').textContent = missing ? '有时间需要补充 ▾' : '按需补充 ▾';
    $('rule-details').open = missing;
    renderRules();
  }
  function renderRules() {
    $('shift-rules').innerHTML = rules.map((rule, i) => `<div class="shift-rule"><div class="rule-title"><strong>${esc(rule.shift)}</strong><label><input type="checkbox" data-rule="${i}" data-field="rest"${rule.rest ? ' checked' : ''}>休息日</label></div><div class="rule-grid">${rule.rest ? '' : `<label>上班时间<input type="time" data-rule="${i}" data-field="start" value="${esc(rule.start)}"></label><label>下班时间<input type="time" data-rule="${i}" data-field="end" value="${esc(rule.end)}"></label>`}<label>默认岗位（选填）<input data-rule="${i}" data-field="post" maxlength="80" value="${esc(rule.post)}" placeholder="例如：值机"></label><label>默认地点（选填）<input data-rule="${i}" data-field="location" maxlength="80" value="${esc(rule.location)}" placeholder="例如：T2 航站楼"></label></div></div>`).join('');
  }
  $('import-sheet').addEventListener('change', loadSheet);
  $('import-month').addEventListener('change', () => { if (rows) parse(); });
  $('import-format').addEventListener('change', () => { if (rows) parse(); });
  $('import-header').addEventListener('change', configureColumns);
  $('column-fields').addEventListener('change', event => { if (event.target.dataset.col) { cols[event.target.dataset.col] = +event.target.value; parse(); } });
  $('import-person').addEventListener('change', prepareRules);
  $('shift-rules').addEventListener('input', event => {
    const target = event.target;
    if (!target.dataset.field) return;
    const rule = rules[+target.dataset.rule];
    rule[target.dataset.field] = target.type === 'checkbox' ? target.checked : target.value;
    invalidate();
    if (target.type === 'checkbox') renderRules();
  });
  $('preview-import').addEventListener('click', () => {
    invalidate(); error('');
    try {
      if (!parsed || !selectedPerson()) throw new Error('请先选择并识别排班文件。');
      const person = selectedPerson(), definitions = Object.create(null);
      rules.forEach(rule => { definitions[rule.shift] = Object.assign({}, rule); });
      const incoming = R.resolve(parsed.records.filter(r => r.person === person.key), definitions);
      const old = db.profiles.find(p => p.key === person.key);
      const source = old || (db.profiles.length === 1 && db.profiles[0].key === 'manual:personal' ? db.profiles[0] : null);
      pending = Store.importBatch(source, person, incoming, definitions, { id: `import-${Date.now()}`, importedAt: todayKey(), fileName });
      pendingSourceKey = source ? source.key : '';
      const modified = pending.changes.filter(c => c.kind === '修改').length;
      $('preview-person').textContent = `${person.label} · ${incoming.length} 条排班`;
      const incomingDates = new Set(incoming.map(r => r.date));
      const preserved = Object.keys(pending.manualOverrides).filter(date => incomingDates.has(date)).length;
      $('preview-summary').textContent = `${pending.changes.length - modified} 天新增 · ${modified} 天修改${preserved ? ` · 保留 ${preserved} 天手动调整` : ''}`;
      $('preview-body').innerHTML = pending.records.filter(r => incomingDates.has(r.date)).map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.shift)}${r.source === 'manual' ? '（手动保留）' : ''}</td><td>${esc(timeLabel(r))}</td><td>${esc(r.rest ? '—' : `${r.post || '未填写'} / ${r.location || '未填写'}`)}</td></tr>`).join('');
      $('import-preview').hidden = false;
      $('import-preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { error(err.message); }
  });
  $('confirm-check').addEventListener('change', () => { $('confirm-import').disabled = !pending || !$('confirm-check').checked; });
  $('confirm-import').addEventListener('click', () => {
    if (!pending || !$('confirm-check').checked) return;
    const profiles = db.profiles.filter(p => !(pendingSourceKey === 'manual:personal' && p.key === pendingSourceKey && p.key !== pending.key)), index = profiles.findIndex(p => p.key === pending.key);
    if (index >= 0) profiles[index] = pending; else profiles.push(pending);
    const cycleProfileKey = db.cycleProfileKey === pendingSourceKey || (db.cycleProfileKey === 'manual:personal' && !pendingSourceKey) ? pending.key : db.cycleProfileKey;
    if (!saveDB(Object.assign({}, db, { profiles, activeKey: pending.key, cycleProfileKey }))) return;
    const firstDate = pending.records[0]?.date;
    if (!pending.records.some(r => r.date.slice(0, 7) === todayKey().slice(0, 7)) && firstDate) { selectedDate = firstDate; viewMonth = firstDate.slice(0, 7); }
    else { selectedDate = todayKey(); viewMonth = selectedDate.slice(0, 7); }
    demo = null; invalidate(); renderSchedule(); $('import-dialog').close();
    $('schedule').scrollIntoView({ behavior: 'smooth', block: 'start' }); toast('排班收好啦，接下来的日子心里有数。');
  });
  const nav = document.querySelectorAll('.site-header nav a');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) nav.forEach(a => a.classList.toggle('active', a.hash === `#${entry.target.id}`)); }, { rootMargin: '-15% 0px -55% 0px', threshold: 0 });
    for (const id of ['home', 'schedule', 'notes']) observer.observe($(id));
  }
  let lastToday = todayKey();
  function refreshDate() { if (todayKey() !== lastToday) { if (selectedDate === lastToday) { selectedDate = todayKey(); viewMonth = selectedDate.slice(0, 7); } lastToday = todayKey(); renderGreeting(); renderSchedule(); } }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDate(); });
  setInterval(refreshDate, 60000);
  renderGreeting(); renderSchedule();
  if (storageWarning) toast('暂时无法读取本地记录，请检查浏览器存储设置。');
})();

