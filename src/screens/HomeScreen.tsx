import React, { useState } from 'react';
import { ScrollView, StyleSheet, View, Text, TouchableOpacity, Switch, Alert } from 'react-native';
import { colors } from '../theme/colors';
import { useAppContext } from '../context/AppContext';
import ListSection from '../components/ListSection';
import ListItem from '../components/ListItem';
import { Ionicons } from '@expo/vector-icons';

const DAYS = ['日', '月', '火', '水', '木', '金', '土'];

export default function HomeScreen() {
  const {
    sleepSettings, updateSleepSettings,
    workSchedule, updateWorkSchedule,
    paydayDate, updatePaydayDate,
    clearData,
  } = useAppContext();

  const [wakeTime, setWakeTime] = useState(sleepSettings.wakeTime);
  const [bedTime, setBedTime] = useState(sleepSettings.bedTime);

  const adjustTime = (
    getter: string,
    setter: (v: string) => void,
    saveFn: (v: string) => void,
    type: 'h' | 'm',
    delta: number,
  ) => {
    const [h, m] = getter.split(':').map(Number);
    let newVal: string;
    if (type === 'h') {
      newVal = `${String((h + delta + 24) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    } else {
      newVal = `${String(h).padStart(2, '0')}:${String((m + delta + 60) % 60).padStart(2, '0')}`;
    }
    setter(newVal);
    saveFn(newVal);
  };

  const renderTimePicker = (
    value: string,
    setter: (v: string) => void,
    saveFn: (v: string) => void,
  ) => {
    const [h, m] = value.split(':').map(Number);
    return (
      <View style={styles.timePicker}>
        <TouchableOpacity onPress={() => adjustTime(value, setter, saveFn, 'h', -1)} style={styles.arrowBtn}>
          <Text style={styles.arrow}>◀</Text>
        </TouchableOpacity>
        <Text style={styles.timeText}>{String(h).padStart(2, '0')}</Text>
        <TouchableOpacity onPress={() => adjustTime(value, setter, saveFn, 'h', 1)} style={styles.arrowBtn}>
          <Text style={styles.arrow}>▶</Text>
        </TouchableOpacity>
        <Text style={styles.timeColon}>:</Text>
        <TouchableOpacity onPress={() => adjustTime(value, setter, saveFn, 'm', -15)} style={styles.arrowBtn}>
          <Text style={styles.arrow}>◀</Text>
        </TouchableOpacity>
        <Text style={styles.timeText}>{String(m).padStart(2, '0')}</Text>
        <TouchableOpacity onPress={() => adjustTime(value, setter, saveFn, 'm', 15)} style={styles.arrowBtn}>
          <Text style={styles.arrow}>▶</Text>
        </TouchableOpacity>
      </View>
    );
  };

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
    <ScrollView style={styles.container}>

      {/* 睡眠設定 */}
      <Text style={styles.sectionLabel}>睡眠</Text>
      <ListSection>
        <ListItem
          icon="bed-outline"
          iconColor={colors.textSecondary}
          title="起床時間"
          showChevron={false}
          rightComponent={renderTimePicker(wakeTime, setWakeTime, v => updateSleepSettings({ wakeTime: v }))}
        />
        <ListItem
          icon="moon-outline"
          iconColor={colors.textSecondary}
          title="就寝時間"
          isLast
          showChevron={false}
          rightComponent={renderTimePicker(bedTime, setBedTime, v => updateSleepSettings({ bedTime: v }))}
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
              rightComponent={renderTimePicker(
                workSchedule.fixedStartTime,
                v => updateWorkSchedule({ fixedStartTime: v }),
                v => updateWorkSchedule({ fixedStartTime: v }),
              )}
            />
            <ListItem
              icon="time-outline"
              iconColor={colors.textSecondary}
              title="終了"
              isLast
              showChevron={false}
              rightComponent={renderTimePicker(
                workSchedule.fixedEndTime,
                v => updateWorkSchedule({ fixedEndTime: v }),
                v => updateWorkSchedule({ fixedEndTime: v }),
              )}
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
            <View style={styles.timePicker}>
              <TouchableOpacity onPress={() => updatePaydayDate(((paydayDate - 2 + 31) % 31) + 1)} style={styles.arrowBtn}>
                <Text style={styles.arrow}>◀</Text>
              </TouchableOpacity>
              <Text style={styles.timeText}>{String(paydayDate).padStart(2, '0')}</Text>
              <Text style={[styles.timeColon, { fontSize: 13 }]}>日</Text>
              <TouchableOpacity onPress={() => updatePaydayDate((paydayDate % 31) + 1)} style={styles.arrowBtn}>
                <Text style={styles.arrow}>▶</Text>
              </TouchableOpacity>
            </View>
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
  timePicker: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  arrowBtn: { padding: 4 },
  arrow: { fontSize: 11, color: colors.textSecondary },
  timeText: { fontSize: 16, fontWeight: '600', color: colors.text, minWidth: 24, textAlign: 'center' },
  timeColon: { fontSize: 16, fontWeight: '600', color: colors.text, marginHorizontal: 1 },
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
