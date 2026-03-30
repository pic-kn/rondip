import { calcAvailableMinutes, toLocalDateStr } from './timeCalc';
import { AppEvent, SleepSettings } from '../types';

const DEFAULT_SLEEP: SleepSettings = { wakeTime: '07:00', bedTime: '23:00' };
// 未来の固定日時（テスト中に「今日」にならない日）
const FUTURE_DATE = '2099-12-31';
const FUTURE_NOW = new Date('2099-12-31T00:00:00');

const makeEvent = (
  overrides: Partial<AppEvent> & Pick<AppEvent, 'id' | 'title' | 'timeString'>
): AppEvent => ({
  date: FUTURE_DATE,
  estimatedMinutes: 60,
  ...overrides,
});

// ─── toLocalDateStr ───────────────────────────────────────────────────────────

describe('toLocalDateStr', () => {
  it('ローカル日付文字列を YYYY-MM-DD 形式で返す', () => {
    const d = new Date(2026, 2, 29); // 2026-03-29
    expect(toLocalDateStr(d)).toBe('2026-03-29');
  });

  it('月と日が1桁でもゼロ埋めされる', () => {
    const d = new Date(2026, 0, 5); // 2026-01-05
    expect(toLocalDateStr(d)).toBe('2026-01-05');
  });
});

// ─── calcAvailableMinutes ─────────────────────────────────────────────────────

