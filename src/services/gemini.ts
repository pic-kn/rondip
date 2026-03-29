import { GoogleGenerativeAI } from '@google/generative-ai';
import { Task, AppEvent } from '../context/AppContext';

export interface ParsedIntent {
  type: 'task' | 'expense' | 'schedule' | 'general' | 'update_task' | 'delete_task';
  responseMessage: string;
  data?: any;
  travelTime?: number;
  destination?: string;
  needsNavigation?: boolean;
}

// --- Worker (本番) ---
const WORKER_URL = process.env.EXPO_PUBLIC_AI_WORKER_URL;
const WORKER_SECRET = process.env.EXPO_PUBLIC_AI_SECRET;

// --- 直接 Gemini (開発用フォールバック) ---
const apiKeys = [
  process.env.EXPO_PUBLIC_GEMINI_API_KEY,
  process.env.EXPO_PUBLIC_GEMINI_API_KEY_2,
  process.env.EXPO_PUBLIC_GEMINI_API_KEY_3,
].filter(Boolean) as string[];

let currentKeyIndex = 0;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

async function callWorker(messages: Message[]): Promise<string> {
  const res = await fetch(WORKER_URL!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${WORKER_SECRET}`,
    },
    body: JSON.stringify({ messages }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Worker ${res.status}: ${(err as any).error}`);
  }

  const data = await res.json() as { text: string };
  return data.text;
}

async function callGeminiDirect(messages: Message[]): Promise<string> {
  const startKeyIndex = currentKeyIndex;
  let attempts = 0;
  let lastError: any;

  while (attempts <= apiKeys.length) {
    try {
      const genAI = new GoogleGenerativeAI(apiKeys[currentKeyIndex] || '');
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }, { apiVersion: 'v1beta' });
      const systemMsg = messages.find(m => m.role === 'system');
      const userContent = messages.filter(m => m.role !== 'system').map(m => m.content).join('\n');
      const prompt = systemMsg ? `${systemMsg.content}\n\n${userContent}` : userContent;
      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    } catch (error: any) {
      lastError = error;
      if (!error.message?.includes('429') && error.status !== 429) throw error;
      currentKeyIndex = (currentKeyIndex + 1) % Math.max(apiKeys.length, 1);
      attempts++;
      if (currentKeyIndex === startKeyIndex) await sleep(15000);
    }
  }
  throw lastError;
}

async function callAI(messages: Message[]): Promise<string> {
  if (WORKER_URL && WORKER_SECRET) return callWorker(messages);
  return callGeminiDirect(messages);
}

// ---

