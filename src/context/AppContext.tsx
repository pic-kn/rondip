import React, { createContext, useState, useContext, ReactNode, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  Task, AppEvent, ChatMessage, ChatSession, Routine,
  ShiftEntry, WorkplacePreset, WorkSchedule, SleepSettings,
  DeviceAsset, FutureExpense, FinancialAssets, BudgetMessage,
  BudgetSession, BudgetTransaction
} from '../types';
import { toLocalDateStr, calcAvailableMinutes } from '../utils/timeCalc';
import { scheduleTaskReminder, cancelNotification } from '../services/notifications';

export type { 
  Task, AppEvent, ChatMessage, ChatSession, Routine, 
  ShiftEntry, WorkplacePreset, WorkSchedule, SleepSettings, 
  DeviceAsset, FutureExpense, FinancialAssets, BudgetMessage, 
  BudgetSession, BudgetTransaction 
};


const DEFAULT_FINANCIAL_ASSETS: FinancialAssets = {
  jpyCash: 150000,
  usdAmount: 0,
  deviceAssets: [],
  creditCardPending: 0,
  monthlyFixedCosts: 0,
  futureExpenses: [],
  setupDone: false,
};

const DEFAULT_WORK_SCHEDULE: WorkSchedule = {
  type: 'shift',
  fixedDays: [1, 2, 3, 4, 5],
  fixedStartTime: '09:00',
  fixedEndTime: '18:00',
  activeWorkplaceId: null,
  workplaces: [],
};

const DEFAULT_SLEEP_SETTINGS: SleepSettings = {
  wakeTime: '07:00',
  bedTime: '23:00',
};


interface AppContextProps {
  tasks: Task[];
  addTask: (task: Task) => void;
  updateTask: (id: string, changes: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  completeTask: (id: string) => void;

  budgetBalance: number;
  addExpense: (amount: number, description: string) => void;
  addIncome: (amount: number, title: string) => void;

  events: AppEvent[];
  addEvent: (event: AppEvent) => void;
  updateEvent: (id: string, updates: Partial<AppEvent>) => void;
  deleteEvent: (id: string) => void;

  // 現在のセッションのメッセージ（後方互換）
  chatHistory: ChatMessage[];
  addChatMessage: (msg: ChatMessage) => void;

  // チャットセッション管理
  chatSessions: ChatSession[];
  currentSessionId: string;
  createNewSession: () => void;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;

  spareTime: number;
  setSpareTime: (minutes: number | ((prev: number) => number)) => void;

  routines: Routine[];
  addRoutine: (routine: Routine) => void;
  syncRoutines: () => void;

  workSchedule: WorkSchedule;
  sleepSettings: SleepSettings;
  updateWorkSchedule: (ws: Partial<WorkSchedule>) => void;
  updateSleepSettings: (ss: Partial<SleepSettings>) => void;
  addWorkplace: (workplace: Omit<WorkplacePreset, 'id'>) => void;
  deleteWorkplace: (id: string) => void;
  setActiveWorkplace: (id: string | null) => void;
  addDayOff: (workplaceId: string, date: string) => void;
  removeDayOff: (workplaceId: string, date: string) => void;
  getTodayWorkShift: (dateStr?: string) => ShiftEntry | null;
  getAvailableMinutes: (dateStr?: string) => number;

  financialAssets: FinancialAssets;
  updateFinancialAssets: (fa: Partial<FinancialAssets>) => void;
  budgetTransactions: BudgetTransaction[];
  addBudgetTransaction: (tx: BudgetTransaction) => void;
  removeBudgetTransaction: (id: string) => void;
  paydayDate: number;
  updatePaydayDate: (day: number) => void;
  budgetSessions: BudgetSession[];
  currentBudgetSessionId: string;
  budgetMessages: { role: 'ai' | 'user'; text: string; date: string }[];
  addBudgetMessage: (msg: { role: 'ai' | 'user'; text: string }) => void;
  createNewBudgetSession: () => void;
  switchBudgetSession: (id: string) => void;
  deleteBudgetSession: (id: string) => void;

  clearData: () => void;
  
  userProfile: string[];
  addUserInsight: (insight: string) => void;

  // AI State
  aiFeatureState: {
    hasInitialFetched: boolean;
    setInitialFetched: (val: boolean) => void;
  };
}

const AppContext = createContext<AppContextProps | undefined>(undefined);

const STORAGE_KEY = '@focusflow_data';

const makeBudgetSession = (messages: BudgetMessage[] = []): BudgetSession => ({
  id: `bsession-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
  title: '新しい会話',
  createdAt: new Date().toISOString(),
  messages,
});

const makeSession = (messages: ChatMessage[] = []): ChatSession => ({
  id: `session-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
  title: '新しいチャット',
  createdAt: new Date().toISOString(),
  messages,
});

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [isReady, setIsReady] = useState(false);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  // budgetBalance is now derived/synced with financialAssets.jpyCash
  const [budgetBalance, setBudgetBalance] = useState<number>(150000);
  const [spareTime, setSpareTime] = useState<number>(0);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [lastSyncDate, setLastSyncDate] = useState<string>('');
  const [workSchedule, setWorkSchedule] = useState<WorkSchedule>(DEFAULT_WORK_SCHEDULE);
  const [sleepSettings, setSleepSettings] = useState<SleepSettings>(DEFAULT_SLEEP_SETTINGS);
  const [hasInitialFetched, setInitialFetched] = useState(false);
  const [financialAssets, setFinancialAssets] = useState<FinancialAssets>(DEFAULT_FINANCIAL_ASSETS);
  const [budgetTransactions, setBudgetTransactions] = useState<BudgetTransaction[]>([]);
  const [paydayDate, setPaydayDate] = useState<number>(25);
  const [userProfile, setUserProfile] = useState<string[]>([]);
  const initialBudgetSession = makeBudgetSession();
  const [budgetSessions, setBudgetSessions] = useState<BudgetSession[]>([initialBudgetSession]);
  const [currentBudgetSessionId, setCurrentBudgetSessionId] = useState<string>(initialBudgetSession.id);

