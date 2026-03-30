import { GoogleGenerativeAI } from '@google/generative-ai';
import { Task, AppEvent } from '../types';

export interface ParsedIntent {
  type: 'task' | 'expense' | 'income' | 'budget_update' | 'schedule' | 'general' | 'update_task' | 'delete_task' | 'update_schedule' | 'delete_schedule';
  responseMessage: string;
  data?: any;
  travelTime?: number;
  destination?: string;
  needsNavigation?: boolean;
  userInsight?: string;
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

export const processUserText = async (text: string, currentCity?: string | null, existingTasks?: Task[], recentMessages?: { role: string; content: string }[], existingEvents?: AppEvent[], financialAssets?: any, userProfile?: string[]): Promise<ParsedIntent> => {
  const now = new Date();
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const today = now.toISOString().split('T')[0];
  const timeContext = `現在時刻: ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')} (${days[now.getDay()]}曜日)`;
  const locationContext = currentCity ? `現在地: ${currentCity}` : '現在地: 不明';
  const taskListContext = existingTasks && existingTasks.length > 0
    ? `\n【登録済みタスク】: ${existingTasks.map(t => `"${t.title}"`).join('、')}`
    : '';
  const eventListContext = existingEvents && existingEvents.length > 0
    ? `\n【登録済み予定】: ${existingEvents.map(e => `[${e.date} ${e.timeString}] "${e.title}"`).join('、')}`
    : '';
  const historyContext = recentMessages && recentMessages.length > 0
    ? `\n【直近の会話】:\n${recentMessages.map(m => `${m.role === 'user' ? 'ユーザー' : 'AI'}: ${m.content}`).join('\n')}`
    : '';

  try {
    const responseText = await callAI([
      {
        role: 'system',
        content: `【現在の状況】
- 日付: ${today}
- ${timeContext}
- ${locationContext}${taskListContext}${eventListContext}
${userProfile && userProfile.length > 0 ? `\n【あなたのこれまでの理解（記憶）】:\n${userProfile.map(p => `- ${p}`).join('\n')}` : ''}
${historyContext}

【あなたの使命】
あなたはADHDを持つユーザーを支える、親しみやすく聡明な秘書です。
ユーザーの発言から、「得意なこと」「苦手なこと」「習慣」「好み」などの新しい発見（Insight）があれば、必ず抽出してください。
また、提供された「これまでの理解」に基づき、「あなたは〇〇が得意でしたね」といったパーソナライズされた提案を行ってください。

【分類ルール】
- "update_task": 既存タスクの修正・変更要求。「〇〇を△△に変更」など
- "delete_task": 既存タスクの削除要求。「〇〇は無くなった」など
- "update_schedule": 既存の予定・イベントの変更
- "delete_schedule": 既存の予定・イベントの削除
- "schedule": 日時・場所を伴う外出・イベントの【新規作成】
- "task": 自分で完結できる行動の【新規作成】（時間指定があってもtaskとして登録）
- "expense": 支出記録（コーヒー 500円、家賃 8万など）。
- "income": 収入記録（給料 20万、月収 35など）。
- "budget_update": 資産の初期設定や現在の残高報告（現金が5万ある、USDを$100持っている、など）。
- "general": 上記以外の雑談・質問。

【時間解釈ルール】
1. 「今から20分後」「30分後」「2時間後」などの相対時刻は、必ず現在時刻を基準に絶対時刻へ変換すること。
2. 時刻が推定できた場合、schedule では必ず "timeString" に "HH:MM" を入れること。
3. task で時間指定がある場合は "scheduledTime" に "HH:MM" を入れること。
4. 「明日」「今日の夜」「今夜」なども、可能な限り "date" と "timeString" に具体化すること。
5. 外出予定なのに時間が推定できる場合は、"timeString" を null にしないこと。

【金額パースの鉄則 (重要)】
1. 「35」「35万」などの収入/支出は、日本円(JPY)として解釈。
2. 月収・給与の文脈で「35」「40」などの2〜3桁の数値が来たら、それは「万」単位（350,000 / 400,000）として扱うこと。
3. 明示的に「円」「万」がある場合はそれに従う。

返却フォーマット:
{
  "type": "task" | "schedule" | "expense" | "income" | "budget_update" | "general" | "update_task" | "delete_task" | "update_schedule" | "delete_schedule",
  "responseMessage": "ユーザーへの返答(親しみやすく)",
  "destination": "目的地名(あれば)",
  "needsNavigation": boolean,
  "travelTime": 数値またはnull,
  "userInsight": "ユーザーについて新しく知った事実・特性 (例: '朝が苦手', 'コーヒーが好き')。なければnull",
  "data": {
    // task/schedule/expense/income の場合:
    "title": "項目名",
    "amount": 数値(実金額単位。35万なら350000),
    "date": "YYYY-MM-DD",
    "timeString": "HH:MM または null（scheduleで時間がある場合は必須）",
    "scheduledTime": "HH:MM または null（taskで時間指定がある場合のみ）",
    // budget_update の場合:
    "jpyCash": 数値(任意),
    "usdAmount": 数値(任意),
    "monthlyFixedCosts": 数値(任意),
    "setupDone": boolean
  }
}

【具体例】
- 「給料35万入った」-> type: "income", data: { title: "給料", amount: 350000 }
- 「スタバで700円」 -> type: "expense", data: { description: "スタバ", amount: 700 }
- 「貯金が100万ある」-> type: "budget_update", data: { jpyCash: 1000000, setupDone: true }
- 「今から20分後にコンビニ行く」-> type: "schedule", data: { title: "コンビニ", date: "${today}", timeString: "現在時刻+20分のHH:MM" }
- 「30分後に洗濯する」-> type: "task", data: { title: "洗濯", scheduledTime: "現在時刻+30分のHH:MM" }

移動時間ルール:
1. 同一市内なら15-45分
2. 遠方(県跨ぎ)は180分以上、responseMessageに新幹線等の警告を含める
3. 不明はnull`,
      },
      { role: 'user', content: text },
    ]);

    let parsedResult;
    try {
      let jsonString = responseText.trim();
      const codeBlockMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (codeBlockMatch) {
        jsonString = codeBlockMatch[1].trim();
      } else {
        const jsonObjectMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonObjectMatch) jsonString = jsonObjectMatch[0];
      }
      parsedResult = JSON.parse(jsonString);
      const finalResult: ParsedIntent = {
        type: parsedResult.type || 'general',
        responseMessage: parsedResult.responseMessage || '了解しました。',
        destination: parsedResult.destination,
        needsNavigation: parsedResult.needsNavigation,
        travelTime: parsedResult.travelTime,
        userInsight: parsedResult.userInsight,
        data: parsedResult.data
      };
      return finalResult;
    } catch (parseError) {
      // JSONパースに失敗した場合（AIが完全な自然言語を返した場合）のフォールバック
      console.warn('Fallback to natural text parsing', responseText);
      const cleanText = responseText.replace(/```(?:json)?|```/g, '').trim();
      return { type: 'general', responseMessage: cleanText || '申し訳ありません、うまく分類できませんでした。' };
    }
  } catch (e) {
    console.error('processUserText network error:', e);
    return { type: 'general', responseMessage: 'オフラインまたはサーバーとの通信に失敗しました。' };
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

    let parsedResult;
    try {
      let jsonString = responseText.trim();
      const codeBlockMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (codeBlockMatch) {
        jsonString = codeBlockMatch[1].trim();
      } else {
        const jsonObjectMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonObjectMatch) jsonString = jsonObjectMatch[0];
      }
      parsedResult = JSON.parse(jsonString);
    } catch (parseError) {
      console.warn('Fallback to natural budgetary text parsing');
      const cleanText = responseText.replace(/```(?:json)?|```/g, '').trim();
      return { type: 'general', responseMessage: cleanText || '家計簿入力の解釈に失敗しました。', confirmLabel: '' };
    }
    return parsedResult;
  } catch (e) {
    console.error('processBudgetText network error:', e);
    return { type: 'general', responseMessage: '通信エラーが発生しました。', confirmLabel: '' };
  }
};

