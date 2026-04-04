import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Dimensions, Linking, Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { AppEvent, ShiftEntry, ShiftOverride, useAppContext } from '../context/AppContext';
import { getGoogleMapsUrl } from '../services/maps';
import NativeDatePicker from '../components/NativeDatePicker';
import NativeTimePicker from '../components/NativeTimePicker';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const HOUR_HEIGHT = 64;
const TIMELINE_START = 6;   // 6:00
const TIMELINE_END = 24;    // 24:00
const TIME_COL_WIDTH = 44;
const HOURS = Array.from({ length: TIMELINE_END - TIMELINE_START }, (_, i) => i + TIMELINE_START);

type ViewMode = 'timeline' | 'week' | 'month';
type EditorState =
  | { type: 'event'; event: AppEvent }
  | { type: 'shift'; shift: ShiftEntry; override?: ShiftOverride | null }
  | null;

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
  const { events, getTodayWorkShift, workSchedule, updateEvent, deleteEvent, updateTask, addShiftOverride, removeShiftOverride } = useAppContext();
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [selectedDate, setSelectedDate] = useState(toLocalDateString(new Date()));
  const [currentViewDate, setCurrentViewDate] = useState(new Date());
  const [editor, setEditor] = useState<EditorState>(null);
  const [editorTitle, setEditorTitle] = useState('');
  const [editorDate, setEditorDate] = useState(selectedDate);
  const [editorTime, setEditorTime] = useState('09:00');
  const [editorDuration, setEditorDuration] = useState('60');
  const [editorLocation, setEditorLocation] = useState('');
  const [editorIsDayOff, setEditorIsDayOff] = useState(false);
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

  const activeShiftOverride = (date: string, workplaceId?: string | null) =>
    (workSchedule.shiftOverrides || []).find(ov => ov.date === date && ov.workplaceId === workplaceId);

  const openEventEditor = (event: AppEvent) => {
    setEditor({ type: 'event', event });
    setEditorTitle(event.title);
    setEditorDate(event.date);
    setEditorTime(event.timeString);
    setEditorDuration(String(event.estimatedMinutes || 60));
    setEditorLocation(event.location || '');
    setEditorIsDayOff(false);
  };

  const openShiftEditor = (shift: ShiftEntry) => {
    const override = activeShiftOverride(shift.date, shift.workplaceId);
    setEditor({ type: 'shift', shift, override });
    setEditorTitle(shift.name || '勤務');
    setEditorDate(shift.date);
    setEditorTime(shift.startTime);
    setEditorDuration(String(Math.max(0, timeToMinutes(shift.endTime) - timeToMinutes(shift.startTime))));
    setEditorLocation('');
    setEditorIsDayOff(false);
  };

  const closeEditor = () => setEditor(null);

  const saveEditor = () => {
    if (!editor) return;
    const duration = Math.max(5, Number(editorDuration) || 60);

    if (editor.type === 'event') {
      if (editor.event.id.startsWith('task-')) {
        const taskId = editor.event.id.replace(/^task-/, '');
        updateTask(taskId, {
          title: editorTitle.trim() || editor.event.title,
          dueDate: editorDate,
          scheduledTime: editorTime,
          estimatedMinutes: duration,
        });
      } else {
        updateEvent(editor.event.id, {
          title: editorTitle.trim() || editor.event.title,
          date: editorDate,
          timeString: editorTime,
          estimatedMinutes: duration,
          location: editorLocation.trim() || undefined,
        });
      }
      closeEditor();
      return;
    }

    if (!editor.shift.workplaceId) {
      closeEditor();
      return;
    }

    const startMinutes = timeToMinutes(editorTime);
    const endMinutes = Math.min(24 * 60, startMinutes + duration);
    const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

    addShiftOverride({
      workplaceId: editor.shift.workplaceId,
      date: editorDate,
      isDayOff: editorIsDayOff,
      startTime: editorIsDayOff ? undefined : editorTime,
      endTime: editorIsDayOff ? undefined : endTime,
    });
    closeEditor();
  };

  const resetShiftEditor = () => {
    if (editor?.type === 'shift' && editor.override) {
      removeShiftOverride(editor.override.id);
    }
    closeEditor();
  };

  const deleteEditorEvent = () => {
    if (editor?.type !== 'event') return;
    if (editor.event.id.startsWith('task-') || editor.event.id.startsWith('routine-')) {
      closeEditor();
      return;
    }
    deleteEvent(editor.event.id);
    closeEditor();
  };

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
            const wp = (workSchedule.workplaces || []).find(w => w.id === shift.workplaceId)
              || (workSchedule.workplaces || []).find(w => w.startTime === shift.startTime && w.endTime === shift.endTime);
            return (
              <TouchableOpacity
                style={[styles.shiftBlock, { top, height }]}
                activeOpacity={shift.workplaceId ? 0.85 : 1}
                onPress={() => shift.workplaceId && openShiftEditor(shift)}
              >
                <Text style={styles.shiftBlockText}>{shift.name ?? wp?.name ?? '勤務'} {shift.startTime}〜{shift.endTime}</Text>
              </TouchableOpacity>
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
            const blockHeight = Math.max((duration / 60) * HOUR_HEIGHT, 36);

            if (startMin < TIMELINE_START * 60 || startMin >= TIMELINE_END * 60) return null;

            return (
              <TouchableOpacity
                key={event.id}
                style={[styles.eventBlock, { top, height: blockHeight }]}
                activeOpacity={0.8}
                onPress={() => openEventEditor(event)}
              >
                <Text style={styles.eventBlockTitle} numberOfLines={blockHeight < 52 ? 1 : 2}>{event.title}</Text>
                {blockHeight >= 54 && event.location && (
                  <View style={styles.eventBlockLocation}>
                    <Ionicons name="location-outline" size={11} color={colors.textSecondary} />
                    <Text style={styles.eventBlockLocationText} numberOfLines={1}>{event.location}</Text>
                  </View>
                )}
                {blockHeight >= 68 && (
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
    const wp = shift ? ((workSchedule.workplaces || []).find(w => w.id === shift.workplaceId)
      || (workSchedule.workplaces || []).find(w => w.startTime === shift.startTime && w.endTime === shift.endTime)) : null;

    if (dayEvents.length === 0 && !shift) {
      return <Text style={styles.noEventText}>予定はありません</Text>;
    }
    return (
      <>
        {shift && (
          <TouchableOpacity
            style={styles.shiftCard}
            activeOpacity={shift.workplaceId ? 0.8 : 1}
            onPress={() => shift.workplaceId && openShiftEditor(shift)}
          >
            <Ionicons name="briefcase-outline" size={14} color={colors.textSecondary} style={{ marginRight: 6 }} />
            <Text style={styles.shiftCardText}>{shift.name ?? wp?.name ?? '勤務'} {shift.startTime}〜{shift.endTime}</Text>
          </TouchableOpacity>
        )}
        {dayEvents.map(event => (
      <TouchableOpacity key={event.id} style={styles.eventCard} activeOpacity={0.85} onPress={() => openEventEditor(event)}>
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
      </TouchableOpacity>
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

      <Modal visible={!!editor} transparent animationType="slide" onRequestClose={closeEditor}>
        <KeyboardAvoidingView
          style={styles.editorOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
        >
          <View style={styles.editorSheet}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.editorContent}>
            <View style={styles.editorHeader}>
              <Text style={styles.editorTitle}>{editor?.type === 'shift' ? '勤務を調整' : '予定を調整'}</Text>
              <TouchableOpacity onPress={closeEditor}>
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            {editor?.type === 'event' && (
              <>
                <View style={styles.editorRow}>
                  <Text style={styles.editorLabel}>予定名</Text>
                  <TextInput
                    style={styles.editorInput}
                    value={editorTitle}
                    onChangeText={setEditorTitle}
                    placeholder="予定名"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>
                <View style={styles.editorRow}>
                  <Text style={styles.editorLabel}>日付</Text>
                  <NativeDatePicker value={editorDate} onChange={setEditorDate} />
                </View>
                <View style={styles.editorRow}>
                  <Text style={styles.editorLabel}>開始</Text>
                  <NativeTimePicker value={editorTime} onChange={setEditorTime} />
                </View>
                <View style={styles.editorRow}>
                  <Text style={styles.editorLabel}>分数</Text>
                  <TextInput
                    style={[styles.editorInput, styles.durationInput]}
                    value={editorDuration}
                    onChangeText={setEditorDuration}
                    keyboardType="number-pad"
                    placeholder="60"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>
                {!editor.event.id.startsWith('task-') && (
                  <View style={styles.editorRow}>
                    <Text style={styles.editorLabel}>場所</Text>
                    <TextInput
                      style={styles.editorInput}
                      value={editorLocation}
                      onChangeText={setEditorLocation}
                      placeholder="場所"
                      placeholderTextColor={colors.textSecondary}
                    />
                  </View>
                )}
              </>
            )}

            {editor?.type === 'shift' && (
              <>
                <View style={styles.editorRow}>
                  <Text style={styles.editorLabel}>日付</Text>
                  <NativeDatePicker value={editorDate} onChange={setEditorDate} />
                </View>
                <TouchableOpacity
                  style={[styles.dayOffToggle, editorIsDayOff && styles.dayOffToggleActive]}
                  onPress={() => setEditorIsDayOff(v => !v)}
                  activeOpacity={0.85}
                >
                  <Ionicons
                    name={editorIsDayOff ? 'checkmark-circle' : 'ellipse-outline'}
                    size={18}
                    color={editorIsDayOff ? colors.background : colors.textSecondary}
                  />
                  <Text style={[styles.dayOffToggleText, editorIsDayOff && styles.dayOffToggleTextActive]}>
                    この日は休みにする
                  </Text>
                </TouchableOpacity>
                {!editorIsDayOff && (
                  <>
                    <View style={styles.editorRow}>
                      <Text style={styles.editorLabel}>開始</Text>
                      <NativeTimePicker value={editorTime} onChange={setEditorTime} />
                    </View>
                    <View style={styles.editorRow}>
                      <Text style={styles.editorLabel}>分数</Text>
                      <TextInput
                        style={[styles.editorInput, styles.durationInput]}
                        value={editorDuration}
                        onChangeText={setEditorDuration}
                        keyboardType="number-pad"
                        placeholder="480"
                        placeholderTextColor={colors.textSecondary}
                      />
                    </View>
                  </>
                )}
              </>
            )}

            <View style={styles.editorActions}>
              {editor?.type === 'shift' && editor.override && (
                <TouchableOpacity style={styles.secondaryAction} onPress={resetShiftEditor}>
                  <Text style={styles.secondaryActionText}>標準に戻す</Text>
                </TouchableOpacity>
              )}
              {editor?.type === 'event' && !editor.event.id.startsWith('task-') && !editor.event.id.startsWith('routine-') && (
                <TouchableOpacity style={styles.secondaryAction} onPress={deleteEditorEvent}>
                  <Text style={styles.secondaryActionText}>削除</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.primaryAction} onPress={saveEditor}>
                <Text style={styles.primaryActionText}>保存</Text>
              </TouchableOpacity>
            </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },

  // モード切替
  modeSwitcherContainer: {
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle,
  },
  modeSwitcher: {
    flexDirection: 'row', backgroundColor: '#F0EFEA',
    borderRadius: 12, padding: 4, alignSelf: 'flex-start',
  },
  modeBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 9 },
  modeBtnActive: { backgroundColor: colors.surface },
  modeBtnText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  modeBtnTextActive: { color: colors.text },

  // 週ストリップ
  weekStrip: {
    flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle,
  },
  weekDayBtn: { flex: 1, alignItems: 'center', gap: 4 },
  weekDayBtnActive: {},
  weekDayName: { fontSize: 10, color: colors.textSecondary, fontWeight: '600' },
  weekDayNameActive: { color: colors.text },
  weekDayNum: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  weekDayNumActive: { backgroundColor: colors.text },
  weekDayNumToday: { borderWidth: 1, borderColor: colors.text },
  weekDayNumText: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
  weekDayNumTextActive: { color: colors.background, fontWeight: '700' },
  weekDayNumTextToday: { color: colors.text, fontWeight: '700' },
  eventDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.border },
  eventDotActive: { backgroundColor: colors.background },

  // タイムライン
  timelineScroll: { flex: 1 },
  timelineContent: { position: 'relative', paddingLeft: TIME_COL_WIDTH, paddingRight: 16, paddingBottom: 40 },
  hourRow: {
    position: 'absolute', left: 0, right: 16,
    flexDirection: 'row', alignItems: 'flex-start',
  },
  hourLabel: {
    width: TIME_COL_WIDTH, fontSize: 10, color: colors.mid,
    textAlign: 'right', paddingRight: 8, lineHeight: 14,
  },
  hourLine: {
    flex: 1, height: StyleSheet.hairlineWidth,
    backgroundColor: '#ECEBE6', marginTop: 6,
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
    left: TIME_COL_WIDTH + 12,
    right: 16,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 18,
    elevation: 2,
  },
  eventBlockTitle: { fontSize: 12, lineHeight: 15, fontWeight: '700', color: colors.text, marginBottom: 1 },
  eventBlockLocation: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  eventBlockLocationText: { fontSize: 11, color: colors.textSecondary, flex: 1, fontWeight: '500' },
  eventBlockTime: { fontSize: 11, color: colors.textSecondary, marginTop: 4, fontWeight: '600' },

  noEventHint: { position: 'absolute', top: HOUR_HEIGHT * 2, left: TIME_COL_WIDTH + 16 },
  noEventText: { fontSize: 14, color: colors.textSecondary },

  freeBlock: {
    position: 'absolute',
    left: TIME_COL_WIDTH + 14,
    right: 18,
    backgroundColor: '#F7F6F1',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E7E5DE',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  freeBlockText: {
    fontSize: 11,
    color: colors.mid,
    fontWeight: '600',
  },

  // リスト（週・月共通）
  listContent: { padding: 20, gap: 16 },
  listDateLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 4 },
  eventCard: { flexDirection: 'row', gap: 12 },
  eventCardTime: { width: 44, alignItems: 'flex-end' },
  eventCardTimeText: { fontSize: 12, fontWeight: '700', color: colors.text },
  eventCardLine: { width: 1, flex: 1, backgroundColor: colors.borderSubtle, marginTop: 4, alignSelf: 'center' },
  eventCardInfo: {
    flex: 1, backgroundColor: colors.surface, padding: 16,
    borderRadius: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05, shadowRadius: 18, elevation: 2,
    borderWidth: 1, borderColor: colors.borderSubtle
  },
  eventCardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  locationText: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
  durationText: { fontSize: 12, color: colors.textSecondary, marginTop: 6, fontWeight: '600' },

  // シフト
  shiftBlock: {
    position: 'absolute',
    left: TIME_COL_WIDTH + 12,
    right: 16,
    backgroundColor: '#F3F2EC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E6E4DC',
    justifyContent: 'flex-start',
    paddingHorizontal: 10,
    paddingTop: 8,
    zIndex: 0,
  },
  shiftBlockText: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  shiftCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F3F2EC',
    borderRadius: 12, padding: 12, marginBottom: 8,
  },
  shiftCardText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },

  editorOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'flex-end',
  },
  editorSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 32,
    maxHeight: '85%',
  },
  editorContent: { gap: 14, paddingBottom: 8 },
  editorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  editorTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  editorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editorLabel: { width: 52, fontSize: 14, color: colors.text, fontWeight: '600' },
  editorInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.background,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  durationInput: {
    flex: 0,
    width: 92,
    textAlign: 'right',
  },
  dayOffToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  dayOffToggleActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  dayOffToggleText: { fontSize: 14, fontWeight: '600', color: colors.text },
  dayOffToggleTextActive: { color: colors.background },
  editorActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  secondaryAction: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  secondaryActionText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  primaryAction: {
    backgroundColor: colors.text,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  primaryActionText: { fontSize: 14, fontWeight: '700', color: colors.background },

  // 月カレンダー
  monthNav: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  monthLabel: { fontSize: 16, fontWeight: '700', color: colors.text },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 },
  monthWeekday: {
    width: (SCREEN_WIDTH - 16) / 7, textAlign: 'center',
    fontSize: 11, color: colors.textSecondary, fontWeight: '600',
    paddingVertical: 4,
  },
  monthCell: {
    width: (SCREEN_WIDTH - 16) / 7, height: 44,
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  monthDayInner: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  monthDaySelected: { backgroundColor: colors.text },
  monthDayToday: { borderWidth: 1, borderColor: colors.text },
  monthDayText: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  monthDayTextSelected: { color: colors.background, fontWeight: '700' },
  monthDayTextToday: { color: colors.text, fontWeight: '700' },
});
