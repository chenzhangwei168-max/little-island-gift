(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./assets/lunar.js'));
  else root.CalendarInfo = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (lunarAPI) {
  const cache = new Map();
  const fixed = { '01-01': '元旦', '02-14': '情人节', '03-08': '妇女节', '03-12': '植树节', '05-01': '劳动节', '05-04': '青年节', '06-01': '儿童节', '09-10': '教师节', '10-01': '国庆节', '12-24': '平安夜', '12-25': '圣诞节' };
  function get(date) {
    if (cache.has(date)) return cache.get(date);
    const [year, month, day] = date.split('-').map(Number);
    const solar = lunarAPI.Solar.fromYmd(year, month, day), lunar = solar.getLunar();
    const festivals = lunar.getFestivals().slice();
    if (fixed[date.slice(5)]) festivals.push(fixed[date.slice(5)]);
    const week = Math.ceil(day / 7), weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (month === 5 && weekday === 0 && week === 2) festivals.push('母亲节');
    if (month === 6 && weekday === 0 && week === 3) festivals.push('父亲节');
    const term = lunar.getJieQi();
    const unique = [...new Set(festivals)];
    const info = { festivals: unique, term, lunar: `农历${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`, label: unique[0] || term || '', labels: [...unique, ...(term ? [term] : [])] };
    cache.set(date, info);
    return info;
  }
  return { get };
});