export const processUserText = async (text: string, currentCity?: string | null, existingTasks?: Task[], recentMessages?: { role: string; content: string }[]): Promise<ParsedIntent> => {
  const today = new Date().toISOString().split('T')[0];
  const locationContext = currentCity ? `現在地: ${currentCity}` : '現在地: 不明';
  const taskListContext = existingTasks && existingTasks.length > 0
    ? `\n【登録済みタスク】: ${existingTasks.map(t => `"${t.title}"`).join('、')}`
    : '';
  const historyContext = recentMessages && recentMessages.length > 0
    ? `\n【直近の会話】:\n${recentMessages.map(m => `${m.role === 'user' ? 'ユーザー' : 'AI'}: ${m.content}`).join('\n')}`
    : '';

  try {
    const responseText = await callAI([
      {
        role: 'system',
        content: `あなたは優秀なADHD支援アシスタントです。ユーザーの入力を解析し、JSONで返してください。
【今の日付】: ${today}
【現在地】: ${locationContext}${taskListContext}${historyContext}

【分類ルール】
- "update_task": 既存タスクの修正・変更要求。「〇〇を△△に変更」「タスクの時間を〜分に」「さっきのやつ」「先ほどの」など直近会話を参照する場合も含む
- "delete_task": 既存タスクの削除要求。「〇〇は無くなった」「〇〇をキャンセル」「〇〇を削除して」など
- "schedule": 特定の時刻・日時・場所を伴う外出・アポイント・イベント。「〇時に」「明日」「来週」+外出先・人との約束が含まれる場合は必ずschedule。（例: 3時に歯医者、明日の会議、夜7時に飲み会、〜に行く）
- "task": 時間指定なく自分で完結できる行動。（例: 薬を飲む、掃除する、メールを送る）
- "expense": 金額が含まれる支出記録。
- "general": 上記以外の雑談・質問。

返却フォーマット:
{
  "type": "task" | "schedule" | "expense" | "general" | "update_task" | "delete_task",
  "responseMessage": "ユーザーへの返答(親しみやすく)",
  "destination": "目的地名(あれば)",
  "needsNavigation": コンビニ・スーパー・駅など日常的に行く場所はfalse、病院・会議場所・初めて行く場所などはtrue,
  "travelTime": 推定移動時間(分、needsNavigationがfalseならnull),
  "data": {
    // task/schedule/expense の場合:
    "title": "短くシンプルなタスク名（詳細は省く。例: スーパーで買い物、歯医者の予約、部屋の掃除）",
    "date": "YYYY-MM-DD (指示がなければ今日、明日なら翌日)",
    "estimatedMinutes": 推定所要時間(数値),
    "timeString": "24時間制HH:mm形式(例: 3時→'03:00', 午後3時→'15:00', 3時半→'03:30', 15時→'15:00')。時刻の言及がなければnull",
    "amount": 数値,
    "description": "内容",
    // update_task / delete_task の場合:
    "targetTitle": "対象の既存タスク名（登録済みタスクか直近会話から特定する）",
    "newTitle": "新しいタスク名（update_taskでタイトルを変更する場合のみ）",
    "estimatedMinutes": 新しい所要時間（update_taskで変更する場合のみ、数値）
  }
}

移動時間ルール:
1. 同一市内なら15-45分
2. 遠方(県跨ぎ)は180分以上、responseMessageに新幹線等の警告を含める
3. 不明はnull`,
      },
      { role: 'user', content: text },
    ]);

    let jsonString = responseText.trim();
    // コードブロック除去
    const codeBlockMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      jsonString = codeBlockMatch[1].trim();
    } else {
      // JSON オブジェクトを直接抽出
      const jsonObjectMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonObjectMatch) jsonString = jsonObjectMatch[0];
    }
    return JSON.parse(jsonString);
  } catch (e) {
    console.error('processUserText error:', e);
    return { type: 'general', responseMessage: 'すみません、エラーが発生しました。' };
  }
};

export const generateGreeting = async (tasks: Task[], budget: number, events: AppEvent[], currentCity?: string | null): Promise<string> => {
  try {
    return await callAI([
      { role: 'system', content: 'あなたはADHD向けアプリのアシスタントです。短い励ましの挨拶を1-2文で返してください。' },
      { role: 'user', content: `タスク:${tasks.length}件, 予算残:¥${budget}, 場所:${currentCity || '不明'}` },
    ]);
  } catch {
    return 'こんにちは！今日も無理せずいきましょう。';
  }
};

