import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Dimensions, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useAppContext } from '../context/AppContext';
import { getGoogleMapsUrl } from '../services/maps';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const HOUR_HEIGHT = 64;
const TIMELINE_START = 6;   // 6:00
const TIMELINE_END = 24;    // 24:00
const TIME_COL_WIDTH = 44;
const HOURS = Array.from({ length: TIMELINE_END - TIMELINE_START }, (_, i) => i + TIMELINE_START);

type ViewMode = 'timeline' | 'week' | 'month';

const toLocalDateString = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const timeToMinutes = (timeStr: string): number => {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
};

const minutesToY = (minutes: number): number =>
  ((minutes - TIMELINE_START * 60) / 60) * HOUR_HEIGHT;

export default function CalendarScreen() {
  const { events, getTodayWorkShift, workSchedule } = useAppContext();
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [selectedDate, setSelectedDate] = useState(toLocalDateString(new Date()));
  const [currentViewDate, setCurrentViewDate] = useState(new Date());
  const timelineScrollRef = useRef<ScrollView>(null);

  const groupedEvents = useMemo(() => {
    const grouped: { [date: string]: typeof events } = {};
    events.forEach(event => {
      if (!grouped[event.date]) grouped[event.date] = [];
      grouped[event.date].push(event);
    });
    return grouped;
  }, [events]);

  const sortedDates = useMemo(() => Object.keys(groupedEvents).sort(), [groupedEvents]);

  // タイムライン表示時に現在時刻へ自動スクロール
  useEffect(() => {
    if (viewMode === 'timeline' && selectedDate === toLocalDateString(new Date())) {
      const now = new Date();
      const currentMin = now.getHours() * 60 + now.getMinutes();
      const y = minutesToY(currentMin);
      setTimeout(() => {
        timelineScrollRef.current?.scrollTo({ y: Math.max(0, y - 120), animated: true });
      }, 300);
    }
  }, [viewMode, selectedDate]);

  const generateWeekDays = () => {
    const days = [];
    const start = new Date(currentViewDate);
    start.setDate(currentViewDate.getDate() - currentViewDate.getDay());
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return days;
  };

  const generateMonthDays = () => {
    const year = currentViewDate.getFullYear();
    const month = currentViewDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: (Date | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));
    return days;
  };

  const changeMonth = (offset: number) => {
    const d = new Date(currentViewDate);
    d.setMonth(d.getMonth() + offset);
    setCurrentViewDate(d);
  };

  // 週ストリップ（タイムライン・週共通）
  const WeekStrip = () => (
    <View style={styles.weekStrip}>
      {generateWeekDays().map(day => {
        const dStr = toLocalDateString(day);
        const isSelected = selectedDate === dStr;
        const isToday = dStr === toLocalDateString(new Date());
        const hasEvents = !!groupedEvents[dStr];
        return (
          <TouchableOpacity
            key={dStr}
            style={[styles.weekDayBtn, isSelected && styles.weekDayBtnActive]}
            onPress={() => setSelectedDate(dStr)}
          >
            <Text style={[styles.weekDayName, isSelected && styles.weekDayNameActive]}>
              {['日', '月', '火', '水', '木', '金', '土'][day.getDay()]}
            </Text>
            <View style={[styles.weekDayNum, isSelected && styles.weekDayNumActive, isToday && !isSelected && styles.weekDayNumToday]}>
              <Text style={[styles.weekDayNumText, isSelected && styles.weekDayNumTextActive, isToday && !isSelected && styles.weekDayNumTextToday]}>
                {day.getDate()}
              </Text>
            </View>
            {hasEvents && <View style={[styles.eventDot, isSelected && styles.eventDotActive]} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // 空き時間スロットを計算
  const calcFreeSlots = (dayEvents: typeof events) => {
    const sorted = [...dayEvents].sort((a, b) => a.timeString.localeCompare(b.timeString));
    const slots: { start: number; end: number }[] = [];
    let prevEnd = TIMELINE_START * 60;

    for (const event of sorted) {
      const startMin = timeToMinutes(event.timeString);
      const endMin = startMin + (event.estimatedMinutes || 60);
      if (startMin - prevEnd >= 15) {
        slots.push({ start: prevEnd, end: startMin });
      }
      prevEnd = Math.max(prevEnd, endMin);
    }

    // 最後のイベント後（最大3時間まで）
    const dayEnd = Math.min(prevEnd + 180, TIMELINE_END * 60);
    if (dayEnd - prevEnd >= 15) {
      slots.push({ start: prevEnd, end: dayEnd });
    }

    return slots;
  };

  // タイムライン
  const renderTimeline = () => {
    const dayEvents = (groupedEvents[selectedDate] || []).sort((a, b) =>
      a.timeString.localeCompare(b.timeString)
    );
    const now = new Date();
    const isToday = selectedDate === toLocalDateString(now);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const totalHeight = (TIMELINE_END - TIMELINE_START) * HOUR_HEIGHT;
    const freeSlots = calcFreeSlots(dayEvents);
    const shift = getTodayWorkShift(selectedDate);

    return (
      <ScrollView ref={timelineScrollRef} style={styles.timelineScroll}>
        <View style={[styles.timelineContent, { height: totalHeight }]}>
          {/* 時刻ラベル + グリッド線 */}
          {HOURS.map((hour, i) => (
            <View key={hour} style={[styles.hourRow, { top: i * HOUR_HEIGHT }]}>
              <Text style={styles.hourLabel}>{hour}:00</Text>
              <View style={styles.hourLine} />
            </View>
          ))}

          {/* シフトブロック */}
          {shift && (() => {
            const startMin = timeToMinutes(shift.startTime);
            const endMin = timeToMinutes(shift.endTime);
            const top = minutesToY(startMin);
            const height = ((endMin - startMin) / 60) * HOUR_HEIGHT;
            const wp = (workSchedule.workplaces || []).find(w => w.startTime === shift.startTime && w.endTime === shift.endTime);
            return (
              <View style={[styles.shiftBlock, { top, height }]}>
                <Text style={styles.shiftBlockText}>{wp?.name ?? '勤務'} {shift.startTime}〜{shift.endTime}</Text>
              </View>
            );
          })()}

          {/* 空き時間ブロック */}
          {freeSlots.map((slot, i) => {
            const top = minutesToY(slot.start);
            const height = ((slot.end - slot.start) / 60) * HOUR_HEIGHT;
            const minutes = slot.end - slot.start;
            const label = minutes >= 60
              ? `${Math.floor(minutes / 60)}時間${minutes % 60 > 0 ? `${minutes % 60}分` : ''}の空き`
              : `${minutes}分の空き`;
            return (
              <View key={`free-${i}`} style={[styles.freeBlock, { top, height }]}>
                {height >= 28 && (
                  <Text style={styles.freeBlockText}>{label}</Text>
                )}
              </View>
            );
          })}

          {/* 現在時刻ライン */}
          {isToday && currentMinutes >= TIMELINE_START * 60 && currentMinutes < TIMELINE_END * 60 && (
            <View style={[styles.nowLine, { top: minutesToY(currentMinutes) }]}>
              <View style={styles.nowDot} />
              <View style={styles.nowLineBar} />
            </View>
          )}

          {/* イベントブロック */}
          {dayEvents.map(event => {
            const startMin = timeToMinutes(event.timeString);
            const duration = event.estimatedMinutes || 60;
            const top = minutesToY(startMin);
            const blockHeight = Math.max((duration / 60) * HOUR_HEIGHT, 28);

            if (startMin < TIMELINE_START * 60 || startMin >= TIMELINE_END * 60) return null;

            return (
              <TouchableOpacity
                key={event.id}
                style={[styles.eventBlock, { top, height: blockHeight }]}
                activeOpacity={0.8}
                onPress={() => event.location && Linking.openURL(getGoogleMapsUrl(null, event.location))}
              >
                <Text style={styles.eventBlockTitle} numberOfLines={1}>{event.title}</Text>
                {blockHeight > 40 && event.location && (
                  <View style={styles.eventBlockLocation}>
                    <Ionicons name="location-outline" size={11} color={colors.textSecondary} />
                    <Text style={styles.eventBlockLocationText} numberOfLines={1}>{event.location}</Text>
                  </View>
                )}
                {blockHeight > 52 && (
                  <Text style={styles.eventBlockTime}>
                    {event.timeString} · {duration}分
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}

          {/* 予定なし */}
          {dayEvents.length === 0 && (
            <View style={styles.noEventHint}>
              <Text style={styles.noEventText}>予定はありません</Text>
            </View>
          )}
        </View>
      </ScrollView>
    );
  };

  // イベントリスト（週・月で使用）
  const renderEventList = (dateStr: string) => {
    const dayEvents = (groupedEvents[dateStr] || []).sort((a, b) =>
      a.timeString.localeCompare(b.timeString)
    );
    const shift = getTodayWorkShift(dateStr);
    const wp = shift ? (workSchedule.workplaces || []).find(w => w.startTime === shift.startTime && w.endTime === shift.endTime) : null;

    if (dayEvents.length === 0 && !shift) {
      return <Text style={styles.noEventText}>予定はありません</Text>;
    }
    return (
      <>
        {shift && (
          <View style={styles.shiftCard}>
            <Ionicons name="briefcase-outline" size={14} color={colors.textSecondary} style={{ marginRight: 6 }} />
            <Text style={styles.shiftCardText}>{wp?.name ?? '勤務'} {shift.startTime}〜{shift.endTime}</Text>
          </View>
        )}
        {dayEvents.map(event => (
      <View key={event.id} style={styles.eventCard}>
        <View style={styles.eventCardTime}>
          <Text style={styles.eventCardTimeText}>{event.timeString}</Text>
          <View style={styles.eventCardLine} />
        </View>
        <View style={styles.eventCardInfo}>
          <Text style={styles.eventCardTitle}>{event.title}</Text>
          {event.location && (
            <TouchableOpacity
              style={styles.locationRow}
              onPress={() => Linking.openURL(getGoogleMapsUrl(null, event.location!))}
            >
              <Ionicons name="location" size={13} color={colors.textSecondary} />
              <Text style={styles.locationText}>{event.location}</Text>
            </TouchableOpacity>
          )}
          {event.estimatedMinutes && (
            <Text style={styles.durationText}>{event.estimatedMinutes}分</Text>
          )}
        </View>
      </View>
    ))}
      </>
    );
  };

  return (
    <View style={styles.container}>
      {/* モード切替 */}
      <View style={styles.modeSwitcherContainer}>
        <View style={styles.modeSwitcher}>
          {([['timeline', 'タイムライン'], ['week', '週'], ['month', '月']] as [ViewMode, string][]).map(([mode, label]) => (
            <TouchableOpacity
              key={mode}
              style={[styles.modeBtn, viewMode === mode && styles.modeBtnActive]}
              onPress={() => setViewMode(mode)}
            >
              <Text style={[styles.modeBtnText, viewMode === mode && styles.modeBtnTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* タイムライン */}
      {viewMode === 'timeline' && (
        <View style={styles.flex}>
          <WeekStrip />
          {renderTimeline()}
        </View>
      )}

      {/* 週リスト */}
      {viewMode === 'week' && (
        <View style={styles.flex}>
          <WeekStrip />
          <ScrollView contentContainerStyle={styles.listContent}>
            <Text style={styles.listDateLabel}>
              {selectedDate.replace(/-/g, '/')} の予定
            </Text>
            {renderEventList(selectedDate)}
          </ScrollView>
        </View>
      )}

      {/* 月カレンダー */}
      {viewMode === 'month' && (
        <View style={styles.flex}>
          <View style={styles.monthNav}>
            <TouchableOpacity onPress={() => changeMonth(-1)}>
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.monthLabel}>
              {currentViewDate.getFullYear()}年 {currentViewDate.getMonth() + 1}月
            </Text>
            <TouchableOpacity onPress={() => changeMonth(1)}>
              <Ionicons name="chevron-forward" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.monthGrid}>
            {['日', '月', '火', '水', '木', '金', '土'].map(d => (
              <Text key={d} style={styles.monthWeekday}>{d}</Text>
            ))}
            {generateMonthDays().map((day, idx) => {
              if (!day) return <View key={`pad-${idx}`} style={styles.monthCell} />;
              const dStr = toLocalDateString(day);
              const isSelected = selectedDate === dStr;
              const isToday = dStr === toLocalDateString(new Date());
              const hasEvents = !!groupedEvents[dStr];
              return (
                <TouchableOpacity
                  key={dStr}
                  style={styles.monthCell}
                  onPress={() => setSelectedDate(dStr)}
                >
                  <View style={[
                    styles.monthDayInner,
                    isSelected && styles.monthDaySelected,
                    isToday && !isSelected && styles.monthDayToday,
                  ]}>
                    <Text style={[
                      styles.monthDayText,
                      isSelected && styles.monthDayTextSelected,
                      isToday && !isSelected && styles.monthDayTextToday,
                    ]}>
                      {day.getDate()}
                    </Text>
                  </View>
                  {hasEvents && <View style={[styles.eventDot, isSelected && styles.eventDotActive]} />}
                </TouchableOpacity>
              );
            })}
          </View>
          <ScrollView style={styles.flex} contentContainerStyle={styles.listContent}>
            <Text style={styles.listDateLabel}>{selectedDate.replace(/-/g, '/')} の予定</Text>
            {renderEventList(selectedDate)}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },

  // モード切替
  modeSwitcherContainer: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle,
  },
  modeSwitcher: {
    flexDirection: 'row', backgroundColor: colors.borderSubtle,
    borderRadius: 10, padding: 3, alignSelf: 'flex-start',
  },
  modeBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  modeBtnActive: { backgroundColor: colors.surface },
  modeBtnText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  modeBtnTextActive: { color: colors.text },

  // 週ストリップ
  weekStrip: {
    flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle,
  },
  weekDayBtn: { flex: 1, alignItems: 'center', gap: 4 },
  weekDayBtnActive: {},
  weekDayName: { fontSize: 11, color: colors.textSecondary, fontWeight: '500' },
  weekDayNameActive: { color: colors.text },
  weekDayNum: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  weekDayNumActive: { backgroundColor: colors.text },
  weekDayNumToday: { borderWidth: 1.5, borderColor: colors.text },
  weekDayNumText: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  weekDayNumTextActive: { color: colors.background, fontWeight: '700' },
  weekDayNumTextToday: { color: colors.text, fontWeight: '700' },
  eventDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.border },
  eventDotActive: { backgroundColor: colors.background },

  // タイムライン
  timelineScroll: { flex: 1 },
  timelineContent: { position: 'relative', paddingLeft: TIME_COL_WIDTH, paddingRight: 16, paddingBottom: 32 },
  hourRow: {
    position: 'absolute', left: 0, right: 16,
    flexDirection: 'row', alignItems: 'flex-start',
  },
  hourLabel: {
    width: TIME_COL_WIDTH, fontSize: 11, color: colors.border,
    textAlign: 'right', paddingRight: 8, lineHeight: 14,
  },
  hourLine: {
    flex: 1, height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle, marginTop: 6,
  },

  // 現在時刻
  nowLine: {
    position: 'absolute', left: TIME_COL_WIDTH, right: 16,
    flexDirection: 'row', alignItems: 'center', zIndex: 10,
  },
  nowDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.text, marginLeft: -4,
  },
  nowLineBar: { flex: 1, height: 1.5, backgroundColor: colors.text },

  // イベントブロック
  eventBlock: {
    position: 'absolute',
    left: TIME_COL_WIDTH + 4,
    right: 20,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: colors.text,
    padding: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
  },
  eventBlockTitle: { fontSize: 13, fontWeight: '600', color: colors.text },
  eventBlockLocation: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 },
  eventBlockLocationText: { fontSize: 11, color: colors.textSecondary, flex: 1 },
  eventBlockTime: { fontSize: 11, color: colors.border, marginTop: 2 },

  noEventHint: { position: 'absolute', top: HOUR_HEIGHT * 2, left: TIME_COL_WIDTH + 16 },
  noEventText: { fontSize: 14, color: colors.border },

  freeBlock: {
    position: 'absolute',
    left: TIME_COL_WIDTH + 4,
    right: 20,
    backgroundColor: colors.borderSubtle,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  freeBlockText: {
    fontSize: 11,
    color: colors.border,
    fontWeight: '500',
  },

  // リスト（週・月共通）
  listContent: { padding: 20, gap: 16 },
  listDateLabel: { fontSize: 14, fontWeight: '600', color: colors.textSecondary, marginBottom: 4 },
  eventCard: { flexDirection: 'row', gap: 12 },
  eventCardTime: { width: 44, alignItems: 'flex-end' },
  eventCardTimeText: { fontSize: 12, fontWeight: '700', color: colors.text },
  eventCardLine: { width: 1, flex: 1, backgroundColor: colors.borderSubtle, marginTop: 4, alignSelf: 'center' },
  eventCardInfo: {
    flex: 1, backgroundColor: colors.surface, padding: 12,
    borderRadius: 12, borderWidth: 1, borderColor: colors.borderSubtle,
  },
  eventCardTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  locationText: { fontSize: 12, color: colors.textSecondary },
  durationText: { fontSize: 12, color: colors.border, marginTop: 4 },

  // シフト
  shiftBlock: {
    position: 'absolute',
    left: TIME_COL_WIDTH + 4,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.04)',
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
    justifyContent: 'flex-start',
    paddingHorizontal: 8,
    paddingTop: 4,
    zIndex: 0,
  },
  shiftBlockText: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  shiftCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.borderSubtle,
    borderRadius: 10, padding: 10, marginBottom: 8,
  },
  shiftCardText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },

  // 月カレンダー
  monthNav: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 12,
  },
  monthLabel: { fontSize: 16, fontWeight: '600', color: colors.text },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 },
  monthWeekday: {
    width: (SCREEN_WIDTH - 16) / 7, textAlign: 'center',
    fontSize: 11, color: colors.textSecondary, fontWeight: '500',
    paddingVertical: 4,
  },
  monthCell: {
    width: (SCREEN_WIDTH - 16) / 7, height: 44,
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  monthDayInner: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  monthDaySelected: { backgroundColor: colors.text },
  monthDayToday: { borderWidth: 1.5, borderColor: colors.text },
  monthDayText: { fontSize: 14, color: colors.textSecondary },
  monthDayTextSelected: { color: colors.background, fontWeight: '700' },
  monthDayTextToday: { color: colors.text, fontWeight: '700' },
});
