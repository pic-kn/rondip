import React, { useState, useRef, useEffect } from 'react';
import * as Haptics from 'expo-haptics';
import { View, StyleSheet, TextInput, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity, Text, ActivityIndicator, Modal, Animated, FlatList } from 'react-native';
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
  const [confirmAction, setConfirmAction] = useState<{ label: string; onConfirm: () => void } | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [fetchingSuggestions, setFetchingSuggestions] = useState(false);

  const { 
    tasks, budgetBalance, events, chatHistory, addChatMessage, addTask, updateTask, deleteTask, 
    addExpense, addIncome, addEvent, updateEvent, deleteEvent, syncRoutines, aiFeatureState, completeTask, 
    chatSessions, currentSessionId, createNewSession, switchSession, deleteSession, 
    getAvailableMinutes, financialAssets, updateFinancialAssets, userProfile, addUserInsight
  } = useAppContext();

  const [dismissedEventIds, setDismissedEventIds] = useState<Set<string>>(new Set());
  const [cardHeight, setCardHeight] = useState(0);
  const cardAnim = useRef(new Animated.Value(0)).current;
  const lastSuggestionFetch = useRef<number>(0);
  const SUGGESTION_COOLDOWN = 5 * 60 * 1000;
  const locationData = useLocation();
  const currentCity = locationData.city;
  const scrollViewRef = useRef<ScrollView>(null);
  const [lastFailedText, setLastFailedText] = useState<string | null>(null);

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

      // Handle Actions
      if (result.type === 'expense') {
        const amount = Number(result.data?.amount) || 0;
        const description = result.data?.description || '支出';
        addExpense(amount, description);
      } else if (result.type === 'income') {
        const amount = Number(result.data?.amount) || 0;
        const description = result.data?.title || result.data?.description || '収入';
        addIncome(amount, description);
      } else if (result.type === 'budget_update') {
        const d = result.data || {};
        const updates: any = {};
        if (d.jpyCash !== undefined) updates.jpyCash = Number(d.jpyCash) || 0;
        if (d.usdAmount !== undefined) updates.usdAmount = Number(d.usdAmount) || 0;
        if (d.monthlyFixedCosts !== undefined) updates.monthlyFixedCosts = Number(d.monthlyFixedCosts) || 0;
        if (d.setupDone !== undefined) updates.setupDone = !!d.setupDone;
        updateFinancialAssets(updates);
      } else if (result.type === 'schedule') {
        const eventData = result.data || {};
        const eventTitle = eventData.title || '外出予定';
        const rawTime = eventData.timeString;
        const eventTime = (rawTime && /^\d{2}:\d{2}$/.test(rawTime)) ? rawTime : '00:00';
        const eventDate = eventData.date || toLocalDateString(new Date());
        const eventLocation = eventData.location || result.destination || '';
        
        addEvent({
          id: `ev-${Date.now()}`,
          title: eventTitle,
          date: eventDate,
          timeString: eventTime,
          location: eventLocation,
          estimatedMinutes: eventData.estimatedMinutes || 60
        });

        // 食事関連の予定はタスク不要
        const mealKeywords = ['朝食', '昼食', '夕食', '飲み会', 'ご飯', 'lunch', 'dinner'];
        const isMeal = mealKeywords.some(k => eventTitle.toLowerCase().includes(k));

        if (!isMeal) addTask({
          id: `tk-ev-${Date.now()}`,
          title: `[予定] ${eventTitle} (${eventTime})`,
          estimatedCost: 0,
          estimatedMinutes: 60,
          status: 'todo',
          dueDate: eventDate,
        });

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
              if (travelMin < 999 && eventTime !== '00:00') {
                scheduleDepartureAlert({ eventTitle, eventDate, eventTime, travelMinutes: travelMin, destination: eventLocation! }).catch(() => {});
              }
            }
          }).catch(() => {});
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
            setConfirmAction({
              label: `予定「${match.title}」を「${newTitle}」に変更しますか？`,
              onConfirm: () => {
                updateEvent(match.id, changes);
                const relatedTask = tasks.find(t => t.title.includes(match.title) && t.title.includes('[予定]'));
                if (relatedTask) updateTask(relatedTask.id, { title: `[予定] ${newTitle} (${newTime})`, dueDate: changes.date || match.date });
              },
            });
          }
        }
      } else if (result.type === 'task') {
        const rawTasks = Array.isArray(result.data) ? result.data : [result.data];
        rawTasks.forEach((t: any) => {
          if (t && (t.title || t.content)) {
            addTask({
              id: `tk-${Math.random().toString(36).substr(2, 9)}`,
              title: t.title || t.content,
              estimatedCost: t.estimatedCost || 0,
              estimatedMinutes: t.estimatedMinutes || 15,
              status: 'todo',
              originalText: text,
              dueDate: t.date || undefined,
              scheduledTime: t.scheduledTime || undefined,
            });
          }
        });
      }

      if (result.userInsight) {
        addUserInsight(result.userInsight);
      }

      addChatMessage(botMsg);
      setLastFailedText(null);
      
      const nowTs = Date.now();
      if (!fetchingSuggestions && nowTs - lastSuggestionFetch.current > SUGGESTION_COOLDOWN) {
        lastSuggestionFetch.current = nowTs;
        refreshAI();
      }
    } catch (e) {
      console.error("handleProcessText Error:", e);
      setLastFailedText(input.trim());
      addChatMessage({ 
        id: Date.now().toString(), 
        role: 'assistant', 
        content: '申し訳ありません、通信エラーが発生しました。やり直しますか？',
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
      const allModes: { key: 'driving' | 'walking' | 'transit'; icon: keyof typeof Ionicons.glyphMap; time: number; suffix?: string; maxMin: number }[] = [
        { key: 'driving', icon: 'car-outline', time: travelTimes.driving, maxMin: 600 },
        { key: 'transit', icon: 'train-outline', time: travelTimes.transit, suffix: '（概算）', maxMin: 600 },
        { key: 'walking', icon: 'walk-outline', time: travelTimes.walking, maxMin: 60 },
      ];
      const modes = allModes.filter(m => m.time <= m.maxMin);
      return (
        <View style={[styles.actionCard, { flexDirection: 'column', alignItems: 'flex-start', gap: 8 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Ionicons name="location" size={16} color={colors.text} />
            <Text style={[typography.body, { fontWeight: '700', marginLeft: 6 }]}>{destination}</Text>
          </View>
          {modes.map(({ key, icon, time, suffix }) => (
            <View key={key} style={styles.travelRow}>
              <Ionicons name={icon} size={18} color={colors.textSecondary} />
              <Text style={styles.travelTime}>{formatDuration(time)}{suffix ?? ''}</Text>
              <TouchableOpacity
                style={styles.travelMapBtn}
                onPress={() => Linking.openURL(getGoogleMapsUrl(origin, destination, key))}
              >
                <Ionicons name="map-outline" size={14} color={colors.background} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
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
    .filter(t => t.status === 'todo')
    .sort((a, b) => a.estimatedMinutes - b.estimatedMinutes)
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
            <Text style={styles.sectionTitle}>今やるべきこと</Text>
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
              onPress={() => setDismissedEventIds(prev => new Set([...prev, e.id]))}
              activeOpacity={0.6}
            >
              <View style={styles.checkbox} />
              <Text style={styles.miniTaskText} numberOfLines={1}>{e.timeString} {e.title}</Text>
              {e.estimatedMinutes && <Text style={styles.miniTaskDuration}>{e.estimatedMinutes}分</Text>}
            </TouchableOpacity>
          ))}
          {priorityTasks.map((t) => (
            <TouchableOpacity
              key={t.id}
              style={styles.miniTaskRow}
              onPress={() => completeTask(t.id)}
              activeOpacity={0.6}
            >
              <View style={styles.checkbox} />
              <Text style={styles.miniTaskText} numberOfLines={1}>{t.title}</Text>
              {t.estimatedMinutes > 0 && <Text style={styles.miniTaskDuration}>{t.estimatedMinutes}分</Text>}
            </TouchableOpacity>
          ))}
        </Animated.View>
      )}
    </KeyboardAvoidingView>

    <Modal visible={!!confirmAction} transparent animationType="fade">
      <View style={styles.confirmOverlay}>
        <View style={styles.confirmBox}>
          <Text style={styles.confirmLabel}>{confirmAction?.label}</Text>
          <View style={styles.confirmButtons}>
            <TouchableOpacity style={styles.confirmCancel} onPress={() => setConfirmAction(null)}>
              <Text style={styles.confirmCancelText}>キャンセル</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmOk} onPress={() => { confirmAction?.onConfirm(); setConfirmAction(null); }}>
              <Text style={styles.confirmOkText}>確認</Text>
            </TouchableOpacity>
          </View>
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
  sectionTitle: { ...typography.caption, fontWeight: '800', color: colors.textSecondary, letterSpacing: 1 },
  freeTimeLabel: { fontSize: 11, fontWeight: '600' },
  timeBar: { height: 3, backgroundColor: colors.borderSubtle, borderRadius: 2, marginBottom: 10, overflow: 'hidden' },
  timeBarFill: { height: 3, borderRadius: 2 },
  miniTaskRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  checkbox: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: colors.textSecondary, flexShrink: 0 },
  miniTaskText: { ...typography.body, fontSize: 14, color: colors.text, marginLeft: 10, flex: 1 },
  miniTaskDuration: { ...typography.caption, color: colors.textSecondary, marginLeft: 8, fontWeight: '600', flexShrink: 0 },
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
  confirmBox: { backgroundColor: colors.surface, borderRadius: 10, padding: 24, width: '80%', borderWidth: 1, borderColor: colors.borderSubtle },
  confirmLabel: { fontSize: 15, color: colors.text, marginBottom: 20, lineHeight: 22 },
  confirmButtons: { flexDirection: 'row', gap: 12 },
  confirmCancel: { flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  confirmCancelText: { fontSize: 14, color: colors.textSecondary },
  confirmOk: { flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: colors.text, alignItems: 'center' },
  confirmOkText: { fontSize: 14, color: colors.background, fontWeight: '600' },
});
