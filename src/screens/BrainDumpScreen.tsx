import React, { useState, useRef, useEffect } from 'react';
import * as Haptics from 'expo-haptics';
import { View, StyleSheet, TextInput, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity, Text, ActivityIndicator, Modal, Animated, FlatList } from 'react-native';
import { Clipboard } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { processUserText, generateGreeting, generateSuggestions } from '../services/gemini';
import { Ionicons } from '@expo/vector-icons';
import { useAppContext } from '../context/AppContext';
import { ChatMessage, ChatSession, Task, AppEvent } from '../types';
import { useLocation } from '../hooks/useLocation';
import { getGoogleMapsUrl, getTravelTimes } from '../services/maps';
import { scheduleDepartureAlert, scheduleEventReminder } from '../services/notifications';
import { Linking } from 'react-native';

const formatDuration = (minutes: number): string => {
  if (minutes < 60) return `${minutes}分`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
};

const fmt = (n: number) => `¥${Math.round(n || 0).toLocaleString()}`;

// Module-level sync flag
let globalHasRoutinesSynced = false;

// ローカルタイムゾーンでYYYY-MM-DDを生成するヘルパー
const toLocalDateString = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const formatMoney = (amount: number) => `¥${Math.round(amount || 0).toLocaleString()}`;

const timeToMinutes = (timeString: string): number => {
  const [hour, minute] = timeString.split(':').map(Number);
  return hour * 60 + minute;
};

