import React, { useState } from 'react';
import { ScrollView, StyleSheet, View, Text, TouchableOpacity, Switch, Alert, Modal } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { colors } from '../theme/colors';
import { useAppContext } from '../context/AppContext';
import ListSection from '../components/ListSection';
import ListItem from '../components/ListItem';
import { Ionicons } from '@expo/vector-icons';
import NativeTimePicker from '../components/NativeTimePicker';

const DAYS = ['日', '月', '火', '水', '木', '金', '土'];

export default function HomeScreen() {
  const {
    sleepSettings, updateSleepSettings,
    workSchedule, updateWorkSchedule,
    paydayDate, updatePaydayDate,
    clearData,
  } = useAppContext();

  const [showPaydayPicker, setShowPaydayPicker] = useState(false);

  const handleReset = () => {
    Alert.alert(
      'データをリセット',
      '全てのデータが削除されます。よろしいですか？',
      [
        { text: 'キャンセル', style: 'cancel' },
        { text: 'リセット', style: 'destructive', onPress: () => clearData() },
      ],
    );
  };

  return (
    <>
    <Modal visible={showPaydayPicker} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.pickerSheet}>
          <View style={styles.pickerHeader}>
            <View />
            <TouchableOpacity onPress={() => setShowPaydayPicker(false)}>
              <Text style={styles.pickerDone}>完了</Text>
            </TouchableOpacity>
          </View>
          <Picker
            selectedValue={paydayDate}
            onValueChange={v => updatePaydayDate(v)}
            style={{ width: '100%' }}
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
              <Picker.Item key={d} label={`${d}日`} value={d} />
            ))}
          </Picker>
        </View>
      </View>
    </Modal>
    <ScrollView style={styles.container}>

      {/* 睡眠設定 */}
      <Text style={styles.sectionLabel}>睡眠</Text>
      <ListSection>
        <ListItem
          icon="bed-outline"
          iconColor={colors.textSecondary}
          title="起床時間"
          showChevron={false}
          rightComponent={<NativeTimePicker value={sleepSettings.wakeTime} onChange={v => updateSleepSettings({ wakeTime: v })} />}
        />
        <ListItem
          icon="moon-outline"
          iconColor={colors.textSecondary}
          title="就寝時間"
          isLast
          showChevron={false}
          rightComponent={<NativeTimePicker value={sleepSettings.bedTime} onChange={v => updateSleepSettings({ bedTime: v })} />}
        />
      </ListSection>

      {/* 勤務スタイル */}
      <Text style={styles.sectionLabel}>勤務スタイル</Text>
      <ListSection>
        <ListItem
          icon="briefcase-outline"
          iconColor={colors.textSecondary}
          title="固定スケジュール"
          showChevron={false}
          isLast={workSchedule.type !== 'fixed'}
          rightComponent={
            <Switch
              value={workSchedule.type === 'fixed'}
              onValueChange={v => updateWorkSchedule({ type: v ? 'fixed' : 'shift' })}
              trackColor={{ false: colors.border, true: colors.ink }}
              thumbColor={colors.background}
            />
          }
        />
        {workSchedule.type === 'fixed' && (
          <>
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
                  <Text style={[styles.dayBtnText, workSchedule.fixedDays.includes(i) && styles.dayBtnTextActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <ListItem
              icon="time-outline"
              iconColor={colors.textSecondary}
              title="開始"
              isLast={false}
              showChevron={false}
              rightComponent={<NativeTimePicker value={workSchedule.fixedStartTime} onChange={v => updateWorkSchedule({ fixedStartTime: v })} />}
            />
            <ListItem
              icon="time-outline"
              iconColor={colors.textSecondary}
              title="終了"
              isLast
              showChevron={false}
              rightComponent={<NativeTimePicker value={workSchedule.fixedEndTime} onChange={v => updateWorkSchedule({ fixedEndTime: v })} />}
            />
          </>
        )}
      </ListSection>

      {/* 家計簿 */}
      <Text style={styles.sectionLabel}>家計簿</Text>
      <ListSection>
        <ListItem
          icon="calendar-number-outline"
          iconColor={colors.textSecondary}
          title="給料日"
          isLast
          showChevron={false}
          rightComponent={
            <TouchableOpacity style={styles.paydayButton} onPress={() => setShowPaydayPicker(true)}>
              <Text style={styles.paydayText}>{paydayDate}日</Text>
            </TouchableOpacity>
          }
        />
      </ListSection>

      {/* データ管理 */}
      <Text style={styles.sectionLabel}>データ管理</Text>
      <ListSection>
        <ListItem
          icon="refresh-circle-outline"
          iconColor={colors.textSecondary}
          title="データをリセット"
          subtitle="全データを削除して初期状態に戻す"
          isLast
          onPress={handleReset}
        />
      </ListSection>

    </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: 8 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  paydayButton: { backgroundColor: colors.borderSubtle, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  paydayText: { fontSize: 16, fontWeight: '600', color: colors.text },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
  pickerSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40 },
  pickerHeader: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  pickerDone: { fontSize: 16, fontWeight: '600', color: colors.text },
  daysRow: {
    flexDirection: 'row', gap: 6,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  dayBtn: {
    width: 34, height: 34, borderRadius: 17,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  dayBtnActive: { backgroundColor: colors.text, borderColor: colors.text },
  dayBtnText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  dayBtnTextActive: { color: colors.background },
});
