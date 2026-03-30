import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { useAppContext, Task, AppEvent } from '../context/AppContext';
import { breakdownTask } from '../services/gemini';

interface Subtask {
  id: string;
  title: string;
}

const toLocalDateString = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const formatDuration = (minutes: number): string => {
  if (minutes < 60) return `${minutes}分`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
};

export default function TaskExecutionScreen() {
  const { tasks, events, completeTask, getAvailableMinutes } = useAppContext();

  const [subtasksByTask, setSubtasksByTask] = useState<Record<string, Subtask[]>>({});
  const [checkedByTask, setCheckedByTask] = useState<Record<string, Set<string>>>({});
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);

  const now = new Date();
  const todayStr = toLocalDateString(now);
  const nowStr = now.toTimeString().slice(0, 5);

  // 未完了タスクを所要時間の短い順に自動ソート
  const pendingTasks = tasks
    .filter(t => t.status === 'todo')
    .sort((a, b) => a.estimatedMinutes - b.estimatedMinutes);

  // 今日の残り予定
  const upcomingEvents = events.filter(
    e => e.date === todayStr && e.timeString >= nowStr
  );

  // 残り時間の計算（イベント・勤務時間はgetAvailableMinutes内で考慮済み）
  const totalTaskMinutes = pendingTasks.filter(t => !t.dueDate).reduce((sum, t) => sum + t.estimatedMinutes, 0);
  const availableMinutes = getAvailableMinutes();
  const freeMinutes = availableMinutes - totalTaskMinutes;

  const handleBreakdown = async (task: Task) => {
    if (loadingTaskId || subtasksByTask[task.id]) return;
    setLoadingTaskId(task.id);
    const steps = await breakdownTask(task.title, task.originalText);
    const subtasks: Subtask[] = steps.map((title, i) => ({ id: `${task.id}-${i}`, title }));
    setSubtasksByTask(prev => ({ ...prev, [task.id]: subtasks }));
    setCheckedByTask(prev => ({ ...prev, [task.id]: new Set() }));
    setLoadingTaskId(null);
  };

  const toggleSubtask = (taskId: string, subtaskId: string) => {
    setCheckedByTask(prev => {
      const current = new Set(prev[taskId] || []);
      if (current.has(subtaskId)) current.delete(subtaskId);
      else current.add(subtaskId);
      return { ...prev, [taskId]: current };
    });
  };

  return (
    <ScrollView style={styles.container}>

      {/* 残り時間サマリー */}
      {pendingTasks.length > 0 && (
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryMain}>
              残り {pendingTasks.length}件 / 約{formatDuration(totalTaskMinutes)}
            </Text>
          </View>
          <Text style={styles.summaryFree}>
            {freeMinutes >= 0
              ? `今日の余裕 +${formatDuration(freeMinutes)}`
              : `今日はタスクが${formatDuration(Math.abs(freeMinutes))}分オーバーしています`}
          </Text>
        </View>
      )}

      {/* タスク一覧 */}
      {pendingTasks.length > 0 ? (
        <View style={styles.taskList}>
          {pendingTasks.map((task, index) => {
            const subtasks = subtasksByTask[task.id];
            const checked = checkedByTask[task.id] || new Set();
            const isLoading = loadingTaskId === task.id;
            const hasSubtasks = !!subtasks;

            return (
              <View key={task.id}>
                <View style={styles.taskRow}>
                  {/* チェックボックス */}
                  <TouchableOpacity
                    style={styles.checkbox}
                    onPress={() => completeTask(task.id)}
                  >
                    <Ionicons name="ellipse-outline" size={24} color={colors.border} />
                  </TouchableOpacity>

                  {/* タスク情報 */}
                  <View style={styles.taskInfo}>
                    <Text style={styles.taskTitle}>{task.title}</Text>
                    <Text style={styles.taskSubtitle}>
                      {task.scheduledTime ? `${task.scheduledTime} · ` : ''}{formatDuration(task.estimatedMinutes)}
                    </Text>
                  </View>

                  {/* 細分化ボタン */}
                  <TouchableOpacity
                    style={styles.breakdownBtn}
                    onPress={() => handleBreakdown(task)}
                    disabled={isLoading || hasSubtasks}
                  >
                    {isLoading
                      ? <ActivityIndicator size="small" color={colors.textSecondary} />
                      : <Ionicons
                          name="flash-outline"
                          size={18}
                          color={hasSubtasks ? colors.border : colors.textSecondary}
                        />
                    }
                  </TouchableOpacity>
                </View>

                {/* サブタスク */}
                {hasSubtasks && (
                  <View style={styles.subtasksContainer}>
                    {subtasks.map(sub => {
                      const done = checked.has(sub.id);
                      return (
                        <TouchableOpacity
                          key={sub.id}
                          style={styles.subtaskRow}
                          onPress={() => toggleSubtask(task.id, sub.id)}
                          activeOpacity={0.7}
                        >
                          <Ionicons
                            name={done ? 'checkmark-circle' : 'ellipse-outline'}
                            size={18}
                            color={done ? colors.text : colors.border}
                          />
                          <Text style={[styles.subtaskText, done && styles.subtaskDone]}>
                            {sub.title}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {index < pendingTasks.length - 1 && <View style={styles.separator} />}
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Ionicons name="checkmark-done-circle-outline" size={48} color={colors.border} />
          <Text style={styles.emptyText}>タスクがありません</Text>
        </View>
      )}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  summaryCard: {
    backgroundColor: colors.surface,
    margin: 16, marginTop: 24, borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: colors.borderSubtle,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  summaryMain: { fontSize: 17, fontWeight: '600', color: colors.text },
  summaryFree: { fontSize: 13, color: colors.textSecondary },

  taskList: {
    backgroundColor: colors.surface,
    borderRadius: 16, marginHorizontal: 16, marginTop: 8,
    borderWidth: 1, borderColor: colors.borderSubtle,
    overflow: 'hidden',
  },
  taskRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  checkbox: {
    marginRight: 12,
  },
  taskInfo: { flex: 1 },
  taskTitle: { fontSize: 15, color: colors.text, fontWeight: '500' },
  taskSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  breakdownBtn: {
    width: 36, height: 36, justifyContent: 'center', alignItems: 'center',
  },

  subtasksContainer: {
    paddingLeft: 52, paddingRight: 16, paddingBottom: 12, gap: 10,
  },
  subtaskRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  subtaskText: { fontSize: 14, color: colors.text, flex: 1 },
  subtaskDone: { color: colors.border, textDecorationLine: 'line-through' },

  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginLeft: 52,
  },

  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingTop: 80, gap: 12,
  },
  emptyText: { fontSize: 15, color: colors.textSecondary },
});
