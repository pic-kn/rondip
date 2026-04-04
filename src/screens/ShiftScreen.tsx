import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useAppContext, WorkplacePattern } from '../context/AppContext';
import NativeDatePicker from '../components/NativeDatePicker';
import NativeTimePicker from '../components/NativeTimePicker';

const DAYS = ['日', '月', '火', '水', '木', '金', '土'];
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

type PatternDraft = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  weekdays: number[];
  appliesOnHolidays: boolean;
};

const toLocalDateStr = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const formatDate = (dateStr: string): string => {
  const d = new Date(dateStr + 'T12:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}(${DAYS[d.getDay()]})`;
};

const makePatternDraft = (index: number, overrides?: Partial<PatternDraft>): PatternDraft => ({
  id: `draft-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
  name: overrides?.name || `勤務パターン${index + 1}`,
  startTime: overrides?.startTime || '09:00',
  endTime: overrides?.endTime || '18:00',
  weekdays: overrides?.weekdays || [...ALL_WEEKDAYS],
  appliesOnHolidays: overrides?.appliesOnHolidays || false,
});

const formatPatternDays = (pattern: { weekdays: number[]; appliesOnHolidays?: boolean }): string => {
  const labels = [...pattern.weekdays].sort((a, b) => a - b).map(day => DAYS[day]);
  if (pattern.appliesOnHolidays) labels.push('祝');
  return labels.length > 0 ? labels.join(' ') : '未設定';
};

const getPrimaryPattern = (patterns?: WorkplacePattern[]) =>
  (patterns && patterns.length > 0 ? patterns[0] : null);

export default function ShiftScreen() {
  const {
    workSchedule, sleepSettings,
    updateWorkSchedule, updateSleepSettings,
    addWorkplace, deleteWorkplace, setActiveWorkplace,
    addDayOff, removeDayOff, addShiftOverride, removeShiftOverride,
  } = useAppContext();
  const workplaces = workSchedule.workplaces || [];
  const shiftOverrides = workSchedule.shiftOverrides || [];

  const [showAddWorkplace, setShowAddWorkplace] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPatterns, setNewPatterns] = useState<PatternDraft[]>([makePatternDraft(0, { name: '通常勤務' })]);

  const [addingDayOffFor, setAddingDayOffFor] = useState<string | null>(null);
  const [newDayOff, setNewDayOff] = useState(toLocalDateStr(new Date()));
  const [showShiftAdjustForm, setShowShiftAdjustForm] = useState(false);
  const [adjustDate, setAdjustDate] = useState(toLocalDateStr(new Date()));
  const [adjustStart, setAdjustStart] = useState('09:00');
  const [adjustEnd, setAdjustEnd] = useState('18:00');
  const [adjustIsDayOff, setAdjustIsDayOff] = useState(false);

  const activeWp = workplaces.find(w => w.id === workSchedule.activeWorkplaceId);
  const upcomingOverrides = activeWp
    ? shiftOverrides.filter(ov => ov.workplaceId === activeWp.id && ov.date >= toLocalDateStr(new Date())).sort((a, b) => a.date.localeCompare(b.date))
    : [];
  const basePattern = activeWp ? getPrimaryPattern(activeWp.patterns) : null;

  const canSaveWorkplace = useMemo(() => {
    if (!newName.trim() || newPatterns.length === 0) return false;
    return newPatterns.every(pattern => pattern.name.trim() && (pattern.weekdays.length > 0 || pattern.appliesOnHolidays));
  }, [newName, newPatterns]);

  const togglePatternWeekday = (patternId: string, weekday: number) => {
    setNewPatterns(prev => prev.map(pattern => {
      if (pattern.id !== patternId) return pattern;
      const weekdays = pattern.weekdays.includes(weekday)
        ? pattern.weekdays.filter(day => day !== weekday)
        : [...pattern.weekdays, weekday].sort((a, b) => a - b);
      return { ...pattern, weekdays };
    }));
  };

  const updatePatternDraft = (patternId: string, changes: Partial<PatternDraft>) => {
    setNewPatterns(prev => prev.map(pattern => pattern.id === patternId ? { ...pattern, ...changes } : pattern));
  };

  const addPatternDraft = () => {
    setNewPatterns(prev => [...prev, makePatternDraft(prev.length)]);
  };

  const removePatternDraft = (patternId: string) => {
    setNewPatterns(prev => prev.length === 1 ? prev : prev.filter(pattern => pattern.id !== patternId));
  };

  const resetWorkplaceForm = () => {
    setNewName('');
    setShowAddWorkplace(false);
    setNewPatterns([makePatternDraft(0, { name: '通常勤務' })]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 60 }}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>働き方</Text>
        <View style={styles.modeRow}>
          {(['fixed', 'shift'] as const).map(mode => (
            <TouchableOpacity
              key={mode}
              style={[styles.modeBtn, workSchedule.type === mode && styles.modeBtnActive]}
              onPress={() => updateWorkSchedule({ type: mode })}
            >
              <Text style={[styles.modeBtnText, workSchedule.type === mode && styles.modeBtnTextActive]}>
                {mode === 'fixed' ? '固定スケジュール' : 'シフト制'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {workSchedule.type === 'fixed' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>勤務曜日</Text>
          <View style={styles.daysRow}>
            {DAYS.map((label, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.dayBtn, workSchedule.fixedDays.includes(i) && styles.dayBtnActive]}
                onPress={() => {
                  const days = workSchedule.fixedDays.includes(i)
                    ? workSchedule.fixedDays.filter(d => d !== i)
                    : [...workSchedule.fixedDays, i];
                  updateWorkSchedule({ fixedDays: days });
                }}
              >
                <Text style={[styles.dayBtnText, workSchedule.fixedDays.includes(i) && styles.dayBtnTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.timeRow}>
            <Text style={styles.timeLabel}>開始</Text>
            <NativeTimePicker value={workSchedule.fixedStartTime} onChange={v => updateWorkSchedule({ fixedStartTime: v })} />
          </View>
          <View style={styles.timeRow}>
            <Text style={styles.timeLabel}>終了</Text>
            <NativeTimePicker value={workSchedule.fixedEndTime} onChange={v => updateWorkSchedule({ fixedEndTime: v })} />
          </View>
        </View>
      )}

      {workSchedule.type === 'shift' && (
        <>
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>勤務先</Text>
              <TouchableOpacity onPress={() => showAddWorkplace ? resetWorkplaceForm() : setShowAddWorkplace(true)} style={styles.addBtn}>
                <Ionicons name={showAddWorkplace ? 'close' : 'add'} size={18} color={colors.text} />
                <Text style={styles.addBtnText}>{showAddWorkplace ? '閉じる' : '追加'}</Text>
              </TouchableOpacity>
            </View>

            {showAddWorkplace && (
              <View style={styles.addForm}>
                <TextInput
                  style={styles.nameInput}
                  placeholder="勤務先名（例：A店、本社）"
                  placeholderTextColor={colors.textSecondary}
                  value={newName}
                  onChangeText={setNewName}
                />

                {newPatterns.map((pattern, index) => (
                  <View key={pattern.id} style={styles.patternCard}>
                    <View style={styles.patternHeader}>
                      <TextInput
                        style={styles.patternNameInput}
                        placeholder={`勤務パターン${index + 1}`}
                        placeholderTextColor={colors.textSecondary}
                        value={pattern.name}
                        onChangeText={value => updatePatternDraft(pattern.id, { name: value })}
                      />
                      {newPatterns.length > 1 && (
                        <TouchableOpacity onPress={() => removePatternDraft(pattern.id)} style={styles.patternDeleteBtn}>
                          <Ionicons name="trash-outline" size={16} color={colors.textSecondary} />
                        </TouchableOpacity>
                      )}
                    </View>

                    <View style={styles.timeRow}>
                      <Text style={styles.timeLabel}>開始</Text>
                      <NativeTimePicker value={pattern.startTime} onChange={value => updatePatternDraft(pattern.id, { startTime: value })} />
                    </View>
                    <View style={styles.timeRow}>
                      <Text style={styles.timeLabel}>終了</Text>
                      <NativeTimePicker value={pattern.endTime} onChange={value => updatePatternDraft(pattern.id, { endTime: value })} />
                    </View>

                    <Text style={styles.patternSectionLabel}>適用曜日</Text>
                    <View style={styles.chipsRow}>
                      {DAYS.map((label, dayIndex) => {
                        const selected = pattern.weekdays.includes(dayIndex);
                        return (
                          <TouchableOpacity
                            key={`${pattern.id}-${label}`}
                            style={[styles.chip, selected && styles.chipActive]}
                            onPress={() => togglePatternWeekday(pattern.id, dayIndex)}
                          >
                            <Text style={[styles.chipText, selected && styles.chipTextActive]}>{label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <TouchableOpacity
                      style={[styles.holidayToggle, pattern.appliesOnHolidays && styles.holidayToggleActive]}
                      onPress={() => updatePatternDraft(pattern.id, { appliesOnHolidays: !pattern.appliesOnHolidays })}
                    >
                      <Ionicons
                        name={pattern.appliesOnHolidays ? 'checkmark-circle' : 'ellipse-outline'}
                        size={18}
                        color={pattern.appliesOnHolidays ? colors.background : colors.textSecondary}
                      />
                      <Text style={[styles.holidayToggleText, pattern.appliesOnHolidays && styles.holidayToggleTextActive]}>
                        祝日にも適用
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}

                <TouchableOpacity style={styles.secondaryBtn} onPress={addPatternDraft}>
                  <Ionicons name="add" size={16} color={colors.text} />
                  <Text style={styles.secondaryBtnText}>勤務パターンを追加</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.saveBtn, !canSaveWorkplace && { opacity: 0.4 }]}
                  disabled={!canSaveWorkplace}
                  onPress={() => {
                    const primaryPattern = newPatterns[0];
                    addWorkplace({
                      name: newName.trim(),
                      startTime: primaryPattern.startTime,
                      endTime: primaryPattern.endTime,
                      daysOff: [],
                      patterns: newPatterns.map(pattern => ({
                        id: pattern.id,
                        name: pattern.name.trim() || '勤務パターン',
                        startTime: pattern.startTime,
                        endTime: pattern.endTime,
                        weekdays: pattern.weekdays,
                        appliesOnHolidays: pattern.appliesOnHolidays,
                      })),
                    });
                    resetWorkplaceForm();
                  }}
                >
                  <Text style={styles.saveBtnText}>保存</Text>
                </TouchableOpacity>
              </View>
            )}

            {workplaces.length === 0 && !showAddWorkplace && (
              <Text style={styles.emptyText}>勤務先を登録してください</Text>
            )}

            {workplaces.map(wp => (
              <TouchableOpacity
                key={wp.id}
                style={[styles.workplaceRow, workSchedule.activeWorkplaceId === wp.id && styles.workplaceRowActive]}
                onPress={() => setActiveWorkplace(wp.id)}
                activeOpacity={0.7}
              >
                <View style={styles.workplaceInfo}>
                  {workSchedule.activeWorkplaceId === wp.id && <View style={styles.activeDot} />}
                  <View style={styles.workplaceMeta}>
                    <Text style={styles.workplaceName}>{wp.name}</Text>
                    {(wp.patterns || []).map(pattern => (
                      <Text key={pattern.id} style={styles.patternSummary}>
                        {pattern.name} · {formatPatternDays(pattern)} · {pattern.startTime} — {pattern.endTime}
                      </Text>
                    ))}
                  </View>
                </View>
                <TouchableOpacity onPress={() => deleteWorkplace(wp.id)} style={styles.deleteBtn}>
                  <Ionicons name="trash-outline" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </View>

          {activeWp && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{activeWp.name} の休み</Text>
                <TouchableOpacity
                  onPress={() => { setAddingDayOffFor(addingDayOffFor ? null : activeWp.id); setNewDayOff(toLocalDateStr(new Date())); }}
                  style={styles.addBtn}
                >
                  <Ionicons name={addingDayOffFor ? 'close' : 'add'} size={18} color={colors.text} />
                  <Text style={styles.addBtnText}>{addingDayOffFor ? '閉じる' : '休みを追加'}</Text>
                </TouchableOpacity>
              </View>

              {addingDayOffFor === activeWp.id && (
                <View style={styles.addForm}>
                  <View style={styles.timeRow}>
                    <Text style={styles.timeLabel}>日付</Text>
                    <NativeDatePicker value={newDayOff} onChange={setNewDayOff} />
                  </View>
                  <TouchableOpacity
                    style={styles.saveBtn}
                    onPress={() => { addDayOff(activeWp.id, newDayOff); setAddingDayOffFor(null); }}
                  >
                    <Text style={styles.saveBtnText}>登録</Text>
                  </TouchableOpacity>
                </View>
              )}

              {(() => {
                const today = toLocalDateStr(new Date());
                const upcoming = (activeWp.daysOff || []).filter(d => d >= today).sort();
                return upcoming.length === 0
                  ? <Text style={styles.emptyText}>登録済みの休みはありません</Text>
                  : upcoming.map(d => (
                    <View key={d} style={styles.dayOffRow}>
                      <Text style={styles.dayOffDate}>{formatDate(d)}</Text>
                      <TouchableOpacity onPress={() => removeDayOff(activeWp.id, d)} style={styles.deleteBtn}>
                        <Ionicons name="close-circle-outline" size={18} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                  ));
              })()}
            </View>
          )}

          {activeWp && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{activeWp.name} の個別調整</Text>
                <TouchableOpacity
                  onPress={() => {
                    setShowShiftAdjustForm(v => !v);
                    setAdjustDate(toLocalDateStr(new Date()));
                    setAdjustStart(basePattern?.startTime || activeWp.startTime);
                    setAdjustEnd(basePattern?.endTime || activeWp.endTime);
                    setAdjustIsDayOff(false);
                  }}
                  style={styles.addBtn}
                >
                  <Ionicons name={showShiftAdjustForm ? 'close' : 'create-outline'} size={18} color={colors.text} />
                  <Text style={styles.addBtnText}>{showShiftAdjustForm ? '閉じる' : '調整を追加'}</Text>
                </TouchableOpacity>
              </View>

              {showShiftAdjustForm && (
                <View style={styles.addForm}>
                  <View style={styles.timeRow}>
                    <Text style={styles.timeLabel}>日付</Text>
                    <NativeDatePicker value={adjustDate} onChange={setAdjustDate} />
                  </View>

                  <TouchableOpacity
                    style={[styles.holidayToggle, adjustIsDayOff && styles.holidayToggleActive]}
                    onPress={() => setAdjustIsDayOff(v => !v)}
                  >
                    <Ionicons
                      name={adjustIsDayOff ? 'checkmark-circle' : 'ellipse-outline'}
                      size={18}
                      color={adjustIsDayOff ? colors.background : colors.textSecondary}
                    />
                    <Text style={[styles.holidayToggleText, adjustIsDayOff && styles.holidayToggleTextActive]}>
                      この日は休みにする
                    </Text>
                  </TouchableOpacity>

                  {!adjustIsDayOff && (
                    <>
                      <View style={styles.timeRow}>
                        <Text style={styles.timeLabel}>開始</Text>
                        <NativeTimePicker value={adjustStart} onChange={setAdjustStart} />
                      </View>
                      <View style={styles.timeRow}>
                        <Text style={styles.timeLabel}>終了</Text>
                        <NativeTimePicker value={adjustEnd} onChange={setAdjustEnd} />
                      </View>
                    </>
                  )}

                  <TouchableOpacity
                    style={styles.saveBtn}
                    onPress={() => {
                      addShiftOverride({
                        workplaceId: activeWp.id,
                        date: adjustDate,
                        isDayOff: adjustIsDayOff,
                        startTime: adjustIsDayOff ? undefined : adjustStart,
                        endTime: adjustIsDayOff ? undefined : adjustEnd,
                      });
                      setShowShiftAdjustForm(false);
                    }}
                  >
                    <Text style={styles.saveBtnText}>保存</Text>
                  </TouchableOpacity>
                </View>
              )}

              {upcomingOverrides.length === 0 && !showShiftAdjustForm && (
                <Text style={styles.emptyText}>個別調整はまだありません</Text>
              )}

              {upcomingOverrides.map(ov => (
                <View key={ov.id} style={styles.dayOffRow}>
                  <View style={styles.overrideInfo}>
                    <Text style={styles.dayOffDate}>{formatDate(ov.date)}</Text>
                    <Text style={styles.overrideMeta}>
                      {ov.isDayOff ? '終日休み' : `${ov.startTime} — ${ov.endTime}`}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => removeShiftOverride(ov.id)} style={styles.deleteBtn}>
                    <Ionicons name="close-circle-outline" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>睡眠設定</Text>
        <View style={styles.timeRow}>
          <Text style={styles.timeLabel}>起床時間</Text>
          <NativeTimePicker value={sleepSettings.wakeTime} onChange={v => updateSleepSettings({ wakeTime: v })} />
        </View>
        <View style={styles.timeRow}>
          <Text style={styles.timeLabel}>就寝時間</Text>
          <NativeTimePicker value={sleepSettings.bedTime} onChange={v => updateSleepSettings({ bedTime: v })} />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  section: {
    backgroundColor: colors.surface, marginHorizontal: 16, marginTop: 16,
    borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.borderSubtle,
  },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, letterSpacing: 1, marginBottom: 12 },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  modeBtnActive: { backgroundColor: colors.text, borderColor: colors.text },
  modeBtnText: { fontSize: 14, fontWeight: '600', color: colors.text },
  modeBtnTextActive: { color: colors.background },
  daysRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  dayBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dayBtnActive: { backgroundColor: colors.text, borderColor: colors.text },
  dayBtnText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  dayBtnTextActive: { color: colors.background },
  timeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  timeLabel: { width: 64, fontSize: 14, color: colors.text, fontWeight: '500' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4 },
  addBtnText: { fontSize: 13, fontWeight: '600', color: colors.text },
  addForm: { backgroundColor: colors.background, borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: colors.borderSubtle },
  nameInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, fontSize: 14, color: colors.text, backgroundColor: colors.background },
  saveBtn: { backgroundColor: colors.text, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 8 },
  saveBtnText: { color: colors.background, fontWeight: '600', fontSize: 14 },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 10, marginTop: 4 },
  secondaryBtnText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  workplaceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
  workplaceRowActive: { backgroundColor: 'rgba(0,0,0,0.02)', borderRadius: 10, paddingHorizontal: 8, marginHorizontal: -8 },
  workplaceInfo: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  workplaceMeta: { flex: 1 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.text, marginTop: 6 },
  workplaceName: { fontSize: 15, fontWeight: '600', color: colors.text },
  patternSummary: { fontSize: 12, color: colors.textSecondary, marginTop: 4, lineHeight: 17 },
  deleteBtn: { padding: 6 },
  dayOffRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
  dayOffDate: { flex: 1, fontSize: 14, color: colors.text },
  overrideInfo: { flex: 1 },
  overrideMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', paddingVertical: 12 },
  patternCard: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    backgroundColor: colors.surface,
  },
  patternHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  patternNameInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.background,
  },
  patternDeleteBtn: { marginLeft: 8, padding: 8 },
  patternSectionLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5, marginBottom: 10 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: {
    minWidth: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  chipActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  chipTextActive: { color: colors.background },
  holidayToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  holidayToggleActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  holidayToggleText: { fontSize: 14, fontWeight: '600', color: colors.text },
  holidayToggleTextActive: { color: colors.background },
});
