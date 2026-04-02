import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useAppContext } from '../context/AppContext';
import NativeDatePicker from '../components/NativeDatePicker';
import NativeTimePicker from '../components/NativeTimePicker';

const DAYS = ['日', '月', '火', '水', '木', '金', '土'];

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
  const [newStart, setNewStart] = useState('09:00');
  const [newEnd, setNewEnd] = useState('18:00');

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

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 60 }}>

      {/* モード切替 */}
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

      {/* 固定スケジュール */}
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

      {/* シフト制 */}
      {workSchedule.type === 'shift' && (
        <>
          {/* 勤務先一覧 */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>勤務先</Text>
              <TouchableOpacity onPress={() => setShowAddWorkplace(v => !v)} style={styles.addBtn}>
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
                <View style={styles.timeRow}>
                  <Text style={styles.timeLabel}>開始</Text>
                  <NativeTimePicker value={newStart} onChange={setNewStart} />
                </View>
                <View style={styles.timeRow}>
                  <Text style={styles.timeLabel}>終了</Text>
                  <NativeTimePicker value={newEnd} onChange={setNewEnd} />
                </View>
                <TouchableOpacity
                  style={[styles.saveBtn, !newName.trim() && { opacity: 0.4 }]}
                  disabled={!newName.trim()}
                  onPress={() => {
                    addWorkplace({ name: newName.trim(), startTime: newStart, endTime: newEnd });
                    setNewName(''); setShowAddWorkplace(false);
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
                  {workSchedule.activeWorkplaceId === wp.id && (
                    <View style={styles.activeDot} />
                  )}
                  <View>
                    <Text style={styles.workplaceName}>{wp.name}</Text>
                    <Text style={styles.workplaceTime}>{wp.startTime} — {wp.endTime}</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => deleteWorkplace(wp.id)} style={styles.deleteBtn}>
                  <Ionicons name="trash-outline" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </View>

          {/* 休み登録 */}
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

              {/* 今月・来月の休み */}
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
                    setAdjustStart(activeWp.startTime);
                    setAdjustEnd(activeWp.endTime);
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
                    style={[styles.overrideTypeBtn, adjustIsDayOff && styles.overrideTypeBtnActive]}
                    onPress={() => setAdjustIsDayOff(v => !v)}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name={adjustIsDayOff ? 'checkmark-circle' : 'ellipse-outline'}
                      size={18}
                      color={adjustIsDayOff ? colors.background : colors.textSecondary}
                    />
                    <Text style={[styles.overrideTypeText, adjustIsDayOff && styles.overrideTypeTextActive]}>
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

      {/* 睡眠設定 */}
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
  saveBtn: { backgroundColor: colors.text, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 4 },
  saveBtnText: { color: colors.background, fontWeight: '600', fontSize: 14 },
  workplaceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
  workplaceRowActive: { backgroundColor: 'rgba(0,0,0,0.02)', borderRadius: 10, paddingHorizontal: 8, marginHorizontal: -8 },
  workplaceInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.text },
  workplaceName: { fontSize: 15, fontWeight: '600', color: colors.text },
  workplaceTime: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  deleteBtn: { padding: 6 },
  dayOffRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
  dayOffDate: { flex: 1, fontSize: 14, color: colors.text },
  overrideInfo: { flex: 1 },
  overrideMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  overrideTypeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  overrideTypeBtnActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  overrideTypeText: { fontSize: 14, fontWeight: '600', color: colors.text },
  overrideTypeTextActive: { color: colors.background },
  emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', paddingVertical: 12 },
});