export const generateSuggestions = async (tasks: Task[], budget: number, events: AppEvent[], time: string, weather: string, currentCity?: string | null): Promise<string[]> => {
  const taskStr = tasks.slice(0, 5).map(t => t.title).join('、');
  const eventStr = events.slice(0, 3).map(e => `${e.timeString} ${e.title}`).join('、');
  const context = `
【現在状況】
- 時刻: ${time}
- 天気: ${weather}
- 場所: ${currentCity || '不明'}
- 予算（防衛資金）: ¥${budget.toLocaleString()}
- 未完了タスク: ${taskStr || 'なし'}
- 今後の予定: ${eventStr || 'なし'}

以上の情報を踏まえ、ユーザーが「今やるべき/できること」を具体的に3つ提案してください。
【ルール】
1. ADHDの人でも心理的負担が少ない、スモールステップなアクションを優先。
2. 雨なら「家でできること」、予算が少なければ「節約」、夜なら「リラックス」など状況に合わせる。
3. 5〜10文字程度の短いボタン用テキストとして。
4. カンマ区切りの文字列のみ。`;

  try {
    const text = await callAI([
      { role: 'system', content: '超具体的なアクションを3つ、カンマ区切りで返してください。番号不要。' },
      { role: 'user', content: context },
    ]);
    return text.split(/[、,]/).map((s: string) => s.replace(/^\d+\.\s*/, '').trim()).filter(Boolean).slice(0, 3);
  } catch {
    return ['タスクを確認する', '一息つく', '水分を補給する'];
  }
};
