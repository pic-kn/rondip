const nthMonday = (year: number, monthIndex: number, nth: number): number => {
  const first = new Date(year, monthIndex, 1).getDay();
  const offset = (8 - first) % 7;
  return 1 + offset + (nth - 1) * 7;
};

const vernalEquinoxDay = (year: number): number => {
  if (year <= 1979) return Math.floor(20.8357 + 0.242194 * (year - 1980) - Math.floor((year - 1983) / 4));
  if (year <= 2099) return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  return Math.floor(21.851 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
};

const autumnEquinoxDay = (year: number): number => {
  if (year <= 1979) return Math.floor(23.2588 + 0.242194 * (year - 1980) - Math.floor((year - 1983) / 4));
  if (year <= 2099) return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  return Math.floor(24.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
};

const fixedHolidayKeys = (year: number) => new Set([
  `${year}-01-01`,
  `${year}-02-11`,
  `${year}-02-23`,
  `${year}-04-29`,
  `${year}-05-03`,
  `${year}-05-04`,
  `${year}-05-05`,
  `${year}-08-11`,
  `${year}-11-03`,
  `${year}-11-23`,
  `${year}-03-${String(vernalEquinoxDay(year)).padStart(2, '0')}`,
  `${year}-09-${String(autumnEquinoxDay(year)).padStart(2, '0')}`,
  `${year}-01-${String(nthMonday(year, 0, 2)).padStart(2, '0')}`,
  `${year}-07-${String(nthMonday(year, 6, 3)).padStart(2, '0')}`,
  `${year}-09-${String(nthMonday(year, 8, 3)).padStart(2, '0')}`,
  `${year}-10-${String(nthMonday(year, 9, 2)).padStart(2, '0')}`,
]);

export const isJapaneseHoliday = (dateStr: string): boolean => {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return false;

  const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const base = fixedHolidayKeys(year);
  if (base.has(key)) return true;

  const date = new Date(`${key}T12:00:00`);
  const dayOfWeek = date.getDay();

  // 振替休日
  if (dayOfWeek === 1) {
    const prev = new Date(date);
    prev.setDate(prev.getDate() - 1);
    const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
    if (base.has(prevKey)) return true;
  }

  // 国民の休日
  const prev = new Date(date);
  prev.setDate(prev.getDate() - 1);
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
  const nextKey = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  return dayOfWeek !== 0 && dayOfWeek !== 6 && base.has(prevKey) && base.has(nextKey);
};