const minutesToTime = (minutes: number): string => {
  const safeMinutes = ((minutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hour = Math.floor(safeMinutes / 60);
  const minute = safeMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const buildScheduleConflictSuggestion = (
  target: { date: string; timeString: string; estimatedMinutes: number; title: string },
  existingEvents: AppEvent[],
  ignoreEventId?: string
) => {
  if (!target.timeString || target.timeString === '00:00') return null;

  const targetStart = timeToMinutes(target.timeString);
  const targetEnd = targetStart + (target.estimatedMinutes || 60);
  const dayEvents = existingEvents
    .filter(event => event.date === target.date && event.id !== ignoreEventId && event.timeString !== '00:00')
    .map(event => ({
      ...event,
      start: timeToMinutes(event.timeString),
      end: timeToMinutes(event.timeString) + (event.estimatedMinutes || 60),
    }))
    .sort((a, b) => a.start - b.start);

  const overlappingEvents = dayEvents.filter(event => targetStart < event.end && targetEnd > event.start);
  if (overlappingEvents.length === 0) return null;

  const suggestedStarts = new Set<number>();
  const candidateStarts = [
    targetStart,
    ...overlappingEvents.flatMap(event => [
      Math.max(6 * 60, event.start - target.estimatedMinutes),
      event.end,
    ]),
  ];

  candidateStarts.forEach(candidateStart => {
    const candidateEnd = candidateStart + target.estimatedMinutes;
    const hasConflict = dayEvents.some(event => candidateStart < event.end && candidateEnd > event.start);
    if (!hasConflict) {
      suggestedStarts.add(candidateStart);
    }
  });

  if (suggestedStarts.size === 0) {
    let fallbackStart = targetStart;
    for (const event of dayEvents) {
      if (fallbackStart < event.end && fallbackStart + target.estimatedMinutes > event.start) {
        fallbackStart = event.end;
      }
    }
    suggestedStarts.add(fallbackStart);
  }

  const splittableOverlap = overlappingEvents.find(event => {
    if (event.id.startsWith('routine-') || event.id.startsWith('shift-') || event.id.startsWith('task-')) {
      return false;
    }
    const beforeMinutes = targetStart - event.start;
    const afterMinutes = event.end - targetEnd;
    return targetStart > event.start && targetEnd < event.end && beforeMinutes >= 10 && afterMinutes >= 10;
  });

  return {
    overlaps: overlappingEvents,
    suggestedTimes: Array.from(suggestedStarts)
      .sort((a, b) => Math.abs(a - targetStart) - Math.abs(b - targetStart))
      .slice(0, 3)
      .map(minutesToTime),
    splitEvent: splittableOverlap
      ? {
          id: splittableOverlap.id,
          title: splittableOverlap.title,
          location: splittableOverlap.location,
          date: splittableOverlap.date,
          originalStart: splittableOverlap.timeString,
          originalDuration: splittableOverlap.estimatedMinutes || 60,
          beforeStart: minutesToTime(splittableOverlap.start),
          beforeDuration: targetStart - splittableOverlap.start,
          afterStart: minutesToTime(targetEnd),
          afterDuration: splittableOverlap.end - targetEnd,
        }
      : null,
  };
};

const summarizeBudgetUpdate = (data: any) => {
  const changes: string[] = [];
  if (data?.jpyCash !== undefined) changes.push(`現金 ${formatMoney(Number(data.jpyCash) || 0)}`);
  if (data?.usdAmount !== undefined) changes.push(`USD ${(Number(data.usdAmount) || 0).toLocaleString()}`);
  if (data?.monthlyFixedCosts !== undefined) changes.push(`固定費 ${formatMoney(Number(data.monthlyFixedCosts) || 0)}`);
  if (data?.setupDone === true) changes.push('家計簿の初期設定');
  return changes.length > 0 ? changes.join(' / ') : '資産情報';
};

const isConvenienceStoreTrip = (title: string, location?: string) => {
  const text = `${title} ${location || ''}`.toLowerCase();
  return ['コンビニ', '7-eleven', 'seven eleven', 'セブン', 'ローソン', 'lawson', 'ファミマ', 'familymart', 'ミニストップ']
    .some(keyword => text.includes(keyword));
};

const parseShoppingSubtasks = (input: string) =>
  input
    .split(/[、,\n・]/)
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

export default function BrainDumpScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const [sessionModalVisible, setSessionModalVisible] = useState(false);
  const sessionOverlayAnim = useRef(new Animated.Value(0)).current;
  const sessionSlideAnim = useRef(new Animated.Value(300)).current;

  const openSessionModal = () => {
    setSessionModalVisible(true);
    Animated.parallel([
      Animated.timing(sessionOverlayAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(sessionSlideAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start();
  };

  const closeSessionModal = () => {
    Animated.parallel([
      Animated.timing(sessionOverlayAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(sessionSlideAnim, { toValue: 300, duration: 220, useNativeDriver: true }),
    ]).start(() => setSessionModalVisible(false));
  };

  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    label: string;
    onConfirm?: () => void;
    choices?: { label: string; onSelect: () => void; primary?: boolean }[];
    confirmText?: string;
  } | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [fetchingSuggestions, setFetchingSuggestions] = useState(false);

  const { 
    tasks, budgetBalance, events, chatHistory, addChatMessage, addTask, updateTask, deleteTask, 
    addExpense, addIncome, addEvent, updateEvent, deleteEvent, syncRoutines, aiFeatureState, completeTask, 
    chatSessions, currentSessionId, createNewSession, switchSession, deleteSession, 
    getAvailableMinutes, financialAssets, updateFinancialAssets, userProfile, addUserInsight
  } = useAppContext();

  const [dismissedEventIds, setDismissedEventIds] = useState<Set<string>>(new Set());
  const [recentlyCompletedTaskIds, setRecentlyCompletedTaskIds] = useState<Set<string>>(new Set());
  const [cardHeight, setCardHeight] = useState(0);
  const cardAnim = useRef(new Animated.Value(0)).current;
  const lastSuggestionFetch = useRef<number>(0);
  const SUGGESTION_COOLDOWN = 5 * 60 * 1000;
  const locationData = useLocation();
  const currentCity = locationData.city;
  const scrollViewRef = useRef<ScrollView>(null);
  const [lastFailedText, setLastFailedText] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const [weather, setWeather] = useState<string>('晴れ'); 

  const refreshAI = async (isAuto = false) => {
    if (fetchingSuggestions) return;
    if (isAuto && aiFeatureState.hasInitialFetched) return;

    try {
      setFetchingSuggestions(true);
      const s = await generateSuggestions(tasks, budgetBalance, events, new Date().toLocaleTimeString(), weather, currentCity);
      setSuggestions(s);
      if (isAuto) aiFeatureState.setInitialFetched(true);
    } catch (e) {
      console.warn("Failed to fetch AI components", e);
    } finally {
      setFetchingSuggestions(false);
    }
  };

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8 }}>
          <TouchableOpacity onPress={openSessionModal} style={{ padding: 8 }}>
            <Ionicons name="time-outline" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [createNewSession]);

  useEffect(() => {
    if (locationData.coords) {
      const { latitude, longitude } = locationData.coords;
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=weather_code,temperature_2m&timezone=auto`)
        .then(res => res.json())
        .then(data => {
          if (data.current) {
            const code = data.current.weather_code;
            const temp = data.current.temperature_2m;
            let desc = '晴れ';
            if (code >= 1 && code <= 3) desc = '曇り';
            else if (code >= 45 && code <= 48) desc = '霧';
            else if (code >= 51 && code <= 65) desc = '雨';
            else if (code >= 71 && code <= 77) desc = '雪';
            else if (code >= 80 && code <= 82) desc = 'にわか雨';
            else if (code >= 95) desc = '雷雨';
            setWeather(`${desc} ${temp}℃`);
          }
        })
        .catch(err => console.warn('Weather fetch error:', err));
    }
  }, [locationData.coords]);

  useEffect(() => {
    Animated.timing(cardAnim, {
      toValue: 1,
      duration: 800,
      delay: 250,
      useNativeDriver: true,
    }).start();
  }, []);

  const handleCopyMessage = async (msg: ChatMessage) => {
    Clipboard.setString(msg.content);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopiedMessageId(msg.id);
    setTimeout(() => {
      setCopiedMessageId(current => current === msg.id ? null : current);
    }, 1500);
  };

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleScheduleCheck = () => {
    const todayEvents = events
      .filter(e => e.date === toLocalDateString(new Date()) && !e.id.startsWith('routine-'))
      .sort((a, b) => a.timeString.localeCompare(b.timeString))
      .slice(0, 5);
    const msg: ChatMessage = {
      id: Date.now().toString(),
      role: 'assistant',
      content: todayEvents.length > 0 ? '今日のスケジュールはこんな感じです。' : '今日の予定はまだありません。',
      actionType: todayEvents.length > 0 ? 'scheduleList' : undefined,
      actionData: todayEvents.length > 0 ? { events: todayEvents } : null,
    } as any;
    addChatMessage(msg);
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const handleTaskCheck = () => {
    const today = toLocalDateString(new Date());
    const todoTasks = tasks.filter(t => t.status === 'todo' && (!t.dueDate || t.dueDate === today)).slice(0, 5);
    const msg: ChatMessage = {
      id: Date.now().toString(),
      role: 'assistant',
      content: todoTasks.length > 0 ? '今日のタスクはこんな感じです。' : 'タスクはまだありません。',
      actionType: todoTasks.length > 0 ? 'taskList' : undefined,
      actionData: todoTasks.length > 0 ? { tasks: todoTasks } : null,
    } as any;
    addChatMessage(msg);
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const handleProcessText = async (overrideText?: any) => {
    const input = overrideText || text;
    if (!input.trim() || loading) return;

    const latestAssistantMessage = [...chatHistory].reverse().find(message => message.role === 'assistant');
    const pendingShoppingTask = [...tasks].reverse().find(task =>
      task.status === 'todo' &&
      task.title.startsWith('[予定]') &&
      isConvenienceStoreTrip(task.title) &&
      (!task.subtasks || task.subtasks.length === 0)
    );

    if (
      latestAssistantMessage?.content?.includes('コンビニで買うものも決めておきますか？') &&
      pendingShoppingTask
    ) {
      const userMsg: ChatMessage = { id: Math.random().toString(), role: 'user', content: input.trim() };
      addChatMessage(userMsg);
      setText('');

      const shoppingItems = parseShoppingSubtasks(input.trim());
      if (shoppingItems.length > 0) {
        updateTask(pendingShoppingTask.id, {
          subtasks: shoppingItems,
          originalText: `${pendingShoppingTask.originalText || pendingShoppingTask.title}\n買うもの: ${shoppingItems.join('、')}`,
        });
        addChatMessage({
          id: `shopping-subtasks-${Date.now()}`,
          role: 'assistant',
          content: `買うものをチェックリストに入れておきました。${shoppingItems.join('、')}`,
        });
      } else {
        addChatMessage({
          id: `shopping-subtasks-empty-${Date.now()}`,
          role: 'assistant',
          content: '買うものがうまく取れませんでした。牛乳、パン、ティッシュのように短く並べてもらえればチェックリストに入れます。',
        });
      }
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
      return;
    }
    
    const userMsg: ChatMessage = { id: Math.random().toString(), role: 'user', content: input.trim() };
    addChatMessage(userMsg);
    setText('');
    setLoading(true);
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const locationString = currentCity || (locationData.coords ? `${locationData.coords.latitude},${locationData.coords.longitude}` : null);
      const pendingTasks = tasks.filter(t => t.status === 'todo');
      const recentMessages = chatHistory.slice(-15).map(m => ({ role: m.role, content: m.content }));
      
      const result = await processUserText(input.trim(), locationString, pendingTasks, recentMessages, events, financialAssets, userProfile);

      const botMsg: ChatMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: result.responseMessage,
        actionType: (result.type !== 'general' ? result.type : undefined) as any,
        actionData: result.data || (result.travelTime ? { travelTime: result.travelTime, destination: result.destination } : null)
      };
      let shouldAddBotMessage = true;

      const finalizeSuccess = () => {
        addChatMessage(botMsg);
        setLastFailedText(null);

        const nowTs = Date.now();
        if (!fetchingSuggestions && nowTs - lastSuggestionFetch.current > SUGGESTION_COOLDOWN) {
          lastSuggestionFetch.current = nowTs;
          refreshAI();
        }
      };

      const queueConfirmation = (label: string, onConfirm: () => void) => {
        shouldAddBotMessage = false;
        setConfirmAction({
          label,
          onConfirm: () => {
            onConfirm();
            finalizeSuccess();
          },
          confirmText: '確認',
        });
      };

      // Handle Actions
      if (result.type === 'expense') {
        const amount = Number(result.data?.amount) || 0;
        const description = result.data?.description || '支出';
        queueConfirmation(
          `${description} を ${formatMoney(amount)} の支出として記録しますか？`,
          () => addExpense(amount, description)
        );
      } else if (result.type === 'income') {
        const amount = Number(result.data?.amount) || 0;
        const description = result.data?.title || result.data?.description || '収入';
        queueConfirmation(
          `${description} を ${formatMoney(amount)} の収入として記録しますか？`,
          () => addIncome(amount, description)
        );
      } else if (result.type === 'budget_update') {
        const d = result.data || {};
        const updates: any = {};
        if (d.jpyCash !== undefined) updates.jpyCash = Number(d.jpyCash) || 0;
        if (d.usdAmount !== undefined) updates.usdAmount = Number(d.usdAmount) || 0;
        if (d.monthlyFixedCosts !== undefined) updates.monthlyFixedCosts = Number(d.monthlyFixedCosts) || 0;
        if (d.setupDone !== undefined) updates.setupDone = !!d.setupDone;
        queueConfirmation(
          `${summarizeBudgetUpdate(d)} を家計簿に反映しますか？`,
          () => updateFinancialAssets(updates)
        );
      } else if (result.type === 'schedule') {
        const eventData = result.data || {};
        const eventTitle = eventData.title || '外出予定';
        const rawTime = eventData.timeString || eventData.scheduledTime;
        const eventTime = (rawTime && /^\d{2}:\d{2}$/.test(rawTime)) ? rawTime : '00:00';
        const eventDate = eventData.date || toLocalDateString(new Date());
        const eventLocation = eventData.location || result.destination || '';
        const eventDuration = eventData.estimatedMinutes || 60;
        const scheduleSummary = [eventDate, eventTime !== '00:00' ? eventTime : null, eventLocation || null]
          .filter(Boolean)
          .join(' / ');
        const scheduleConflict = buildScheduleConflictSuggestion({
          title: eventTitle,
          date: eventDate,
          timeString: eventTime,
          estimatedMinutes: eventDuration,
        }, events);

        const applySchedule = (finalTime: string) => {
            addEvent({
              id: `ev-${Date.now()}`,
              title: eventTitle,
              date: eventDate,
              timeString: finalTime,
              location: eventLocation,
              estimatedMinutes: eventDuration
            });

            const mealKeywords = ['朝食', '昼食', '夕食', '飲み会', 'ご飯', 'lunch', 'dinner'];
            const isMeal = mealKeywords.some(k => eventTitle.toLowerCase().includes(k));

            if (!isMeal) {
              addTask({
                id: `tk-ev-${Date.now()}`,
                title: `[予定] ${eventTitle} (${finalTime})`,
                estimatedCost: 0,
                estimatedMinutes: 60,
                status: 'todo',
                subtasks: [],
                dueDate: eventDate,
              });
            }

            const hasNavigation = !!(eventLocation && locationData.coords && result.needsNavigation !== false);
            if (hasNavigation) {
              getTravelTimes(locationData.coords!, eventLocation!).then(times => {
                if (times) {
                  addChatMessage({
                    id: `travel-${Date.now()}`,
                    role: 'assistant',
                    content: '',
                    actionType: 'travel',
                    actionData: { destination: eventLocation, travelTimes: times },
                  });
                  const travelMin = Math.min(times.driving ?? 999, times.walking ?? 999);
                  if (travelMin < 999 && finalTime !== '00:00') {
                    scheduleDepartureAlert({ eventTitle, eventDate, eventTime: finalTime, travelMinutes: travelMin, destination: eventLocation! }).catch(() => {});
                  }
                }
              }).catch(() => {});
            }

            if (isConvenienceStoreTrip(eventTitle, eventLocation)) {
              addChatMessage({
                id: `conv-followup-${Date.now()}`,
                role: 'assistant',
                content: 'コンビニで買うものも決めておきますか？思いつくものをそのまま送ってください。',
              });
            }
        };

        if (scheduleConflict) {
          shouldAddBotMessage = false;
          setConfirmAction({
            label: `「${eventTitle}」は ${scheduleConflict.overlaps.map(event => `${event.timeString} ${event.title}`).join(' / ')} と重なっています。入れる時間を選んでください。`,
            choices: [
              ...scheduleConflict.suggestedTimes.map((suggestedTime, index) => ({
                label: `${suggestedTime} に変更`,
                primary: index === 0,
                onSelect: () => {
                  applySchedule(suggestedTime);
                  finalizeSuccess();
                },
              })),
              ...(scheduleConflict.splitEvent ? [{
                label: `${scheduleConflict.splitEvent.title} を分割してここに入れる`,
                onSelect: () => {
                  deleteEvent(scheduleConflict.splitEvent!.id);
                  addEvent({
                    id: `ev-split-before-${Date.now()}`,
                    title: scheduleConflict.splitEvent!.title,
                    date: scheduleConflict.splitEvent!.date,
                    timeString: scheduleConflict.splitEvent!.beforeStart,
                    location: scheduleConflict.splitEvent!.location,
                    estimatedMinutes: scheduleConflict.splitEvent!.beforeDuration,
                  });
                  applySchedule(eventTime);
                  addEvent({
                    id: `ev-split-after-${Date.now()}`,
                    title: scheduleConflict.splitEvent!.title,
                    date: scheduleConflict.splitEvent!.date,
                    timeString: scheduleConflict.splitEvent!.afterStart,
                    location: scheduleConflict.splitEvent!.location,
                    estimatedMinutes: scheduleConflict.splitEvent!.afterDuration,
                  });
                  finalizeSuccess();
                },
              }] : []),
              {
                label: '重ねたまま追加',
                onSelect: () => {
                  applySchedule(eventTime);
                  finalizeSuccess();
                },
              },
            ],
          });
        } else {
          queueConfirmation(`${eventTitle}${scheduleSummary ? ` (${scheduleSummary})` : ''} を予定に追加しますか？`, () => {
            applySchedule(eventTime);
          });
        }
      } else if (result.type === 'delete_task') {
        const targetTitle = result.data?.targetTitle;
        if (targetTitle) {
          const match = tasks.find(t => t.status === 'todo' && t.title.toLowerCase().includes(targetTitle.toLowerCase()));
          if (match) {
            setConfirmAction({
              label: `「${match.title}」を削除しますか？`,
              onConfirm: () => deleteTask(match.id),
            });
          }
        }
      } else if (result.type === 'update_task') {
        const targetTitle = result.data?.targetTitle;
        if (targetTitle) {
          const match = tasks.find(t => t.status === 'todo' && t.title.toLowerCase().includes(targetTitle.toLowerCase()));
          if (match) {
            const changes: Partial<Task> = {};
            if (result.data?.newTitle) changes.title = result.data.newTitle;
            if (result.data?.estimatedMinutes) changes.estimatedMinutes = result.data.estimatedMinutes;
            if (result.data?.newDate) changes.dueDate = result.data.newDate;
            const newTitle = changes.title || match.title;
            setConfirmAction({
              label: `「${match.title}」を「${newTitle}」に変更しますか？`,
              onConfirm: () => updateTask(match.id, changes),
            });
          }
        }
      } else if (result.type === 'delete_schedule') {
        const targetTitle = result.data?.targetTitle;
        if (targetTitle) {
          const match = events.find(e => e.title.toLowerCase().includes(targetTitle.toLowerCase()));
          if (match) {
            setConfirmAction({
              label: `予定「${match.title}」を削除しますか？`,
              onConfirm: () => {
                deleteEvent(match.id);
                const relatedTask = tasks.find(t => t.title.includes(match.title) && t.title.includes('[予定]'));
                if (relatedTask) deleteTask(relatedTask.id);
              },
            });
          }
        }
      } else if (result.type === 'update_schedule') {
        const targetTitle = result.data?.targetTitle;
        if (targetTitle) {
          const match = events.find(e => e.title.toLowerCase().includes(targetTitle.toLowerCase()));
          if (match) {
            const changes: Partial<AppEvent> = {};
            if (result.data?.newTitle) changes.title = result.data.newTitle;
            if (result.data?.newDate) changes.date = result.data.newDate;
            if (result.data?.newTime) changes.timeString = result.data.newTime;
            const newTitle = changes.title || match.title;
            const newTime = changes.timeString || match.timeString;
            const newDate = changes.date || match.date;
            const nextDuration = match.estimatedMinutes || 60;
            const scheduleConflict = buildScheduleConflictSuggestion({
              title: newTitle,
              date: newDate,
              timeString: newTime,
              estimatedMinutes: nextDuration,
            }, events, match.id);
            setConfirmAction({
              label: scheduleConflict
                ? `予定「${match.title}」は ${scheduleConflict.overlaps.map(event => `${event.timeString} ${event.title}`).join(' / ')} と重なっています。変更時間を選んでください。`
                : `予定「${match.title}」を「${newTitle}」に変更しますか？`,
              ...(scheduleConflict
                ? {
                    choices: scheduleConflict.suggestedTimes.map((suggestedTime, index) => ({
                      label: `${suggestedTime} に変更`,
                      primary: index === 0,
                      onSelect: () => {
                        const finalChanges = {
                          ...changes,
                          timeString: suggestedTime,
                          date: newDate,
                        };
                        updateEvent(match.id, finalChanges);
                        const relatedTask = tasks.find(t => t.title.includes(match.title) && t.title.includes('[予定]'));
                        if (relatedTask) updateTask(relatedTask.id, { title: `[予定] ${newTitle} (${suggestedTime})`, dueDate: newDate });
                      },
                    })),
                  }
                : {
                    onConfirm: () => {
                      const finalChanges = {
                        ...changes,
                        date: newDate,
                      };
                      updateEvent(match.id, finalChanges);
                      const relatedTask = tasks.find(t => t.title.includes(match.title) && t.title.includes('[予定]'));
                      const finalTime = finalChanges.timeString || match.timeString;
                      if (relatedTask) updateTask(relatedTask.id, { title: `[予定] ${newTitle} (${finalTime})`, dueDate: newDate });
                    },
                    confirmText: '確認',
                  }),
            });
          }
        }
      } else if (result.type === 'task') {
        const rawTasks = Array.isArray(result.data) ? result.data : [result.data];
        const pendingTasks = rawTasks.filter((t: any) => t && (t.title || t.content));
        if (pendingTasks.length > 0) {
          const taskLabel = pendingTasks.length === 1
            ? `${pendingTasks[0].title || pendingTasks[0].content} をタスクに追加しますか？`
            : `${pendingTasks.length}件のタスクを追加しますか？`;
          queueConfirmation(taskLabel, () => {
            pendingTasks.forEach((t: any) => {
              addTask({
                id: `tk-${Math.random().toString(36).substr(2, 9)}`,
                title: t.title || t.content,
                estimatedCost: t.estimatedCost || 0,
                estimatedMinutes: t.estimatedMinutes || 15,
                status: 'todo',
                originalText: input.trim(),
                dueDate: t.date || undefined,
                scheduledTime: t.scheduledTime || undefined,
              });
            });
          });
        }
      }

      if (result.userInsight) {
        addUserInsight(result.userInsight);
      }

      if (shouldAddBotMessage) {
        finalizeSuccess();
      }
    } catch (e) {
      console.error("handleProcessText Error:", e);
      setLastFailedText(input.trim());
      addChatMessage({ 
        id: Date.now().toString(), 
        role: 'assistant', 
        content: '通信に失敗しました。もう一度送るか、内容を短く分けて試してください。急ぎならタスク・カレンダー・家計簿の各画面から手動でも確認できます。',
        actionType: 'retry' as any 
      });
    } finally {
      setLoading(false);
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!globalHasRoutinesSynced) {
      syncRoutines();
      globalHasRoutinesSynced = true;
    }
    if (currentCity && !aiFeatureState.hasInitialFetched) {
      refreshAI(true);
    }
  }, [currentCity, aiFeatureState.hasInitialFetched]);

  useEffect(() => {
    if (route.params?.initialMessage) {
      const msg = route.params.initialMessage;
      navigation.setParams({ initialMessage: undefined });
      handleProcessText(msg);
    }
  }, [route.params?.initialMessage]);

  const renderActionCard = (msg: ChatMessage) => {
    if (!msg.actionType) return null;
    if (msg.actionType !== 'retry' && !msg.actionData) return null;
    
    if (msg.actionType === 'task') {
      const ts = Array.isArray(msg.actionData) ? msg.actionData : [msg.actionData];
      return ts.map((t, index) => (
        <View key={index} style={styles.actionCard}>
          <Ionicons name="checkmark-circle" size={24} color={colors.text} />
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={typography.body}>{t.title}</Text>
            <Text style={typography.caption}>タスクが追加されました</Text>
          </View>
        </View>
      ));
    }
    
    if (msg.actionType === 'expense') {
      return (
        <View style={[styles.actionCard, { borderLeftWidth: 4, borderLeftColor: '#ef4444' }]}>
          <Ionicons name="card" size={24} color="#ef4444" />
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={[typography.body, { fontWeight: '700', color: '#ef4444' }]}>- {fmt(msg.actionData.amount)}</Text>
            <Text style={typography.caption}>{msg.actionData.description || '残高から引き落とされました'}</Text>
          </View>
        </View>
      );
    }

    if (msg.actionType === 'income') {
      return (
        <View style={[styles.actionCard, { borderLeftWidth: 4, borderLeftColor: '#22c55e' }]}>
          <Ionicons name="trending-up" size={24} color="#22c55e" />
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={[typography.body, { fontWeight: '700', color: '#22c55e' }]}>+ {fmt(msg.actionData.amount)}</Text>
            <Text style={typography.caption}>{msg.actionData.title || '収入として記録しました'}</Text>
          </View>
        </View>
      );
    }

    if (msg.actionType === 'budget_update') {
      return (
        <View style={[styles.actionCard, { borderLeftWidth: 4, borderLeftColor: '#0ea5e9' }]}>
          <Ionicons name="settings" size={24} color="#0ea5e9" />
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={[typography.body, { fontWeight: '700', color: '#0ea5e9' }]}>資産情報を更新</Text>
            <Text style={typography.caption}>家計簿の設定を反映しました</Text>
          </View>
        </View>
      );
    }

    if (msg.actionType === 'schedule') {
      return (
        <TouchableOpacity
          style={[styles.actionCard, { borderLeftWidth: 4, borderLeftColor: colors.text }]}
          onPress={() => navigation.navigate('カレンダー')}
          activeOpacity={0.7}
        >
          <Ionicons name="calendar" size={24} color={colors.text} />
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={typography.body}>{msg.actionData.title}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
              <Text style={typography.caption}>{msg.actionData.timeString}</Text>
              {msg.actionData.location && (
                <Text style={[typography.caption, { marginLeft: 8, color: colors.textSecondary }]}>
                  {msg.actionData.location}
                </Text>
              )}
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.border} />
        </TouchableOpacity>
      );
    }
    if (msg.actionType === 'travel') {
      const { destination, travelTimes } = msg.actionData;
      const origin = locationData.coords ? `${locationData.coords.latitude},${locationData.coords.longitude}` : null;
      const bestMinutes = Math.min(
        travelTimes.driving ?? 999,
        travelTimes.transit ?? 999,
        travelTimes.walking <= 60 ? travelTimes.walking : 999,
      );
      const displayTime = bestMinutes < 999 ? formatDuration(bestMinutes) : null;
      return (
        <TouchableOpacity
          style={styles.travelSimpleCard}
          onPress={() => Linking.openURL(getGoogleMapsUrl(origin, destination))}
          activeOpacity={0.7}
        >
          <Ionicons name="location" size={16} color={colors.text} />
          <Text style={styles.travelSimpleText}>
            {destination}{displayTime ? `まで約${displayTime}` : ''}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.border} />
        </TouchableOpacity>
      );
    }

    if (msg.actionType === 'scheduleList') {
      const eventItems: AppEvent[] = msg.actionData?.events || [];
      return (
        <View style={[styles.actionCard, { flexDirection: 'column', alignItems: 'flex-start', gap: 6 }]}>
          {eventItems.map((e: any) => (
            <View key={e.id} style={styles.taskListRow}>
              <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.taskListText} numberOfLines={1}>{e.timeString} {e.title}</Text>
            </View>
          ))}
          <TouchableOpacity onPress={() => navigation.navigate('カレンダー')} style={styles.taskListLink}>
            <Text style={styles.taskListLinkText}>詳細はこちら →</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (msg.actionType === 'taskList') {
      const taskItems: Task[] = msg.actionData?.tasks || [];
      return (
        <View style={[styles.actionCard, { flexDirection: 'column', alignItems: 'flex-start', gap: 6 }]}>
          {taskItems.map((t) => (
            <View key={t.id} style={styles.taskListRow}>
              <View style={styles.checkbox} />
              <Text style={styles.taskListText} numberOfLines={1}>{t.title}</Text>
            </View>
          ))}
          <TouchableOpacity onPress={() => navigation.navigate('タスク')} style={styles.taskListLink}>
            <Text style={styles.taskListLinkText}>詳細はこちら →</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (msg.actionType === 'retry') {
      return (
        <TouchableOpacity 
          style={[styles.actionCard, { borderLeftWidth: 4, borderLeftColor: colors.border }]}
          onPress={() => lastFailedText && handleProcessText(lastFailedText)}
        >
          <Ionicons name="refresh-outline" size={20} color={colors.textSecondary} />
          <Text style={[typography.body, { marginLeft: 8, color: colors.textSecondary }]}>再試行する</Text>
        </TouchableOpacity>
      );
    }

    return null;
  };

  // 今やるべきこと items
  const nowStr = new Date().toTimeString().slice(0, 5);
  const todayStr = toLocalDateString(new Date());
  const nextEvent = events
    .filter(e => e.date === todayStr && e.timeString >= nowStr && !dismissedEventIds.has(e.id))
    .sort((a, b) => a.timeString.localeCompare(b.timeString))
    .slice(0, 1);
  const priorityTasks = tasks
    .filter(t => t.status === 'todo' || recentlyCompletedTaskIds.has(t.id))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'todo' ? -1 : 1;
      return a.estimatedMinutes - b.estimatedMinutes;
    })
    .slice(0, 1);
  const hasItems = nextEvent.length > 0 || priorityTasks.length > 0;

  const availableMinutes = getAvailableMinutes();
  const totalTaskMinutes = tasks.filter(t => t.status === 'todo' && !t.dueDate).reduce((s, t) => s + t.estimatedMinutes, 0);
  const freeMinutes = availableMinutes - totalTaskMinutes;
  const busyRatio = availableMinutes > 0 ? Math.min(1, totalTaskMinutes / availableMinutes) : 0;
  const formatDur = (m: number) => m < 60 ? `${m}分` : `${Math.floor(m/60)}時間${m%60>0?m%60+'分':''}`;

  const scrollPaddingTop = hasItems ? (cardHeight > 0 ? cardHeight + 28 + 16 : 120) : 16;

  return (
    <>
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView
        ref={scrollViewRef}
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scrollContent, { paddingTop: scrollPaddingTop }]}
        onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
      >
        <View style={styles.chatHistoryContainer}>
          {chatHistory.map((msg) => (
            <View key={msg.id} style={[styles.messageWrapper, msg.role === 'user' ? styles.userWrapper : styles.botWrapper]}>
              <View style={[styles.messageBubble, msg.role === 'user' ? styles.userBubble : styles.botBubble]}>
                <Text style={[styles.messageText, msg.role === 'user' && styles.userMessageText]}>
                  {msg.content}
                </Text>
                <View style={styles.messageFooter}>
                  {copiedMessageId === msg.id && (
                    <Text style={styles.copiedLabel}>コピーしました</Text>
                  )}
                  <TouchableOpacity
                    style={styles.copyButton}
                    onPress={() => handleCopyMessage(msg)}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="copy-outline" size={14} color={colors.textSecondary} />
                    <Text style={styles.copyButtonText}>コピー</Text>
                  </TouchableOpacity>
                </View>
                {renderActionCard(msg)}
              </View>
            </View>
          ))}

          {loading && (
            <View style={[styles.messageWrapper, styles.botWrapper]}>
              <View style={[styles.messageBubble, styles.botBubble, { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }]}>
                <ActivityIndicator size="small" color={colors.textSecondary} />
                <Text style={{ fontSize: 13, color: colors.textSecondary, fontWeight: '500' }}>考え中...</Text>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      <View style={styles.suggestionsContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.suggestionsScroll}>
          <TouchableOpacity style={styles.taskCheckChip} onPress={handleTaskCheck}>
            <Ionicons name="checkmark-circle-outline" size={14} color={colors.text} style={{ marginRight: 4 }} />
            <Text style={styles.suggestionText}>タスク確認</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.taskCheckChip} onPress={handleScheduleCheck}>
            <Ionicons name="calendar-outline" size={14} color={colors.text} style={{ marginRight: 4 }} />
            <Text style={styles.suggestionText}>スケジュール確認</Text>
          </TouchableOpacity>
          {suggestions.map((s, index) => (
            <TouchableOpacity
              key={index}
              style={[styles.suggestionChip, index === 0 && styles.prioritySuggestion]}
              onPress={() => handleProcessText(s)}
            >
              <Text style={[styles.suggestionText, index === 0 && styles.prioritySuggestionText]}>{s.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.bottomBar}>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            multiline
            placeholder="何でも話してください"
            placeholderTextColor={colors.border}
            value={text}
            onChangeText={setText}
          />
          <TouchableOpacity
            style={[styles.submitButton, { backgroundColor: text.trim() ? colors.text : colors.border }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              handleProcessText();
            }}
            disabled={loading || !text.trim()}
          >
            <Ionicons name="arrow-up" size={16} color={colors.background} />
          </TouchableOpacity>
        </View>
      </View>

      {hasItems && (
        <Animated.View
          onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}
          style={[styles.todayTasksSection, {
            opacity: cardAnim,
            transform: [{ translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
          }]}
        >
          <View style={styles.todayHeader}>
            <TouchableOpacity
              style={styles.todayHeaderLink}
              onPress={() => navigation.navigate('タスク')}
              activeOpacity={0.7}
            >
              <Text style={styles.sectionTitle}>今やるべきこと</Text>
            </TouchableOpacity>
            <Text style={[styles.freeTimeLabel, { color: freeMinutes >= 0 ? colors.textSecondary : '#ef4444' }]}>
              {freeMinutes >= 0 ? `余裕 +${formatDur(freeMinutes)}` : `超過 ${formatDur(Math.abs(freeMinutes))}`}
            </Text>
          </View>
          <View style={styles.timeBar}>
            <View style={[styles.timeBarFill, {
              width: `${Math.round(busyRatio * 100)}%` as any,
              backgroundColor: busyRatio > 0.85 ? '#ef4444' : busyRatio > 0.6 ? '#f59e0b' : colors.text,
            }]} />
          </View>
          {nextEvent.map((e) => (
            <TouchableOpacity
              key={e.id}
              style={styles.miniTaskRow}
              onPress={() => navigation.navigate('タスク')}
              activeOpacity={0.6}
            >
              <TouchableOpacity
                style={styles.checkboxButton}
                onPress={() => setDismissedEventIds(prev => new Set([...prev, e.id]))}
                activeOpacity={0.7}
              >
                <Ionicons name="ellipse-outline" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
              <Text style={styles.miniTaskText} numberOfLines={1}>{e.timeString} {e.title}</Text>
              {e.estimatedMinutes && <Text style={styles.miniTaskDuration}>{e.estimatedMinutes}分</Text>}
            </TouchableOpacity>
          ))}
          {priorityTasks.map((t) => (
            <TouchableOpacity
              key={t.id}
              style={styles.miniTaskRow}
              onPress={() => navigation.navigate('タスク')}
              activeOpacity={0.6}
            >
              <TouchableOpacity
                style={styles.checkboxButton}
                onPress={() => {
                  if (t.status === 'completed') {
                    updateTask(t.id, { status: 'todo' });
                    setRecentlyCompletedTaskIds(prev => {
                      const next = new Set(prev);
                      next.delete(t.id);
                      return next;
                    });
                    return;
                  }

                  completeTask(t.id);
                  setRecentlyCompletedTaskIds(prev => new Set(prev).add(t.id));
                }}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={t.status === 'completed' ? 'checkmark-circle' : 'ellipse-outline'}
                  size={18}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
              <Text style={[styles.miniTaskText, t.status === 'completed' && styles.miniTaskTextDone]} numberOfLines={1}>{t.title}</Text>
              {t.estimatedMinutes > 0 && (
                <Text style={[styles.miniTaskDuration, t.status === 'completed' && styles.miniTaskDurationDone]}>
                  {t.estimatedMinutes}分
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </Animated.View>
      )}
    </KeyboardAvoidingView>

    <Modal visible={!!confirmAction} transparent animationType="fade">
      <View style={styles.confirmOverlay}>
        <View style={styles.confirmBox}>
          <Text style={styles.confirmLabel}>{confirmAction?.label}</Text>
          {confirmAction?.choices?.length ? (
            <View style={styles.choiceList}>
              {confirmAction.choices.map(choice => (
                <TouchableOpacity
                  key={choice.label}
                  style={[styles.choiceButton, choice.primary && styles.choiceButtonPrimary]}
                  onPress={() => { choice.onSelect(); setConfirmAction(null); }}
                >
                  <Text style={[styles.choiceButtonText, choice.primary && styles.choiceButtonTextPrimary]}>
                    {choice.label}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.confirmCancelSolo} onPress={() => setConfirmAction(null)}>
                <Text style={styles.confirmCancelText}>キャンセル</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.confirmButtons}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setConfirmAction(null)}>
                <Text style={styles.confirmCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmOk} onPress={() => { confirmAction?.onConfirm?.(); setConfirmAction(null); }}>
                <Text style={styles.confirmOkText}>{confirmAction?.confirmText || '確認'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>

    <Modal visible={sessionModalVisible} animationType="none" transparent onRequestClose={closeSessionModal}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeSessionModal}>
        <Animated.View style={{ opacity: sessionOverlayAnim, ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' }} />
        <Animated.View style={[styles.sessionModal, { transform: [{ translateY: sessionSlideAnim }] }]} onStartShouldSetResponder={() => true}>
          <View style={styles.sessionModalHeader}>
            <Text style={styles.sessionModalTitle}>チャット履歴</Text>
            <TouchableOpacity onPress={() => { createNewSession(); closeSessionModal(); }} style={styles.newChatBtn}>
              <Ionicons name="create-outline" size={18} color={colors.background} />
              <Text style={styles.newChatBtnText}>新しいチャット</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={chatSessions}
            keyExtractor={s => s.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.sessionRow, item.id === currentSessionId && styles.sessionRowActive]}
                onPress={() => { switchSession(item.id); closeSessionModal(); }}
              >
                <Ionicons name="chatbubble-outline" size={16} color={item.id === currentSessionId ? colors.background : colors.textSecondary} style={{ marginRight: 10 }} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sessionTitle, item.id === currentSessionId && styles.sessionTitleActive]} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.sessionDate}>{new Date(item.createdAt).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Text>
                </View>
                {chatSessions.length > 1 && (
                  <TouchableOpacity onPress={() => deleteSession(item.id)} style={{ padding: 6 }}>
                    <Ionicons name="trash-outline" size={15} color={item.id === currentSessionId ? 'rgba(255,255,255,0.6)' : colors.border} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            )}
          />
        </Animated.View>
      </TouchableOpacity>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, overflow: 'visible' },
  scrollContent: { padding: 24, paddingTop: 16, paddingBottom: 40, flexGrow: 1 },
  todayTasksSection: {
    position: 'absolute', top: 24, left: 16, right: 16, backgroundColor: 'rgba(255, 255, 255, 0.85)',
    padding: 20, borderRadius: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08, shadowRadius: 24, elevation: 8, zIndex: 10, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.5)',
  },
  todayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  todayHeaderLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sectionTitle: { ...typography.caption, fontWeight: '800', color: colors.textSecondary, letterSpacing: 1 },
  freeTimeLabel: { fontSize: 11, fontWeight: '600' },
  timeBar: { height: 3, backgroundColor: colors.borderSubtle, borderRadius: 2, marginBottom: 10, overflow: 'hidden' },
  timeBarFill: { height: 3, borderRadius: 2 },
  miniTaskRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  checkboxButton: { marginRight: 12 },
  checkbox: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: colors.textSecondary, flexShrink: 0 },
  miniTaskText: { ...typography.body, fontSize: 14, color: colors.text, marginLeft: 10, flex: 1 },
  miniTaskTextDone: { color: colors.textSecondary, textDecorationLine: 'line-through' },
  miniTaskDuration: { ...typography.caption, color: colors.textSecondary, marginLeft: 8, fontWeight: '600', flexShrink: 0 },
  miniTaskDurationDone: { textDecorationLine: 'line-through' },
  chatHistoryContainer: { paddingTop: 10 },
  messageWrapper: { flexDirection: 'row', marginBottom: 16 },
  userWrapper: { justifyContent: 'flex-end' },
  botWrapper: { justifyContent: 'flex-start' },
  messageBubble: { maxWidth: '85%', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20 },
  userBubble: { 
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSubtle, borderBottomRightRadius: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 
  },
  botBubble: { backgroundColor: 'transparent', paddingHorizontal: 4 },
  messageText: { ...typography.body, color: colors.text, lineHeight: 24 },
  userMessageText: { color: colors.text },
  messageFooter: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 8, gap: 8 },
  copiedLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  copyButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  copyButtonText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  actionCard: { 
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, padding: 16, marginTop: 12, borderWidth: 1,
    borderColor: colors.borderSubtle, borderRadius: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03, shadowRadius: 8, elevation: 2 
  },
  bottomBar: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 24 : 16, backgroundColor: 'transparent' },
  inputContainer: { 
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSubtle,
    borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 
  },
  textInput: { flex: 1, fontSize: 16, color: colors.text, maxHeight: 120, lineHeight: 24, paddingVertical: 4 },
  submitButton: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginLeft: 12, flexShrink: 0 },
  suggestionsContainer: { paddingTop: 16, paddingBottom: 4, backgroundColor: 'transparent' },
  suggestionsScroll: { paddingHorizontal: 16 },
  suggestionChip: { 
    backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, marginRight: 8, borderWidth: 1,
    borderColor: colors.borderSubtle, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 
  },
  suggestionText: { ...typography.caption, color: colors.text, fontWeight: '400' },
  prioritySuggestion: { backgroundColor: colors.text, borderColor: colors.text },
  prioritySuggestionText: { color: colors.surface },
  travelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  travelTime: { ...typography.body, color: colors.text, fontWeight: '600', flex: 1 },
  travelMapBtn: { backgroundColor: colors.text, borderRadius: 8, padding: 6 },
  travelSimpleCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.surface, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: colors.borderSubtle,
  },
  travelSimpleText: { ...typography.body, color: colors.text, fontWeight: '600', flex: 1 },
  taskCheckChip: { 
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 20, marginRight: 8, borderWidth: 1, borderColor: colors.borderSubtle, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 
  },
  taskListRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  taskListText: { ...typography.body, fontSize: 14, color: colors.text, marginLeft: 8, flex: 1 },
  taskListLink: { marginTop: 8, alignSelf: 'flex-end' },
  taskListLinkText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  sessionModal: { backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 20, paddingBottom: 40, maxHeight: '70%' },
  sessionModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 16 },
  sessionModalTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  newChatBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.text, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, gap: 6 },
  newChatBtnText: { fontSize: 13, fontWeight: '600', color: colors.background },
  sessionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
  sessionRowActive: { backgroundColor: colors.borderSubtle },
  sessionTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  sessionTitleActive: { color: colors.text },
  sessionDate: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  confirmBox: { backgroundColor: colors.surface, borderRadius: 14, padding: 24, width: '82%', borderWidth: 1, borderColor: colors.borderSubtle },
  confirmLabel: { fontSize: 15, color: colors.text, marginBottom: 20, lineHeight: 22 },
  confirmButtons: { flexDirection: 'row', gap: 12 },
  confirmCancel: { flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  confirmCancelText: { fontSize: 14, color: colors.textSecondary },
  confirmOk: { flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: colors.text, alignItems: 'center' },
  confirmOkText: { fontSize: 14, color: colors.background, fontWeight: '600' },
  choiceList: { gap: 10 },
  choiceButton: {
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  choiceButtonPrimary: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  choiceButtonText: { fontSize: 14, color: colors.text, fontWeight: '600' },
  choiceButtonTextPrimary: { color: colors.background },
  confirmCancelSolo: {
    marginTop: 4,
    paddingVertical: 10,
    alignItems: 'center',
  },
});
