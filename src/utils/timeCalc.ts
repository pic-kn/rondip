import { AppEvent, SleepSettings } from '../types';

export function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function calcAvailableMinutes(
  events: AppEvent[],
  sleepSettings: SleepSettings,
  dateStr: string,
  now: Date = new Date()
): number {
  const isToday = dateStr === toLocalDateStr(now);
  const [wH, wM] = sleepSettings.wakeTime.split(':').map(Number);
  const [bH, bM] = sleepSettings.bedTime.split(':').map(Number);
  const wakeTotal = wH * 60 + wM;
  const bedTotal = bH * 60 + bM;
  const startFrom = isToday
    ? Math.max(now.getHours() * 60 + now.getMinutes(), wakeTotal)
    : wakeTotal;
  const totalMinutes = Math.max(0, bedTotal - startFrom);

  // ルーティンは朝食・夕食のみカウント
  const blocks = events
    .filter(e => {
      if (e.date !== dateStr) return false;
      if (!e.id.startsWith('routine-')) return true;
      return e.id.startsWith('routine-breakfast') || e.id.startsWith('routine-dinner');
    })
    .map(e => {
      const [h, m] = e.timeString.split(':').map(Number);
      const start = h * 60 + m;
      return { start, end: start + (e.estimatedMinutes || 60) };
    })
    .sort((a, b) => a.start - b.start);

  // 重複するブロックをマージ
  const merged: { start: number; end: number }[] = [];
  for (const block of blocks) {
    if (merged.length > 0 && block.start <= merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, block.end);
    } else {
      merged.push({ ...block });
    }
  }

  const occupied = merged.reduce((sum, b) => sum + (b.end - b.start), 0);
  return Math.max(0, totalMinutes - occupied);
}
