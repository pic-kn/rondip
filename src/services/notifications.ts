import * as Notifications from 'expo-notifications';

// 通知の表示設定（アプリ起動中も表示）
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// 通知権限をリクエスト
export async function requestNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// 出発前チェック通知（1時間前）
// タップすると現在地から移動時間を再計算する
export async function scheduleDepartureAlert(params: {
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  travelMinutes: number;
  destination: string;
}): Promise<string | null> {
  const { eventTitle, eventDate, eventTime, destination } = params;

  const [year, month, day] = eventDate.split('-').map(Number);
  const [hour, minute] = eventTime.split(':').map(Number);
  const eventDateTime = new Date(year, month - 1, day, hour, minute);

  // 1時間前に通知
  const notifyTime = new Date(eventDateTime.getTime() - 60 * 60 * 1000);
  if (notifyTime <= new Date()) return null;

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: `${eventTitle}まであと1時間`,
      body: '今いる場所から移動時間を確認しますか？',
      sound: true,
      data: {
        type: 'pre_departure',
        destination,
        eventTitle,
        eventTime,
        eventDate,
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: notifyTime,
    },
  });

  return id;
}

// 予定リマインダー（X分前）
export async function scheduleEventReminder(params: {
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  minutesBefore: number;
}): Promise<string | null> {
  const { eventTitle, eventDate, eventTime, minutesBefore } = params;

  const [year, month, day] = eventDate.split('-').map(Number);
  const [hour, minute] = eventTime.split(':').map(Number);
  const eventDateTime = new Date(year, month - 1, day, hour, minute);
  const notifyTime = new Date(eventDateTime.getTime() - minutesBefore * 60 * 1000);

  if (notifyTime <= new Date()) return null;

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: `${minutesBefore}分後に予定があります`,
      body: `「${eventTitle}」が ${eventTime} に始まります。`,
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: notifyTime,
    },
  });

  return id;
}

// 通知をキャンセル
export async function cancelNotification(id: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(id);
}
