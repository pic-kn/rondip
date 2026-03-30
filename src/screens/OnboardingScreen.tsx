import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Animated, SafeAreaView, Switch, TextInput, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { requestNotificationPermission } from '../services/notifications';
import { colors } from '../theme/colors';
import { useAppContext, WorkSchedule } from '../context/AppContext';
import NativeTimePicker from '../components/NativeTimePicker';


export interface DailyRoutineItem {
  id: string;
  label: string;
  emoji: string;
  hour: number;
  minute: number;
  enabled: boolean;
}

const DEFAULT_ROUTINES: DailyRoutineItem[] = [
  { id: 'wake',      label: '起床', emoji: '', hour: 7,  minute: 0,  enabled: true },
  { id: 'breakfast', label: '朝食', emoji: '', hour: 8,  minute: 0,  enabled: true },
  { id: 'lunch',     label: '昼食', emoji: '', hour: 12, minute: 0,  enabled: true },
  { id: 'dinner',    label: '夕食', emoji: '', hour: 19, minute: 0,  enabled: true },
  { id: 'sleep',     label: '就寝', emoji: '', hour: 23, minute: 0,  enabled: true },
];

const DAYS = ['日', '月', '火', '水', '木', '金', '土'];

interface Props {
  onComplete: () => void;
}

