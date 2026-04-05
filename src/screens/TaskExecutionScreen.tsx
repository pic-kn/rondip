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

const formatTaskDate = (dateStr?: string): string | null => {
  if (!dateStr) return null;
  const date = new Date(`${dateStr}T12:00:00`);
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
  return `${date.getMonth() + 1}/${date.getDate()}(${weekday})`;
};

const taskGroupLabel = (dateStr?: string): string => formatTaskDate(dateStr) || '日付未設定';

export default function TaskExecutionScreen() {
  const { tasks, events, completeTask, updateTask, deleteTask, getAvailableMinutes } = useAppContext();

  const [subtasksByTask, setSubtasksByTask] = useState<Record<string, Subtask[]>>({});
  const [checkedByTask, setCheckedByTask] = useState<Record<string, Set<string>>>({});
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);
  const [isSelectingCompleted, setIsSelectingCompleted] = useState(false);
  const [selectedCompletedTaskIds, setSelectedCompletedTaskIds] = useState<Set<string>>(new Set());
  const [showCompletedMenu, setShowCompletedMenu] = useState(false);

  const now = new Date();
  const todayStr = toLocalDateString(now);
  const nowStr = now.toTimeString().slice(0, 5);

  // 未完了タスクを所要時間の短い順に自動ソート
  const pendingTasks = tasks
    .filter(t => t.status === 'todo')
    .sort((a, b) => a.estimatedMinutes - b.estimatedMinutes);

  const completedTasks = tasks
    .filter(t => t.status === 'completed')
    .sort((a, b) => {
      const dateA = a.dueDate || '9999-12-31';
      const dateB = b.dueDate || '9999-12-31';
      return dateA.localeCompare(dateB) || a.title.localeCompare(b.title);
    });

  const groupTasks = (items: Task[]) => items.reduce<Array<{ key: string; label: string; tasks: Task[] }>>((groups, task) => {
    const key = task.dueDate || 'unscheduled';
    const existing = groups.find(group => group.key === key);
    if (existing) {
      existing.tasks.push(task);
      return groups;
    }

    groups.push({
      key,
      label: taskGroupLabel(task.dueDate),
      tasks: [task],
    });
    return groups;
  }, []);

  const groupedPendingTasks = groupTasks(pendingTasks);
  const groupedCompletedTasks = groupTasks(completedTasks);

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
    const steps = task.subtasks && task.subtasks.length > 0
      ? task.subtasks
      : await breakdownTask(task.title, task.originalText);
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

  const toggleCompletedTaskSelection = (taskId: string) => {
    setSelectedCompletedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const clearCompletedSelection = () => {
    setSelectedCompletedTaskIds(new Set());
    setIsSelectingCompleted(false);
    setShowCompletedMenu(false);
  };

  const selectAllCompletedTasks = () => {
    setSelectedCompletedTaskIds(new Set(completedTasks.map(task => task.id)));
    setIsSelectingCompleted(true);
    setShowCompletedMenu(false);
  };

  const deleteSelectedCompletedTasks = () => {
    selectedCompletedTaskIds.forEach(taskId => deleteTask(taskId));
    clearCompletedSelection();
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
      {pendingTasks.length > 0 || completedTasks.length > 0 ? (
        <>
          {groupedPendingTasks.length > 0 && (
            <View style={styles.taskList}>
              {groupedPendingTasks.map((group, groupIndex) => (
                <View key={group.key}>
                  <View style={[styles.groupHeader, groupIndex > 0 && styles.groupHeaderWithBorder]}>
                    <Text style={styles.groupHeaderText}>{group.label}</Text>
                  </View>

                  {group.tasks.map((task, index) => {
                    const subtasks = subtasksByTask[task.id];
                    const checked = checkedByTask[task.id] || new Set();
                    const isLoading = loadingTaskId === task.id;
                    const hasSubtasks = !!subtasks;
                    const taskMeta = [
                      task.scheduledTime,
                      formatDuration(task.estimatedMinutes),
                    ].filter(Boolean).join(' · ');

                    return (
                      <View key={task.id}>
                        <View style={styles.taskRow}>
                          <TouchableOpacity
                            style={styles.checkbox}
                            onPress={() => completeTask(task.id)}
                          >
                            <Ionicons name="ellipse-outline" size={24} color={colors.border} />
                          </TouchableOpacity>

                          <View style={styles.taskInfo}>
                            <Text style={styles.taskTitle}>{task.title}</Text>
                            <Text style={styles.taskSubtitle}>{taskMeta}</Text>
                          </View>

                          <TouchableOpacity
                            style={styles.breakdownBtn}
                            onPress={() => handleBreakdown(task)}
                            disabled={isLoading || hasSubtasks}
                          >
                            {isLoading
                              ? <ActivityIndicator size="small" color={colors.textSecondary} />
                              : <Ionicons
                                  name={task.subtasks?.length ? 'list-outline' : 'flash-outline'}
                                  size={18}
                                  color={hasSubtasks ? colors.border : colors.textSecondary}
                                />
                            }
                          </TouchableOpacity>
                        </View>

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

                        {index < group.tasks.length - 1 && <View style={styles.separator} />}
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          )}

          {groupedCompletedTasks.length > 0 && (
            <View style={styles.completedTaskList}>
              <View style={[styles.groupHeader, styles.completedHeaderContainer]}>
                <View style={styles.completedHeaderRow}>
                  <Text style={styles.groupHeaderText}>完了済み</Text>
                  <View style={styles.completedHeaderActions}>
                    {isSelectingCompleted && (
                      <TouchableOpacity onPress={clearCompletedSelection} style={styles.completedHeaderActionButton}>
                        <Text style={styles.completedHeaderButtonText}>完了</Text>
                      </TouchableOpacity>
                    )}
                    {selectedCompletedTaskIds.size > 0 && (
                      <TouchableOpacity onPress={deleteSelectedCompletedTasks} style={styles.completedHeaderDeleteButton}>
                        <Text style={[styles.completedHeaderButtonText, styles.deleteButtonText]}>
                          削除 ({selectedCompletedTaskIds.size})
                        </Text>
                      </TouchableOpacity>
                    )}
                    {!isSelectingCompleted && (
                      <TouchableOpacity
                        onPress={() => setShowCompletedMenu(prev => !prev)}
                        style={styles.completedMenuTrigger}
                      >
                        <Ionicons name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                {showCompletedMenu && !isSelectingCompleted && (
                  <View style={styles.completedMenu}>
                    <TouchableOpacity
                      onPress={() => {
                        setIsSelectingCompleted(true);
                        setShowCompletedMenu(false);
                      }}
                      style={styles.completedMenuItem}
                    >
                      <Text style={styles.completedHeaderButtonText}>選択</Text>
                    </TouchableOpacity>

                    <TouchableOpacity onPress={selectAllCompletedTasks} style={styles.completedMenuItem}>
                      <Text style={styles.completedHeaderButtonText}>すべて選択</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {groupedCompletedTasks.map((group) => (
                <View key={`completed-${group.key}`}>
                  <View style={styles.completedDateHeader}>
                    <Text style={styles.completedDateHeaderText}>{group.label}</Text>
                  </View>

                  {group.tasks.map((task, index) => {
                    const taskMeta = [
                      task.scheduledTime,
                      formatDuration(task.estimatedMinutes),
                    ].filter(Boolean).join(' · ');

                    return (
                      <View key={task.id}>
                        <View style={styles.taskRow}>
                          {isSelectingCompleted ? (
                            <TouchableOpacity
                              style={styles.checkbox}
                              onPress={() => toggleCompletedTaskSelection(task.id)}
                            >
                              <Ionicons
                                name={selectedCompletedTaskIds.has(task.id) ? 'checkmark-circle' : 'ellipse-outline'}
                                size={24}
                                color={colors.textSecondary}
                              />
                            </TouchableOpacity>
                          ) : (
                            <TouchableOpacity
                              style={styles.checkbox}
                              onPress={() => updateTask(task.id, { status: 'todo' })}
                            >
                              <Ionicons name="checkmark-circle" size={24} color={colors.textSecondary} />
                            </TouchableOpacity>
                          )}

                          {isSelectingCompleted ? (
                            <TouchableOpacity
                              style={styles.taskInfo}
                              onPress={() => toggleCompletedTaskSelection(task.id)}
                              activeOpacity={0.7}
                            >
                              <Text style={[styles.taskTitle, styles.taskTitleDone]}>{task.title}</Text>
                              <Text style={[styles.taskSubtitle, styles.taskSubtitleDone]}>{taskMeta}</Text>
                            </TouchableOpacity>
                          ) : (
                            <View style={styles.taskInfo}>
                              <Text style={[styles.taskTitle, styles.taskTitleDone]}>{task.title}</Text>
                              <Text style={[styles.taskSubtitle, styles.taskSubtitleDone]}>{taskMeta}</Text>
                            </View>
                          )}
                        </View>

                        {index < group.tasks.length - 1 && <View style={styles.separator} />}
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          )}
        </>
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
  completedTaskList: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: 'hidden',
  },
  groupHeader: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    backgroundColor: colors.surface,
  },
  completedHeaderContainer: {
    position: 'relative',
    overflow: 'visible',
  },
  groupHeaderWithBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  groupHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  completedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  completedHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  completedHeaderActionButton: {
    paddingVertical: 2,
  },
  completedHeaderDeleteButton: {
    paddingVertical: 2,
  },
  completedMenuTrigger: {
    width: 28,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completedMenu: {
    position: 'absolute',
    top: 36,
    right: 16,
    minWidth: 132,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
    zIndex: 20,
  },
  completedMenuItem: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  completedHeaderButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  deleteButtonText: {
    color: '#B45309',
  },
  completedDateHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  completedDateHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
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
  taskTitleDone: { color: colors.textSecondary, textDecorationLine: 'line-through' },
  taskSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  taskSubtitleDone: { textDecorationLine: 'line-through' },

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
