import { processUserText } from './gemini';

describe('processUserText', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('タスクの追加要請を正しく解析できるか', async () => {
    const mockAiResponse = {
      type: 'task',
      responseMessage: '「牛乳を買う」をタスクに追加しました。',
      data: {
        title: '牛乳を買う',
        date: '2026-03-29',
        estimatedMinutes: 15
      }
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ text: JSON.stringify(mockAiResponse) })
    });

    const result = await processUserText('牛乳買ってきて');

    expect(result.type).toBe('task');
    expect(result.data.title).toBe('牛乳を買う');
    expect(result.responseMessage).toContain('牛乳を買う');
  });

  it('予定の削除要請を正しく解析できるか', async () => {
    const mockAiResponse = {
      type: 'delete_schedule',
      responseMessage: '明日の会議を削除しますね。',
      data: {
        targetTitle: '会議'
      }
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ text: JSON.stringify(mockAiResponse) })
    });

    const result = await processUserText('明日の会議キャンセルで');

    expect(result.type).toBe('delete_schedule');
    expect(result.data.targetTitle).toBe('会議');
  });

  it('AIがJSON以外の不適切な回答をした場合にgeneralとしてフォールバックするか', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ text: 'あ、すみません！ちょっと分かりませんでした。' })
    });

    const result = await processUserText('意味不明な入力');

    expect(result.type).toBe('general');
    expect(result.responseMessage).toBe('あ、すみません！ちょっと分かりませんでした。');
  });
});

describe('processUserText - カオステスト', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ネットワークエラー時に general にフォールバックし「オフライン」を含むメッセージを返す', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network Error'));
    const result = await processUserText('なにか');
    expect(result.type).toBe('general');
    expect(result.responseMessage).toContain('オフライン');
  });

  it('サーバーが 500 エラーを返した時に general にフォールバックする', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ error: 'Server Error' }),
    });
    const result = await processUserText('なにか');
    expect(result.type).toBe('general');
  });

  it('AIがコードブロック包みの JSON を返した場合も正しくパースされる', async () => {
    const mockAiResponse = { type: 'task', responseMessage: '追加しました', data: { title: 'テスト' } };
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ text: '```json\n' + JSON.stringify(mockAiResponse) + '\n```' }),
    });
    const result = await processUserText('テストタスク追加して');
    expect(result.type).toBe('task');
    expect(result.data.title).toBe('テスト');
  });

  it('AI が type フィールドのない JSON を返した場合は general になる', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ text: JSON.stringify({ responseMessage: 'こんにちは', data: {} }) }),
    });
    const result = await processUserText('こんにちは');
    expect(result.type).toBe('general');
  });

  it('AI が空文字を返した場合にフォールバックする', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ text: '' }),
    });
    const result = await processUserText('なにか');
    expect(result.type).toBe('general');
  });

  it('支出を正しく解析できる', async () => {
    const mockAiResponse = {
      type: 'expense',
      responseMessage: '記録しました',
      data: { description: 'スタバ', amount: 700 },
    };
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ text: JSON.stringify(mockAiResponse) }),
    });
    const result = await processUserText('スタバで700円使った');
    expect(result.type).toBe('expense');
    expect(result.data.amount).toBe(700);
  });

  it('収入（万単位）を正しく解析できる', async () => {
    const mockAiResponse = {
      type: 'income',
      responseMessage: '給料35万を記録しました',
      data: { title: '給料', amount: 350000 },
    };
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ text: JSON.stringify(mockAiResponse) }),
    });
    const result = await processUserText('給料35万入った');
    expect(result.type).toBe('income');
    expect(result.data.amount).toBe(350000);
  });

  it('userInsight が含まれる場合に取得できる', async () => {
    const mockAiResponse = {
      type: 'general',
      responseMessage: 'わかりました',
      userInsight: '朝が苦手',
      data: {},
    };
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ text: JSON.stringify(mockAiResponse) }),
    });
    const result = await processUserText('朝は本当に動けない');
    expect(result.userInsight).toBe('朝が苦手');
  });

  it('オプション引数をすべて渡しても正常に動作する', async () => {
    const mockAiResponse = { type: 'general', responseMessage: 'OK', data: {} };
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ text: JSON.stringify(mockAiResponse) }),
    });
    const result = await processUserText(
      'なにかする',
      '東京',
      [{ id: 't1', title: '既存タスク', estimatedCost: 0, estimatedMinutes: 30, status: 'todo' }],
      [{ role: 'user', content: '以前の会話' }],
      [{ id: 'e1', title: '予定', date: '2026-03-29', timeString: '10:00' }],
      { jpyCash: 50000 },
      ['朝が苦手']
    );
    expect(result.type).toBe('general');
  });

  it('極端に長いテキストを送っても動作する', async () => {
    const longText = 'あ'.repeat(10000);
    const mockAiResponse = { type: 'general', responseMessage: '長いですね', data: {} };
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ text: JSON.stringify(mockAiResponse) }),
    });
    const result = await processUserText(longText);
    expect(result.type).toBe('general');
  });

  it('空文字を送っても動作する', async () => {
    const mockAiResponse = { type: 'general', responseMessage: 'なにか入力してください', data: {} };
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ text: JSON.stringify(mockAiResponse) }),
    });
    const result = await processUserText('');
    expect(result.type).toBe('general');
  });

  it('JSON の前後にゴミテキストがあっても正しくパースされる', async () => {
    const mockAiResponse = { type: 'task', responseMessage: '追加しました', data: { title: 'ゴミ付きテスト' } };
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ text: 'はい、こちらです！\n' + JSON.stringify(mockAiResponse) + '\n以上です。' }),
    });
    const result = await processUserText('タスク追加');
    expect(result.type).toBe('task');
  });
});