  const initialSession = makeSession();
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([initialSession]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(initialSession.id);

  // 現在のセッションのメッセージ（後方互換）
  const chatHistory = chatSessions.find(s => s.id === currentSessionId)?.messages ?? [];

  // Load from Storage on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const storedJson = await AsyncStorage.getItem(STORAGE_KEY);
        const today = new Date().toISOString().split('T')[0];
        let loadedEvents: AppEvent[] = [];

        let parsed: any = undefined;
        if (storedJson) {
          parsed = JSON.parse(storedJson);
          if (parsed.tasks) setTasks(parsed.tasks);
          if (parsed.budgetBalance !== undefined) setBudgetBalance(parsed.budgetBalance);
          if (parsed.spareTime !== undefined) setSpareTime(parsed.spareTime);
          if (parsed.routines) setRoutines(parsed.routines);
          if (parsed.lastSyncDate) setLastSyncDate(parsed.lastSyncDate);
          if (parsed.workSchedule) setWorkSchedule(parsed.workSchedule);
          if (parsed.sleepSettings) setSleepSettings(parsed.sleepSettings);
          if (parsed.financialAssets) setFinancialAssets(parsed.financialAssets);
          if (parsed.budgetTransactions) setBudgetTransactions(parsed.budgetTransactions);
          if (parsed.paydayDate !== undefined) setPaydayDate(parsed.paydayDate);
          if (parsed.userProfile) setUserProfile(parsed.userProfile);
          if (parsed.budgetSessions && parsed.currentBudgetSessionId) {
            setBudgetSessions(parsed.budgetSessions);
            setCurrentBudgetSessionId(parsed.currentBudgetSessionId);
          }

          // チャットセッションの読み込み（旧フォーマットからのマイグレーション）
          if (parsed.chatSessions && parsed.currentSessionId) {
            setChatSessions(parsed.chatSessions);
            setCurrentSessionId(parsed.currentSessionId);
          } else if (parsed.chatHistory && parsed.chatHistory.length > 0) {
            // 旧フォーマット: chatHistory → セッション1件に変換
            const migratedSession = makeSession(parsed.chatHistory);
            migratedSession.title = parsed.chatHistory.find((m: ChatMessage) => m.role === 'user')?.content.slice(0, 20) || '以前のチャット';
            setChatSessions([migratedSession]);
            setCurrentSessionId(migratedSession.id);
          }

          // 古いルーティン・シフトイベントを除去（毎日新しく追加し直す）
          loadedEvents = (parsed.events || []).filter(
            (e: AppEvent) => !e.id.startsWith('routine-') && !e.id.startsWith('shift-')
          );
        }

        // Sync daily routine events (from onboarding setup)
        const lastRoutineSync = await AsyncStorage.getItem('@last_routine_event_sync');
        const routinesJson = await AsyncStorage.getItem('@daily_routines');
        if (routinesJson && lastRoutineSync !== today) {
          const dailyRoutines = JSON.parse(routinesJson) as Array<{
            id: string; label: string; emoji: string; hour: number; minute: number;
          }>;
          const routineEvents: AppEvent[] = dailyRoutines.map(r => ({
            id: `routine-${r.id}-${today}`,
            title: r.label,
            date: today,
            timeString: `${String(r.hour).padStart(2, '0')}:${String(r.minute).padStart(2, '0')}`,
            estimatedMinutes: 30,
          }));
          loadedEvents = [...loadedEvents, ...routineEvents];
          await AsyncStorage.setItem('@last_routine_event_sync', today);
        } else if (routinesJson && lastRoutineSync === today) {
          const dailyRoutines = JSON.parse(routinesJson) as Array<{
            id: string; label: string; emoji: string; hour: number; minute: number;
          }>;
          const routineEvents: AppEvent[] = dailyRoutines.map(r => ({
            id: `routine-${r.id}-${today}`,
            title: r.label,
            date: today,
            timeString: `${String(r.hour).padStart(2, '0')}:${String(r.minute).padStart(2, '0')}`,
            estimatedMinutes: 30,
          }));
          loadedEvents = [...loadedEvents, ...routineEvents];
        }

        // 今日のシフトをイベントとして追加
        const ws = parsed?.workSchedule as WorkSchedule | undefined;
        if (ws) {
          let shiftInfo: { startTime: string; endTime: string; name: string } | null = null;
          if (ws.type === 'fixed') {
            const dow = new Date(today + 'T12:00:00').getDay();
            if (ws.fixedDays.includes(dow)) {
              shiftInfo = { startTime: ws.fixedStartTime, endTime: ws.fixedEndTime, name: '勤務' };
            }
          } else {
            const wp = (ws.workplaces || []).find(w => w.id === ws.activeWorkplaceId);
            if (wp && !wp.daysOff.includes(today)) {
              shiftInfo = { startTime: wp.startTime, endTime: wp.endTime, name: wp.name };
            }
          }
          if (shiftInfo) {
            const [sH, sM] = shiftInfo.startTime.split(':').map(Number);
            const [eH, eM] = shiftInfo.endTime.split(':').map(Number);
            loadedEvents.push({
              id: `shift-${today}`,
              title: shiftInfo.name,
              date: today,
              timeString: shiftInfo.startTime,
              estimatedMinutes: (eH * 60 + eM) - (sH * 60 + sM),
            });
          }
        }

        setEvents(loadedEvents);
      } catch (error) {
        console.error('Failed to load user data', error);
      } finally {
        setIsReady(true);
      }
    };
    loadData();
  }, []);

  // Save to Storage on any state change
  useEffect(() => {
    if (!isReady) return;
    const saveData = async () => {
      try {
        const dataToSave = { tasks, events, budgetBalance, chatSessions, currentSessionId, spareTime, routines, lastSyncDate, workSchedule, sleepSettings, financialAssets, budgetTransactions, paydayDate, budgetSessions, currentBudgetSessionId, userProfile };
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
      } catch (error) {
        console.error('Failed to save user data', error);
      }
    };
    saveData();
  }, [tasks, events, budgetBalance, chatSessions, currentSessionId, spareTime, workSchedule, sleepSettings, financialAssets, budgetTransactions, paydayDate, budgetSessions, currentBudgetSessionId, userProfile, isReady]);

  // workSchedule変更時に今日のシフトイベントを再生成
  useEffect(() => {
    if (!isReady) return;
    const today = toLocalDateStr(new Date());
    let shiftInfo: { startTime: string; endTime: string; name: string } | null = null;
    if (workSchedule.type === 'fixed') {
      const dow = new Date(today + 'T12:00:00').getDay();
      if (workSchedule.fixedDays.includes(dow)) {
        shiftInfo = { startTime: workSchedule.fixedStartTime, endTime: workSchedule.fixedEndTime, name: '勤務' };
      }
    } else {
      const wp = (workSchedule.workplaces || []).find(w => w.id === workSchedule.activeWorkplaceId);
      if (wp && !wp.daysOff.includes(today)) {
        shiftInfo = { startTime: wp.startTime, endTime: wp.endTime, name: wp.name };
      }
    }
    setEvents(prev => {
      const without = prev.filter(e => e.id !== `shift-${today}`);
      if (!shiftInfo) return without;
      const [sH, sM] = shiftInfo.startTime.split(':').map(Number);
      const [eH, eM] = shiftInfo.endTime.split(':').map(Number);
      return [...without, {
        id: `shift-${today}`,
        title: shiftInfo.name,
        date: today,
        timeString: shiftInfo.startTime,
        estimatedMinutes: (eH * 60 + eM) - (sH * 60 + sM),
      }];
    });
  }, [workSchedule, isReady]);

  const syncTaskEvent = (task: Task) => {
    const eventId = `task-${task.id}`;
    if (task.scheduledTime && task.status === 'todo') {
      const date = task.dueDate || toLocalDateStr(new Date());
      const taskEvent: AppEvent = {
        id: eventId,
        title: task.title,
        date,
        timeString: task.scheduledTime,
        estimatedMinutes: task.estimatedMinutes,
      };
      setEvents(prev => {
        const without = prev.filter(e => e.id !== eventId);
        return [...without, taskEvent];
      });
    } else {
      setEvents(prev => prev.filter(e => e.id !== eventId));
    }
  };

  const addTask = (task: Task) => {
    if (task.scheduledTime) {
      const date = task.dueDate || toLocalDateStr(new Date());
      scheduleTaskReminder({ taskTitle: task.title, taskDate: date, taskTime: task.scheduledTime })
        .then(notifId => {
          const taskWithNotif = notifId ? { ...task, notificationId: notifId } : task;
          setTasks((prev) => {
            const isRoutineTask = task.id.startsWith('r-');
            const hasUserTask = prev.some(t => !t.id.startsWith('r-'));
            const base = (!isRoutineTask && !hasUserTask) ? prev.filter(t => !t.id.startsWith('r-')) : prev;
            return [...base, taskWithNotif];
          });
          syncTaskEvent(taskWithNotif);
        });
      return;
    }
    setTasks((prev) => {
      const isRoutineTask = task.id.startsWith('r-');
      const hasUserTask = prev.some(t => !t.id.startsWith('r-'));
      const base = (!isRoutineTask && !hasUserTask) ? prev.filter(t => !t.id.startsWith('r-')) : prev;
      return [...base, task];
    });
  };

  const updateTask = (id: string, changes: Partial<Task>) => {
    setTasks((prev) => {
      const updated = prev.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t, ...changes };
        // 時間が変わった場合は古い通知をキャンセルして再スケジュール
        if (changes.scheduledTime !== undefined && t.notificationId) {
          cancelNotification(t.notificationId).catch(() => {});
        }
        if (next.scheduledTime && next.status === 'todo') {
          const date = next.dueDate || toLocalDateStr(new Date());
          scheduleTaskReminder({ taskTitle: next.title, taskDate: date, taskTime: next.scheduledTime })
            .then(notifId => {
              if (notifId) {
                setTasks(p => p.map(tt => tt.id === id ? { ...tt, notificationId: notifId } : tt));
              }
            });
        }
        syncTaskEvent(next);
        return next;
      });
      return updated;
    });
  };

  const deleteTask = (id: string) => {
    setTasks(prev => {
      const task = prev.find(t => t.id === id);
      if (task?.notificationId) cancelNotification(task.notificationId).catch(() => {});
      return prev.filter(t => t.id !== id);
    });
    setEvents(prev => prev.filter(e => e.id !== `task-${id}`));
  };

  const completeTask = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        if (t.notificationId) cancelNotification(t.notificationId).catch(() => {});
        return { ...t, status: 'completed' };
      })
    );
    setEvents(prev => prev.filter(e => e.id !== `task-${id}`));
  };

  const addExpense = (amount: number, description: string) => {
    const today = new Date().toISOString().split('T')[0];
    const newTx: BudgetTransaction = {
      id: `tx-${Date.now()}`,
      type: 'expense',
      description,
      amount,
      date: today,
    };
    setBudgetTransactions(prev => [newTx, ...prev.slice(0, 49)]);
    setFinancialAssets(prev => {
      const newCash = prev.jpyCash - amount;
      setBudgetBalance(newCash); // Sync legacy balance
      return { ...prev, jpyCash: newCash };
    });
  };

  const addIncome = (amount: number, title: string) => {
    const today = new Date().toISOString().split('T')[0];
    const newTx: BudgetTransaction = {
      id: `tx-${Date.now()}`,
      type: 'income',
      description: title,
      amount,
      date: today,
    };
    setBudgetTransactions(prev => [newTx, ...prev.slice(0, 49)]);
    setFinancialAssets(prev => {
      const newCash = prev.jpyCash + amount;
      setBudgetBalance(newCash); // Sync legacy balance
      return { ...prev, jpyCash: newCash };
    });
  };

  const addEvent = (event: AppEvent) => {
    setEvents((prev) => [...prev, event]);
  };
  const updateEvent = (id: string, updates: Partial<AppEvent>) => {
    setEvents((prev) => prev.map(e => e.id === id ? { ...e, ...updates } : e));
  };
  const deleteEvent = (id: string) => {
    setEvents((prev) => prev.filter(e => e.id !== id));
  };

  const addChatMessage = (msg: ChatMessage) => {
    setChatSessions(prev => prev.map(s => {
      if (s.id !== currentSessionId) return s;
      // 最初のユーザーメッセージからタイトルを自動生成
      const isFirstUserMsg = s.messages.length === 0 && msg.role === 'user';
      const title = isFirstUserMsg
        ? msg.content.slice(0, 24) + (msg.content.length > 24 ? '…' : '')
        : s.title;
      return { ...s, title, messages: [...s.messages, msg] };
    }));
  };

  const createNewSession = () => {
    const newSession = makeSession();
    setChatSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);
  };

  const switchSession = (id: string) => {
    setCurrentSessionId(id);
  };

  const deleteSession = (id: string) => {
    setChatSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (filtered.length === 0) {
        const newSession = makeSession();
        if (id === currentSessionId) setCurrentSessionId(newSession.id);
        return [newSession];
      }
      if (id === currentSessionId) setCurrentSessionId(filtered[0].id);
      return filtered;
    });
  };

  const addRoutine = (routine: Routine) => {
    setRoutines((prev) => [...prev, routine]);
  };

  const syncRoutines = () => {
    const today = new Date().toISOString().split('T')[0];
    if (lastSyncDate === today) return;

    const routineTasks: Task[] = routines.map(r => ({
      id: `r-${r.id}-${Date.now()}`,
      title: r.title,
      estimatedCost: 0,
      estimatedMinutes: r.estimatedMinutes,
      status: 'todo'
    }));

    setTasks(prev => [...prev, ...routineTasks]);
    setLastSyncDate(today);
  };

  const updateFinancialAssets = (fa: Partial<FinancialAssets>) => {
    setFinancialAssets(prev => {
      const next = { ...prev, ...fa };
      if (fa.jpyCash !== undefined) {
        setBudgetBalance(fa.jpyCash);
      }
      return next;
    });
  };

  const budgetMessages = budgetSessions.find(s => s.id === currentBudgetSessionId)?.messages ?? [];

  const addBudgetMessage = (msg: { role: 'ai' | 'user'; text: string }) => {
    const date = new Date().toISOString();
    setBudgetSessions(prev => prev.map(s => {
      if (s.id !== currentBudgetSessionId) return s;
      const isFirstUser = s.messages.length === 0 && msg.role === 'user';
      const title = isFirstUser
        ? msg.text.slice(0, 24) + (msg.text.length > 24 ? '…' : '')
        : s.title;
      return { ...s, title, messages: [...s.messages, { ...msg, date }] };
    }));
  };

  const createNewBudgetSession = () => {
    const s = makeBudgetSession();
    setBudgetSessions(prev => [s, ...prev]);
    setCurrentBudgetSessionId(s.id);
  };

  const switchBudgetSession = (id: string) => setCurrentBudgetSessionId(id);

  const deleteBudgetSession = (id: string) => {
    setBudgetSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (filtered.length === 0) {
        const s = makeBudgetSession();
        if (id === currentBudgetSessionId) setCurrentBudgetSessionId(s.id);
        return [s];
      }
      if (id === currentBudgetSessionId) setCurrentBudgetSessionId(filtered[0].id);
      return filtered;
    });
  };

  const addBudgetTransaction = (tx: BudgetTransaction) =>
    setBudgetTransactions(prev => [tx, ...prev.slice(0, 49)]);

  const removeBudgetTransaction = (id: string) =>
    setBudgetTransactions(prev => prev.filter(t => t.id !== id));

  const updatePaydayDate = (day: number) => setPaydayDate(day);

  const updateWorkSchedule = (ws: Partial<WorkSchedule>) =>
    setWorkSchedule(prev => ({ ...prev, ...ws }));

  const updateSleepSettings = (ss: Partial<SleepSettings>) =>
    setSleepSettings(prev => ({ ...prev, ...ss }));


  const addWorkplace = (workplace: Omit<WorkplacePreset, 'id'>) => {
    const newId = `wp-${Date.now()}`;
    setWorkSchedule(prev => ({
      ...prev,
      workplaces: [...(prev.workplaces || []), { ...workplace, id: newId }],
      activeWorkplaceId: prev.activeWorkplaceId ?? newId,
    }));
  };

  const deleteWorkplace = (id: string) =>
    setWorkSchedule(prev => ({
      ...prev,
      workplaces: (prev.workplaces || []).filter(w => w.id !== id),
      activeWorkplaceId: prev.activeWorkplaceId === id ? null : prev.activeWorkplaceId,
    }));

  const setActiveWorkplace = (id: string | null) =>
    setWorkSchedule(prev => ({ ...prev, activeWorkplaceId: id }));

  const addDayOff = (workplaceId: string, date: string) =>
    setWorkSchedule(prev => ({
      ...prev,
      workplaces: prev.workplaces.map(w =>
        w.id === workplaceId ? { ...w, daysOff: [...new Set([...w.daysOff, date])] } : w
      ),
    }));

  const removeDayOff = (workplaceId: string, date: string) =>
    setWorkSchedule(prev => ({
      ...prev,
      workplaces: prev.workplaces.map(w =>
        w.id === workplaceId ? { ...w, daysOff: w.daysOff.filter(d => d !== date) } : w
      ),
    }));

  const getTodayWorkShift = (dateStr?: string): ShiftEntry | null => {
    const target = dateStr || toLocalDateStr(new Date());
    if (workSchedule.type === 'fixed') {
      const day = new Date(target + 'T12:00:00').getDay();
      if (workSchedule.fixedDays.includes(day)) {
        return { id: `fixed-${target}`, date: target, startTime: workSchedule.fixedStartTime, endTime: workSchedule.fixedEndTime };
      }
      return null;
    }
    // シフト制：アクティブ勤務先があり、その日が休みでなければ勤務
    const wp = (workSchedule.workplaces || []).find(w => w.id === workSchedule.activeWorkplaceId);
    if (wp && !wp.daysOff.includes(target)) {
      return { id: `shift-${target}`, date: target, startTime: wp.startTime, endTime: wp.endTime };
    }
    return null;
  };

  const getAvailableMinutes = (dateStr?: string): number => {
    const target = dateStr || toLocalDateStr(new Date());
    return calcAvailableMinutes(events, sleepSettings, target);
  };

  const clearData = async () => {
    const newSession = makeSession();
    setTasks([]);
    setEvents([]);
    setBudgetBalance(150000);
    setChatSessions([newSession]);
    setCurrentSessionId(newSession.id);
    setSpareTime(0);
    setRoutines([
      { id: 'r1', title: '朝の薬を飲む', estimatedMinutes: 1 },
      { id: 'r2', title: '歯を磨く', estimatedMinutes: 5 },
      { id: 'r3', title: '今日を生き抜くための深呼吸', estimatedMinutes: 2 },
    ]);
    setLastSyncDate('');
    setWorkSchedule(DEFAULT_WORK_SCHEDULE);
    setSleepSettings(DEFAULT_SLEEP_SETTINGS);
    setFinancialAssets(DEFAULT_FINANCIAL_ASSETS);
    setBudgetTransactions([]);
    setPaydayDate(25);
    const newBs = makeBudgetSession();
    setBudgetSessions([newBs]);
    setCurrentBudgetSessionId(newBs.id);
    await AsyncStorage.removeItem(STORAGE_KEY);
    await AsyncStorage.removeItem('@daily_routines');
    await AsyncStorage.removeItem('@last_routine_event_sync');
  };

  const addUserInsight = (insight: string) => {
    setUserProfile(prev => {
      if (prev.includes(insight)) return prev;
      return [...prev, insight];
    });
  };

  if (!isReady) return null;

  return (
    <AppContext.Provider value={{
      tasks, addTask, updateTask, deleteTask, completeTask,
      budgetBalance, addExpense, addIncome,
      events, addEvent, updateEvent, deleteEvent,
      chatHistory, addChatMessage,
      chatSessions, currentSessionId, createNewSession, switchSession, deleteSession,
      spareTime, setSpareTime,
      routines, addRoutine, syncRoutines,
      workSchedule, sleepSettings, updateWorkSchedule, updateSleepSettings,
      addWorkplace, deleteWorkplace, setActiveWorkplace, addDayOff, removeDayOff, getTodayWorkShift, getAvailableMinutes,
      financialAssets, updateFinancialAssets, budgetTransactions, addBudgetTransaction, removeBudgetTransaction, paydayDate, updatePaydayDate,
      budgetSessions, currentBudgetSessionId, budgetMessages, addBudgetMessage, createNewBudgetSession, switchBudgetSession, deleteBudgetSession,
      clearData,
      userProfile,
      addUserInsight,
      aiFeatureState: {
        hasInitialFetched,
        setInitialFetched,
      }
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppContext must be used within AppProvider');
  return context;
};
