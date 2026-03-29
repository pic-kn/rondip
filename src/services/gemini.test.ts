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