export const breakdownTask = async (taskTitle: string, originalText?: string): Promise<string[]> => {
  const context = originalText && originalText !== taskTitle
    ? `タスク: ${taskTitle}\n元の入力: ${originalText}`
    : `タスク: ${taskTitle}`;
  try {
    const text = await callAI([
      {
        role: 'system',
        content: '与えられたタスクを、誰でもすぐ実行できる具体的なステップ3〜5つに分解してください。元の入力がある場合はその内容（買うものの列挙など）を最大限活用してください。カンマ区切りで返してください。短く具体的に。番号や余分なテキストは不要。',
      },
      { role: 'user', content: context },
    ]);
    return text
      .split(/[、,\n]/)
      .map((s: string) => s.replace(/^\d+\.\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 5);
  } catch {
    return [];
  }
};

export interface BudgetParsedIntent {
  type: 'expense' | 'usd_buy' | 'future_lock' | 'income' | 'device_add' | 'correction' | 'general';
  responseMessage: string;
  confirmLabel: string;
  data?: any;
}

export const processBudgetText = async (
  text: string,
  context: { financialAssets: any; exchangeRate: number; recentTxs: any[] }
): Promise<BudgetParsedIntent> => {
  const { financialAssets, exchangeRate, recentTxs } = context;
  const usdInJpy = financialAssets.usdAmount * exchangeRate;
  const deviceTotal = (financialAssets.deviceAssets || []).reduce((s: number, d: any) => s + d.resaleValue, 0);
  const totalAssets = financialAssets.jpyCash + usdInJpy + deviceTotal;
  const locked = financialAssets.creditCardPending + financialAssets.monthlyFixedCosts +
    (financialAssets.futureExpenses || []).reduce((s: number, f: any) => s + f.amount, 0);
  const realDefense = totalAssets - locked;
  const today = new Date().toISOString().split('T')[0];
  const recentTxStr = recentTxs.length > 0
    ? recentTxs.map((t: any) => `${t.description} ¥${t.amount} (${t.type})`).join('、')
    : 'なし';

  try {
    const responseText = await callAI([
      {
        role: 'system',
        content: `あなたはADHD向け家計アシスタントです。ユーザーの入力を解析し、JSONで返してください。
【今日】: ${today}
【現在の実質防衛資金】: ¥${Math.round(realDefense).toLocaleString()}
【円現金】: ¥${financialAssets.jpyCash.toLocaleString()}
【USD保有】: $${financialAssets.usdAmount} (¥${Math.round(usdInJpy).toLocaleString()})
【USD/JPY】: ${exchangeRate}
【直近の取引】: ${recentTxStr}

【分類ルール】
- "expense": 支出。「スタバ 700円」「コンビニ 500円」など
- "usd_buy": ドル転。「3万円ドル転」「$200買う」など
- "future_lock": 将来の確定支出の仮押さえ。「車検 15万 4月」「来月の家賃 8万」など
- "income": 収入。「給料 20万入った」「バイト代 5万」など
- "device_add": 機材・資産の追加。「カメラを8万で買った」「MacBook 15万で売れそう」など
- "correction": 直近の入力を訂正。「さっきの700円じゃなくて800円だった」など
- "general": その他の質問・雑談

返却フォーマット:
{
  "type": "expense" | "usd_buy" | "future_lock" | "income" | "device_add" | "correction" | "general",
  "responseMessage": "親しみやすい返答。支出/収入時は確定後の防衛資金も伝える",
  "confirmLabel": "確定ボタンに表示するテキスト（例: スタバ -¥700）",
  "data": {
    "description": "項目名",
    "amount": 数値（JPY）,
    "jpyAmount": 数値（usd_buy時のJPY額）,
    "dueMonth": "YYYY-MM（future_lock時）",
    "name": "機材名（device_add時）",
    "resaleValue": 数値（device_add時）,
    "newAmount": 数値（correction時の新しい金額）
  }
}`,
      },
      { role: 'user', content: text },
    ]);

    let jsonString = responseText.trim();
    const codeBlockMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      jsonString = codeBlockMatch[1].trim();
    } else {
      const jsonObjectMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonObjectMatch) jsonString = jsonObjectMatch[0];
    }
    return JSON.parse(jsonString);
  } catch (e) {
    console.error('processBudgetText error:', e);
    return { type: 'general', responseMessage: 'すみません、エラーが発生しました。', confirmLabel: '' };
  }
};

export const generateSuggestions = async (tasks: Task[], budget: number, events: AppEvent[], time: string, weather: string, currentCity?: string | null): Promise<string[]> => {
  try {
    const text = await callAI([
      { role: 'system', content: '今できる具体的なアクションを3つ、カンマ区切りで返してください。文章ではなく短いフレーズで。' },
      { role: 'user', content: `タスク:${tasks.length}件, 場所:${currentCity || '不明'}, 時間:${time}` },
    ]);
    return text.split(/[、,]/).map((s: string) => s.trim()).filter(Boolean).slice(0, 3);
  } catch {
    return ['タスクを確認する', '一息つく', '水分を補給する'];
  }
};
