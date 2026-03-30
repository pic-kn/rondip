export interface Task {
  id: string;
  title: string;
  estimatedCost: number;
  estimatedMinutes: number;
  status: 'todo' | 'completed';
  originalText?: string;
  subtasks?: string[];
  dueDate?: string; // YYYY-MM-DD（予定から作られたタスクの日付）
  scheduledTime?: string; // HH:MM（時間指定）
  notificationId?: string; // expo-notificationsのID
}

export interface AppEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  timeString: string;
  location?: string;
  estimatedMinutes?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actionType?: 'task' | 'expense' | 'income' | 'budget_update' | 'schedule' | 'greeting' | 'travel' | 'scheduleList' | 'taskList' | 'retry' | 'insight';
  actionData?: any;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  messages: ChatMessage[];
}

export interface Routine {
  id: string;
  title: string;
  estimatedMinutes: number;
}

export interface ShiftEntry {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
}

export interface WorkplacePreset {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  daysOff: string[]; // YYYY-MM-DD（休みの日）
}

export interface WorkSchedule {
  type: 'fixed' | 'shift';
  // 固定モード
  fixedDays: number[]; // 0=Sun, 1=Mon ... 6=Sat
  fixedStartTime: string;
  fixedEndTime: string;
  // シフトモード（勤務先ベース）
  activeWorkplaceId: string | null; // 現在の勤務先
  workplaces: WorkplacePreset[];
}

export interface SleepSettings {
  wakeTime: string; // HH:MM
  bedTime: string; // HH:MM
}

export interface DeviceAsset {
  id: string;
  name: string;
  resaleValue: number;
}

export interface FutureExpense {
  id: string;
  description: string;
  amount: number;
  dueMonth: string; // YYYY-MM
}

export interface FinancialAssets {
  jpyCash: number;
  usdAmount: number;
  deviceAssets: DeviceAsset[];
  creditCardPending: number;
  monthlyFixedCosts: number;
  futureExpenses: FutureExpense[];
  setupDone: boolean;
}

export interface BudgetMessage {
  role: 'ai' | 'user';
  text: string;
  date: string;
}

export interface BudgetSession {
  id: string;
  title: string;
  createdAt: string;
  messages: BudgetMessage[];
}

export interface BudgetTransaction {
  id: string;
  type: 'expense' | 'usd_buy' | 'future_lock' | 'income' | 'device_add';
  description: string;
  amount: number;
  usdAmount?: number;
  date: string;
}