export default function OnboardingScreen({ onComplete }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const [routines, setRoutines] = useState<DailyRoutineItem[]>(DEFAULT_ROUTINES);
  const [locationGranted, setLocationGranted] = useState(false);
  const [notifGranted, setNotifGranted] = useState(false);
  const { addChatMessage, updateWorkSchedule, updateSleepSettings, addWorkplace, addEvent } = useAppContext();

  // 固定スケジュール設定
  const [workType, setWorkType] = useState<'fixed' | 'shift'>('shift');
  const [fixedDays, setFixedDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [fixedStart, setFixedStart] = useState('09:00');
  const [fixedEnd, setFixedEnd] = useState('18:00');

  // シフト制 - 勤務先設定
  const [workplaceName, setWorkplaceName] = useState('');
  const [workplaceStart, setWorkplaceStart] = useState('09:00');
  const [workplaceEnd, setWorkplaceEnd] = useState('18:00');

  // 休み選択カレンダー
  const [selectedDaysOff, setSelectedDaysOff] = useState<string[]>([]);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());

  // 睡眠設定
  const [wakeTime, setWakeTime] = useState('07:00');
  const [bedTime, setBedTime] = useState('23:00');

  // スライド構成（workTypeに応じて動的に変わる）
  const slides = workType === 'shift'
    ? ['welcome', 'howto', 'routine', 'work', 'daysoff', 'permissions', 'start']
    : ['welcome', 'howto', 'routine', 'work', 'permissions', 'start'];

  const isLast = currentIndex === slides.length - 1;

  const transition = (next: number) => {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
    setCurrentIndex(next);
  };

  const goNext = async () => {
    const slide = slides[currentIndex];

    if (slide === 'routine') {
      const enabled = routines.filter(r => r.enabled);
      await AsyncStorage.setItem('@daily_routines', JSON.stringify(enabled));
    }

    if (slide === 'work') {
      updateWorkSchedule({ type: workType, fixedDays, fixedStartTime: fixedStart, fixedEndTime: fixedEnd });
      updateSleepSettings({ wakeTime, bedTime });
    }

    if (slide === 'daysoff') {
      // 勤務先を休み情報と一緒に保存
      addWorkplace({
        name: workplaceName || '勤務先',
        startTime: workplaceStart,
        endTime: workplaceEnd,
        daysOff: selectedDaysOff,
      });
    }

    if (currentIndex < slides.length - 1) {
      transition(currentIndex + 1);
    } else {
      finish();
    }
  };

  const finish = async () => {
    // ルーティンイベントを今日分として即時追加
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    routines.filter(r => r.enabled).forEach(r => {
      addEvent({
        id: `routine-${r.id}-${todayStr}`,
        title: r.label,
        date: todayStr,
        timeString: `${String(r.hour).padStart(2, '0')}:${String(r.minute).padStart(2, '0')}`,
        estimatedMinutes: 30,
      });
    });

    // 今日がシフト勤務日なら即時追加
    if (workType === 'shift' && workplaceName && !selectedDaysOff.includes(todayStr)) {
      const [sH, sM] = workplaceStart.split(':').map(Number);
      const [eH, eM] = workplaceEnd.split(':').map(Number);
      addEvent({
        id: `shift-${todayStr}`,
        title: workplaceName,
        date: todayStr,
        timeString: workplaceStart,
        estimatedMinutes: (eH * 60 + eM) - (sH * 60 + sM),
      });
    } else if (workType === 'fixed') {
      const dow = now.getDay();
      if (fixedDays.includes(dow)) {
        const [sH, sM] = fixedStart.split(':').map(Number);
        const [eH, eM] = fixedEnd.split(':').map(Number);
        addEvent({
          id: `shift-${todayStr}`,
          title: '勤務',
          date: todayStr,
          timeString: fixedStart,
          estimatedMinutes: (eH * 60 + eM) - (sH * 60 + sM),
        });
      }
    }

    addChatMessage({
      id: `onb-${Date.now()}`,
      role: 'assistant',
      content: '今日やることを教えてください。\n「洗濯する」「3時に歯医者」など、思ったままに話しかけてみてください。',
    });
    await AsyncStorage.setItem('hasCompletedOnboarding', 'true');
    onComplete();
  };

  const setRoutineTime = (id: string, value: string) => {
    const [h, m] = value.split(':').map(Number);
    setRoutines(prev => prev.map(r => r.id === id ? { ...r, hour: h, minute: m } : r));
  };

  const toggleRoutine = (id: string) => {
    setRoutines(prev => prev.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  };

  const requestLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    setLocationGranted(status === 'granted');
  };

  const requestNotifications = async () => {
    const granted = await requestNotificationPermission();
    setNotifGranted(granted);
  };

  const renderDaysOffCalendar = () => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    const monthStr = String(month + 1).padStart(2, '0');
    const yearStr = String(year);

    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);

    return (
      <View>
        <View style={styles.calNavRow}>
          <TouchableOpacity onPress={() => setCalendarMonth(new Date(year, month - 1, 1))} style={styles.arrowBtn}>
            <Text style={styles.arrow}>◀</Text>
          </TouchableOpacity>
          <Text style={styles.calMonthLabel}>{year}年{month + 1}月</Text>
          <TouchableOpacity onPress={() => setCalendarMonth(new Date(year, month + 1, 1))} style={styles.arrowBtn}>
            <Text style={styles.arrow}>▶</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.calDayHeaders}>
          {DAYS.map(d => (
            <Text key={d} style={[styles.calDayHeader, d === '日' && { color: '#ef4444' }, d === '土' && { color: '#3b82f6' }]}>{d}</Text>
          ))}
        </View>
        <View style={styles.calGrid}>
          {cells.map((day, i) => {
            if (!day) return <View key={`e-${i}`} style={styles.calCell} />;
            const dateStr = `${yearStr}-${monthStr}-${String(day).padStart(2, '0')}`;
            const isSelected = selectedDaysOff.includes(dateStr);
            const dow = (firstDay + day - 1) % 7;
            return (
              <TouchableOpacity
                key={dateStr}
                style={[styles.calCell, isSelected && styles.calCellSelected]}
                onPress={() => setSelectedDaysOff(prev =>
                  prev.includes(dateStr) ? prev.filter(d => d !== dateStr) : [...prev, dateStr]
                )}
              >
                <Text style={[
                  styles.calCellText,
                  isSelected && styles.calCellTextSelected,
                  !isSelected && dow === 0 && { color: '#ef4444' },
                  !isSelected && dow === 6 && { color: '#3b82f6' },
                ]}>
                  {day}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.hintText}>{selectedDaysOff.length}日選択中</Text>
      </View>
    );
  };

  const renderSlide = (slide: string) => {
    switch (slide) {
      case 'welcome':
        return (
          <View style={styles.slideContent}>
            <View style={styles.iconContainer}>
              <Ionicons name="sparkles" size={64} color={colors.text} />
            </View>
            <Text style={styles.title}>頭の中を、{'\n'}すっきりさせよう。</Text>
            <Text style={styles.body}>タスク、予定、支出。{'\n'}思ったことをそのまま話すだけで{'\n'}AIが自動で整理します。</Text>
          </View>
        );

      case 'howto':
        return (
          <View style={styles.slideContent}>
            <View style={styles.iconContainer}>
              <Ionicons name="chatbubble-ellipses-outline" size={64} color={colors.text} />
            </View>
            <Text style={styles.title}>話すだけで{'\n'}いい。</Text>
            <Text style={styles.body}>「明日10時に歯医者」{'\n'}「コンビニで500円使った」{'\n'}「洗濯しなきゃ」{'\n\n'}なんでもそのまま入力してください。</Text>
          </View>
        );

      case 'routine':
        return (
          <View style={styles.slideContent}>
            <Text style={styles.title}>あなたに合わせた{'\n'}予定を組み立てます。</Text>
            <Text style={styles.routineSubtitle}>
              毎日のスケジュールを教えてください。{'\n'}タイムラインに自動で表示されます。
            </Text>
            <View style={styles.routineList}>
              {routines.map(r => (
                <View key={r.id} style={styles.routineRow}>
                  <Switch
                    value={r.enabled}
                    onValueChange={() => toggleRoutine(r.id)}
                    trackColor={{ false: colors.border, true: colors.ink }}
                    thumbColor={colors.background}
                    style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
                  />
                  <Text style={styles.routineLabel}>{r.label}</Text>
                  {r.enabled ? (
                    <NativeTimePicker
                      value={`${String(r.hour).padStart(2, '0')}:${String(r.minute).padStart(2, '0')}`}
                      onChange={v => setRoutineTime(r.id, v)}
                    />
                  ) : (
                    <Text style={styles.disabledText}>スキップ</Text>
                  )}
                </View>
              ))}
            </View>
            <Text style={styles.hintText}>あとから変更できます</Text>
          </View>
        );

      case 'work':
        return (
          <ScrollView contentContainerStyle={styles.slideContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>働き方を{'\n'}教えてください。</Text>
            <Text style={styles.routineSubtitle}>空き時間の計算に使います。</Text>
            <View style={styles.modeRow}>
              {(['fixed', 'shift'] as const).map(mode => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.modeBtn, workType === mode && styles.modeBtnActive]}
                  onPress={() => setWorkType(mode)}
                >
                  <Text style={[styles.modeBtnText, workType === mode && styles.modeBtnTextActive]}>
                    {mode === 'fixed' ? '固定スケジュール' : 'シフト制'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {workType === 'fixed' && (
              <View style={{ marginTop: 16, gap: 12 }}>
                <View style={styles.daysRow}>
                  {DAYS.map((label, i) => (
                    <TouchableOpacity
                      key={i}
                      style={[styles.dayBtn, fixedDays.includes(i) && styles.dayBtnActive]}
                      onPress={() => setFixedDays(prev => prev.includes(i) ? prev.filter(d => d !== i) : [...prev, i])}
                    >
                      <Text style={[styles.dayBtnText, fixedDays.includes(i) && styles.dayBtnTextActive]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.workTimeRow}>
                  <Text style={styles.workTimeLabel}>開始</Text>
                  <NativeTimePicker value={fixedStart} onChange={setFixedStart} />
                </View>
                <View style={styles.workTimeRow}>
                  <Text style={styles.workTimeLabel}>終了</Text>
                  <NativeTimePicker value={fixedEnd} onChange={setFixedEnd} />
                </View>
              </View>
            )}

            {workType === 'shift' && (
              <View style={{ marginTop: 16, gap: 12 }}>
                <Text style={styles.routineSubtitle}>勤務先の名前と時間を登録します。{'\n'}次の画面で今月の休みを選べます。</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="勤務先の名前（例：○○店）"
                  placeholderTextColor={colors.border}
                  value={workplaceName}
                  onChangeText={setWorkplaceName}
                />
                <View style={styles.workTimeRow}>
                  <Text style={styles.workTimeLabel}>開始</Text>
                  <NativeTimePicker value={workplaceStart} onChange={setWorkplaceStart} />
                </View>
                <View style={styles.workTimeRow}>
                  <Text style={styles.workTimeLabel}>終了</Text>
                  <NativeTimePicker value={workplaceEnd} onChange={setWorkplaceEnd} />
                </View>
              </View>
            )}

            <View style={{ marginTop: 20, gap: 10 }}>
              <Text style={styles.routineSubtitle}>起床・就寝時間</Text>
              <View style={styles.workTimeRow}>
                <Text style={styles.workTimeLabel}>起床</Text>
                <NativeTimePicker value={wakeTime} onChange={setWakeTime} />
              </View>
              <View style={styles.workTimeRow}>
                <Text style={styles.workTimeLabel}>就寝</Text>
                <NativeTimePicker value={bedTime} onChange={setBedTime} />
              </View>
            </View>
            <Text style={styles.hintText}>あとから変更できます</Text>
          </ScrollView>
        );

      case 'daysoff':
        return (
          <ScrollView contentContainerStyle={styles.slideContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>今月の{'\n'}休みを教えて。</Text>
            <Text style={styles.routineSubtitle}>
              {workplaceName || '勤務先'}の休みの日をタップしてください。
            </Text>
            {renderDaysOffCalendar()}
            <Text style={[styles.hintText, { marginTop: 8 }]}>スキップして後から登録することもできます</Text>
          </ScrollView>
        );

      case 'permissions':
        return (
          <View style={styles.slideContent}>
            <View style={styles.iconContainer}>
              <Ionicons name="shield-checkmark-outline" size={64} color={colors.text} />
            </View>
            <Text style={styles.title}>アプリの{'\n'}準備をしよう。</Text>
            <Text style={styles.body}>より良い体験のために、{'\n'}以下の許可をお願いします。</Text>
            <View style={styles.permissionList}>
              <View style={styles.permissionRow}>
                <View style={styles.permissionInfo}>
                  <Ionicons name="location-outline" size={22} color={colors.text} />
                  <View>
                    <Text style={styles.permissionTitle}>現在地</Text>
                    <Text style={styles.permissionDesc}>移動時間の計算に使用</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.permissionBtn, locationGranted && styles.permissionBtnGranted]}
                  onPress={requestLocation}
                >
                  <Text style={[styles.permissionBtnText, locationGranted && styles.permissionBtnTextGranted]}>
                    {locationGranted ? '許可済み' : '許可する'}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.permissionRow}>
                <View style={styles.permissionInfo}>
                  <Ionicons name="notifications-outline" size={22} color={colors.text} />
                  <View>
                    <Text style={styles.permissionTitle}>通知</Text>
                    <Text style={styles.permissionDesc}>出発前のリマインダーに使用</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.permissionBtn, notifGranted && styles.permissionBtnGranted]}
                  onPress={requestNotifications}
                >
                  <Text style={[styles.permissionBtnText, notifGranted && styles.permissionBtnTextGranted]}>
                    {notifGranted ? '許可済み' : '許可する'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        );

      case 'start':
        return (
          <View style={styles.slideContent}>
            <View style={styles.iconContainer}>
              <Ionicons name="flash-outline" size={64} color={colors.text} />
            </View>
            <Text style={styles.title}>チャットから{'\n'}始めよう。</Text>
            <Text style={styles.body}>まず今日やることを{'\n'}チャットに話しかけてみてください。{'\n\n'}「洗濯する」「3時に歯医者」{'\n'}なんでもOKです。</Text>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={[styles.slide, { opacity: fadeAnim }]}>
        {renderSlide(slides[currentIndex])}
      </Animated.View>

      <View style={styles.dots}>
        {slides.map((_, i) => (
          <View key={i} style={[styles.dot, i === currentIndex && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.footer}>
        {!isLast && (
          <TouchableOpacity onPress={finish} style={styles.skipButton}>
            <Text style={styles.skipText}>スキップ</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={goNext}
          style={[styles.nextButton, isLast && styles.startButton]}
        >
          <Text style={[styles.nextText, isLast && styles.startText]}>
            {isLast ? '始める' : '次へ'}
          </Text>
          {!isLast && <Ionicons name="arrow-forward" size={16} color={colors.textSecondary} style={{ marginLeft: 4 }} />}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  slide: {
    flex: 1,
  },
  slideContent: {
    flex: 1,
    paddingHorizontal: 36,
    justifyContent: 'center',
    paddingBottom: 40,
  },
  iconContainer: {
    marginBottom: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 42,
    marginBottom: 16,
  },
  body: {
    fontSize: 16,
    color: colors.textSecondary,
    lineHeight: 28,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 24,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.text,
    width: 20,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingBottom: 40,
  },
  skipButton: {
    padding: 12,
  },
  skipText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  nextText: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '600',
  },
  startButton: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  startText: {
    color: colors.background,
    textAlign: 'center',
  },

  // Work slide
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  modeBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  modeBtnActive: { backgroundColor: colors.text, borderColor: colors.text },
  modeBtnText: { fontSize: 14, fontWeight: '600', color: colors.text },
  modeBtnTextActive: { color: colors.background },
  daysRow: { flexDirection: 'row', gap: 6 },
  dayBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dayBtnActive: { backgroundColor: colors.text, borderColor: colors.text },
  dayBtnText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  dayBtnTextActive: { color: colors.background },
  workTimeRow: { flexDirection: 'row', alignItems: 'center' },
  workTimeLabel: { width: 36, fontSize: 14, color: colors.text, fontWeight: '500' },
  textInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },

  // Routine slide
  routineSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: 20,
  },
  routineList: {
    gap: 6,
  },
  routineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  routineLabel: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    fontWeight: '500',
  },
  disabledText: {
    fontSize: 13,
    color: colors.border,
  },
  hintText: {
    fontSize: 12,
    color: colors.border,
    marginTop: 14,
    textAlign: 'center',
  },

  // Calendar
  calNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  calMonthLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  calDayHeaders: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  calDayHeader: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  calGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  calCellSelected: {
    backgroundColor: colors.text,
  },
  calCellText: {
    fontSize: 14,
    color: colors.text,
  },
  calCellTextSelected: {
    color: colors.background,
    fontWeight: '600',
  },

  // Permissions slide
  permissionList: {
    marginTop: 24,
    gap: 12,
  },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
  },
  permissionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  permissionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  permissionDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  permissionBtn: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  permissionBtnGranted: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  permissionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  permissionBtnTextGranted: {
    color: colors.background,
  },
});