describe('calcAvailableMinutes', () => {

  describe('基本計算', () => {
    it('予定なしのとき起床〜就寝の合計分を返す（07:00-23:00 = 960分）', () => {
      expect(calcAvailableMinutes([], DEFAULT_SLEEP, FUTURE_DATE, FUTURE_NOW)).toBe(960);
    });

    it('2時間の予定が1つある場合は840分になる', () => {
      const events = [makeEvent({ id: 'e1', title: '会議', timeString: '10:00', estimatedMinutes: 120 })];
      expect(calcAvailableMinutes(events, DEFAULT_SLEEP, FUTURE_DATE, FUTURE_NOW)).toBe(840);
    });

    it('重ならない複数の予定がすべて差し引かれる', () => {
      const events = [
        makeEvent({ id: 'e1', title: 'A', timeString: '10:00', estimatedMinutes: 60 }),
        makeEvent({ id: 'e2', title: 'B', timeString: '15:00', estimatedMinutes: 60 }),
      ];
      expect(calcAvailableMinutes(events, DEFAULT_SLEEP, FUTURE_DATE, FUTURE_NOW)).toBe(840);
    });
  });

  describe('重複・マージ', () => {
    it('重複する予定はマージして計算される（10:00-12:00 と 11:00-13:00 → 180分）', () => {
      const events = [
        makeEvent({ id: 'e1', title: 'A', timeString: '10:00', estimatedMinutes: 120 }),
        makeEvent({ id: 'e2', title: 'B', timeString: '11:00', estimatedMinutes: 120 }),
      ];
      expect(calcAvailableMinutes(events, DEFAULT_SLEEP, FUTURE_DATE, FUTURE_NOW)).toBe(780);
    });

    it('隣接する予定（終了と開始が同時刻）はマージされる（10:00-12:00 と 12:00-14:00 → 240分）', () => {
      const events = [
        makeEvent({ id: 'e1', title: 'A', timeString: '10:00', estimatedMinutes: 120 }),
        makeEvent({ id: 'e2', title: 'B', timeString: '12:00', estimatedMinutes: 120 }),
      ];
      expect(calcAvailableMinutes(events, DEFAULT_SLEEP, FUTURE_DATE, FUTURE_NOW)).toBe(720);
    });

    it('完全に内包される予定がある場合も正しくマージされる（10:00-14:00 が 11:00-12:00 を内包 → 240分）', () => {
      const events = [
        makeEvent({ id: 'e1', title: 'A', timeString: '10:00', estimatedMinutes: 240 }),
        makeEvent({ id: 'e2', title: 'B', timeString: '11:00', estimatedMinutes: 60 }),
      ];
      expect(calcAvailableMinutes(events, DEFAULT_SLEEP, FUTURE_DATE, FUTURE_NOW)).toBe(720);
    });

    it('3つ以上の予定がすべて重複する場合も1ブロックにマージされる', () => {
      const events = [
        makeEvent({ id: 'e1', title: 'A', timeString: '09:00', estimatedMinutes: 120 }),
        makeEvent({ id: 'e2', title: 'B', timeString: '10:00', estimatedMinutes: 120 }),
        makeEvent({ id: 'e3', title: 'C', timeString: '11:00', estimatedMinutes: 120 }),
      ];
      // 09:00-13:00 = 240分 → 960 - 240 = 720
      expect(calcAvailableMinutes(events, DEFAULT_SLEEP, FUTURE_DATE, FUTURE_NOW)).toBe(720);
    });
  });

  describe('ルーティンフィルタ', () => {
    it('routine-breakfast はカウントされる', () => {
      const events = [makeEvent({ id: 'routine-breakfast-1', title: '朝食', timeString: '08:00', estimatedMinutes: 30 })];
      expect(calcAvailableMinutes(events, DEFAULT_SLEEP, FUTURE_DATE, FUTURE_NOW)).toBe(930);
    });

    it('routine-dinner はカウントされる', () => {
      const events = [makeEvent({ id: 'routine-dinner-1', title: '夕食', timeString: '18:00', estimatedMinutes: 30 })];
      expect(calcAvailableMinutes(events, DEFAULT_SLEEP, FUTURE_DATE, FUTURE_NOW)).toBe(930);
    });

    it('routine-lunch はカウントされない（昼食はシフト内）', () => {
      const events = [makeEvent({ id: 'routine-lunch-1', title: '昼食', timeString: '12:00', estimatedMinutes: 60 })];
      expect(calcAvailableMinutes(events, DEFAULT_SLEEP, FUTURE_DATE, FUTURE_NOW)).toBe(960);
    });

    it('その他のルーティン（投薬など）はカウントされない', () => {
      const events = [makeEvent({ id: 'routine-medication-1', title: '薬を飲む', timeString: '08:00', estimatedMinutes: 5 })];
      expect(calcAvailableMinutes(events, DEFAULT_SLEEP, FUTURE_DATE, FUTURE_NOW)).toBe(960);
    });

    it('ルーティン以外の予定は通常どおりカウントされる', () => {
      const events = [makeEvent({ id: 'custom-1', title: '歯医者', timeString: '10:00', estimatedMinutes: 60 })];
      expect(calcAvailableMinutes(events, DEFAULT_SLEEP, FUTURE_DATE, FUTURE_NOW)).toBe(900);
    });
  });

  describe('日付フィルタ', () => {
    it('別の日の予定は計算に含まれない', () => {
      const events = [makeEvent({ id: 'e1', title: 'A', date: '2099-12-30', timeString: '10:00', estimatedMinutes: 120 })];
      expect(calcAvailableMinutes(events, DEFAULT_SLEEP, FUTURE_DATE, FUTURE_NOW)).toBe(960);
    });

    it('複数日の予定が混在しても対象日のみ計算される', () => {
      const events = [
        makeEvent({ id: 'e1', title: 'A', date: FUTURE_DATE, timeString: '10:00', estimatedMinutes: 60 }),
        makeEvent({ id: 'e2', title: 'B', date: '2099-12-30', timeString: '10:00', estimatedMinutes: 60 }),
      ];
      expect(calcAvailableMinutes(events, DEFAULT_SLEEP, FUTURE_DATE, FUTURE_NOW)).toBe(900);
    });
  });

  describe('今日の計算（現在時刻を考慮）', () => {
    it('今日の14:00時点では 14:00〜23:00 = 540分', () => {
      const now = new Date('2099-12-31T14:00:00');
      expect(calcAvailableMinutes([], DEFAULT_SLEEP, FUTURE_DATE, now)).toBe(540);
    });

    it('現在時刻が起床時間より前の場合は起床時間からカウント', () => {
      const now = new Date('2099-12-31T05:00:00'); // 05:00 < 07:00
      expect(calcAvailableMinutes([], DEFAULT_SLEEP, FUTURE_DATE, now)).toBe(960);
    });

    it('就寝時間を過ぎている場合は0を返す', () => {
      const now = new Date('2099-12-31T23:30:00');
      expect(calcAvailableMinutes([], DEFAULT_SLEEP, FUTURE_DATE, now)).toBe(0);
    });

    it('今日の14:00時点で15:00から2時間の予定がある場合は残り 540-120=420分', () => {
      const now = new Date('2099-12-31T14:00:00');
      const events = [makeEvent({ id: 'e1', title: 'A', timeString: '15:00', estimatedMinutes: 120 })];
      expect(calcAvailableMinutes(events, DEFAULT_SLEEP, FUTURE_DATE, now)).toBe(420);
    });

    it('進行中の予定は現在時刻以降の残り分だけ差し引かれる', () => {
      const now = new Date('2099-12-31T14:00:00');
      const events = [makeEvent({ id: 'e1', title: 'A', timeString: '13:00', estimatedMinutes: 120 })];
      expect(calcAvailableMinutes(events, DEFAULT_SLEEP, FUTURE_DATE, now)).toBe(480);
    });
  });

  describe('境界値・異常値（メチャクチャな使い方）', () => {
    it('estimatedMinutes が 0 の予定はデフォルト60分として扱われる', () => {
      // (0 || 60) = 60 という現状の実装の動作
      const events = [makeEvent({ id: 'e1', title: 'A', timeString: '10:00', estimatedMinutes: 0 })];
      expect(calcAvailableMinutes(events, DEFAULT_SLEEP, FUTURE_DATE, FUTURE_NOW)).toBe(900);
    });

    it('大量の予定が重なっても結果が0以上になる', () => {
      const events = Array.from({ length: 20 }, (_, i) =>
        makeEvent({ id: `e${i}`, title: `予定${i}`, timeString: '08:00', estimatedMinutes: 120 })
      );
      expect(calcAvailableMinutes(events, DEFAULT_SLEEP, FUTURE_DATE, FUTURE_NOW)).toBeGreaterThanOrEqual(0);
    });

    it('就寝時間と起床時間が同じ場合は0を返す', () => {
      const sleep: SleepSettings = { wakeTime: '07:00', bedTime: '07:00' };
      expect(calcAvailableMinutes([], sleep, FUTURE_DATE, FUTURE_NOW)).toBe(0);
    });

    it('就寝時間が起床時間より前（逆転）でも0以上を返す', () => {
      const sleep: SleepSettings = { wakeTime: '23:00', bedTime: '07:00' };
      expect(calcAvailableMinutes([], sleep, FUTURE_DATE, FUTURE_NOW)).toBeGreaterThanOrEqual(0);
    });

    it('夜またぎの生活リズムでは翌日未明までを残り時間に含める', () => {
      const sleep: SleepSettings = { wakeTime: '07:00', bedTime: '01:00' };
      expect(calcAvailableMinutes([], sleep, FUTURE_DATE, FUTURE_NOW)).toBe(1080);
    });

    it('夜またぎ設定で今日の23:30時点なら翌1:00までの90分を返す', () => {
      const sleep: SleepSettings = { wakeTime: '07:00', bedTime: '01:00' };
      const now = new Date('2099-12-31T23:30:00');
      expect(calcAvailableMinutes([], sleep, FUTURE_DATE, now)).toBe(90);
    });

    it('夜またぎ設定では同日の深夜イベントを前日ぶんとして除外する', () => {
      const sleep: SleepSettings = { wakeTime: '07:00', bedTime: '01:00' };
      const events = [makeEvent({ id: 'late', title: '深夜イベント', timeString: '00:30', estimatedMinutes: 30 })];
      expect(calcAvailableMinutes(events, sleep, FUTURE_DATE, FUTURE_NOW)).toBe(1080);
    });

    it('予定リストが空でも正常に動作する', () => {
      expect(calcAvailableMinutes([], DEFAULT_SLEEP, FUTURE_DATE, FUTURE_NOW)).toBe(960);
    });

    it('予定が1件だけでも正常に動作する', () => {
      const events = [makeEvent({ id: 'solo', title: 'ひとつだけ', timeString: '12:00', estimatedMinutes: 30 })];
      expect(calcAvailableMinutes(events, DEFAULT_SLEEP, FUTURE_DATE, FUTURE_NOW)).toBe(930);
    });

    it('1440分（24時間）を超える予定があっても0以上を返す', () => {
      const events = [makeEvent({ id: 'huge', title: '超長い', timeString: '07:00', estimatedMinutes: 2000 })];
      expect(calcAvailableMinutes(events, DEFAULT_SLEEP, FUTURE_DATE, FUTURE_NOW)).toBeGreaterThanOrEqual(0);
    });
  });
});
