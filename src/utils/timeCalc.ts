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
  const crossesMidnight = bedTotal < wakeTotal;
  const nowTotal = now.getHours() * 60 + now.getMinutes();
  const windowStart = isToday ? Math.max(nowTotal, wakeTotal) : wakeTotal;

  let totalMinutes: number;
  let windowEnd: number;

  if (bedTotal === wakeTotal) {
    totalMinutes = 0;
    windowEnd = wakeTotal;
  } else if (crossesMidnight) {
    if (isToday && nowTotal < wakeTotal) {
      totalMinutes = (24 * 60 - wakeTotal) + bedTotal;
      windowEnd = 24 * 60;
    } else {
      totalMinutes = Math.max(0, (24 * 60 - windowStart) + bedTotal);
      windowEnd = 24 * 60;
    }
  } else {
    totalMinutes = Math.max(0, bedTotal - windowStart);
    windowEnd = bedTotal;
  }

  // ルーティンは朝食・夕食のみカウント
  const blocks = events
    .filter(e => {
      if (e.date !== dateStr) return false;
      if (!e.id.startsWith('routine-')) return true;
      return e.id.startsWith('routine-breakfast') || e.id.startsWith('routine-dinner');
    })
    .map(e => {
      const [h, m] = e.timeString.split(':').map(Number);
      const rawStart = h * 60 + m;
      const rawEnd = rawStart + (e.estimatedMinutes || 60);
      const start = Math.max(rawStart, windowStart);
      const end = Math.min(rawEnd, windowEnd);
      return { start, end };
    })
    .filter(block => block.end > block.start)
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
