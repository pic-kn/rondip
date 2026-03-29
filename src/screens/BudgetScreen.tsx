import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView,
  TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator,
  Modal, Animated, FlatList,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useAppContext } from '../context/AppContext';
import { processBudgetText } from '../services/gemini';
import { Ionicons } from '@expo/vector-icons';

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) => `¥${Math.round(n).toLocaleString()}`;
const fmtShort = (n: number) =>
  n >= 100000000 ? `${(n / 100000000).toFixed(1)}億` :
  n >= 10000 ? `${(n / 10000).toFixed(1)}万` :
  `${Math.round(n).toLocaleString()}`;

const fetchExchangeRate = async (): Promise<number> => {
  const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=JPY');
  const data = await res.json();
  return data.rates.JPY as number;
};

const extractJpy = (text: string): number | null => {
  if (/スキップ|skip/i.test(text)) return null;
  if (/なし|０円|ゼロ|持っていない|ない/i.test(text)) return 0;
  const man = text.match(/([0-9,.]+)\s*万/);
  if (man) return Math.round(parseFloat(man[1].replace(/,/g, '')) * 10000);
  const num = text.match(/([0-9,]+)/);
  if (num) return parseInt(num[1].replace(/,/g, ''));
  return null;
};

const extractUsd = (text: string): number | null => {
  if (/スキップ|skip|なし|ない/i.test(text)) return null;
  const m = text.match(/([0-9,]+)\s*(?:ドル|USD)/i) || text.match(/\$\s*([0-9,]+)/);
  if (m) return parseInt(m[1].replace(/,/g, ''));
  const num = text.match(/([0-9,]+)/);
  if (num) return parseInt(num[1].replace(/,/g, ''));
  return null;
};

const extractDevice = (text: string): { name: string; resaleValue: number } | null => {
  if (/スキップ|skip|なし|ない/i.test(text)) return null;
  const man = text.match(/^(.+?)\s+([0-9,.]+)\s*万/);
  if (man) return { name: man[1].trim(), resaleValue: Math.round(parseFloat(man[2].replace(/,/g, '')) * 10000) };
  const yen = text.match(/^(.+?)\s+([0-9,]+)\s*円?/);
  if (yen) return { name: yen[1].trim(), resaleValue: parseInt(yen[2].replace(/,/g, '')) };
  return null;
};

const getNextPayday = (paydayDate: number): string => {
  const now = new Date();
  let target = new Date(now.getFullYear(), now.getMonth(), paydayDate);
  if (target <= now) target = new Date(now.getFullYear(), now.getMonth() + 1, paydayDate);
  return `${target.getMonth() + 1}月${target.getDate()}日`;
};

// ── Setup questions ───────────────────────────────────────────────────────────
const SETUP_STEPS = [
  '家計管理を始めましょう。いくつか質問します。スキップはいつでもOKです。',
  '今の円の貯金・現金はいくらですか？',
  'USDはお持ちですか？何ドル？（例: 500ドル）',
  '毎月の固定費（家賃・サブスクなど）の合計は？',
  'カメラなど売れる機材はありますか？（例: カメラ 8万）',
];

type ChatMsg = { role: 'ai' | 'user'; text: string };

type PendingAction = {
  type: 'expense' | 'usd_buy' | 'future_lock' | 'income' | 'device_add' | 'correction';
  label: string;
  data: any;
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function BudgetScreen() {
  const {
    financialAssets, updateFinancialAssets,
    budgetTransactions, addBudgetTransaction, removeBudgetTransaction,
    paydayDate,
    budgetSessions, currentBudgetSessionId, budgetMessages, addBudgetMessage,
    createNewBudgetSession, switchBudgetSession, deleteBudgetSession,
  } = useAppContext();

  const navigation = useNavigation<any>();
  const [setupStep, setSetupStep] = useState(0);
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

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', marginRight: 8, gap: 4 }}>
          <TouchableOpacity onPress={openSessionModal} style={{ padding: 8 }}>
            <Ionicons name="time-outline" size={22} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={createNewBudgetSession} style={{ padding: 8 }}>
            <Ionicons name="create-outline" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [createNewBudgetSession]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [exchangeRate, setExchangeRate] = useState(150);
  const [rateLoaded, setRateLoaded] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Init setup or main state on mount
  useEffect(() => {
    fetchExchangeRate()
      .then(r => { setExchangeRate(r); setRateLoaded(true); })
      .catch(() => setRateLoaded(true));

    if (!financialAssets.setupDone) {
      addAiMsg(SETUP_STEPS[0]);
      addAiMsg(SETUP_STEPS[1]);
      setSetupStep(1);
    }
  }, []);

  // ── Computed ──────────────────────────────────────────────────────────────
  const usdInJpy = financialAssets.usdAmount * exchangeRate;
  const deviceTotal = financialAssets.deviceAssets.reduce((s, d) => s + d.resaleValue, 0);
  const totalAssets = financialAssets.jpyCash + usdInJpy + deviceTotal;
  const locked =
    financialAssets.creditCardPending +
    financialAssets.monthlyFixedCosts +
    financialAssets.futureExpenses.reduce((s, f) => s + f.amount, 0);
  const realDefense = totalAssets - locked;
  const usdRatio = totalAssets > 0 ? (usdInJpy / totalAssets) * 100 : 0;
  const usdNeeded = Math.max(0, totalAssets * 0.3 - usdInJpy);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const addAiMsg = (t: string) => {
    addBudgetMessage({ role: 'ai', text: t });
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const addUserMsg = (t: string) => {
    addBudgetMessage({ role: 'user', text: t });
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  // ── Setup flow ────────────────────────────────────────────────────────────
  const handleSetupInput = (input: string) => {
    addUserMsg(input);
    if (setupStep === 1) {
      const v = extractJpy(input);
      if (v !== null) updateFinancialAssets({ jpyCash: v });
      addAiMsg(SETUP_STEPS[2]);
      setSetupStep(2);
    } else if (setupStep === 2) {
      const v = extractUsd(input);
      if (v !== null) updateFinancialAssets({ usdAmount: v });
      addAiMsg(SETUP_STEPS[3]);
      setSetupStep(3);
    } else if (setupStep === 3) {
      const v = extractJpy(input);
      if (v !== null) updateFinancialAssets({ monthlyFixedCosts: v });
      addAiMsg(SETUP_STEPS[4]);
      setSetupStep(4);
    } else if (setupStep === 4) {
      const device = extractDevice(input);
      if (device) {
        updateFinancialAssets({
          deviceAssets: [...financialAssets.deviceAssets, { id: `d-${Date.now()}`, ...device }],
        });
      }
      updateFinancialAssets({ setupDone: true });
      setSetupStep(5);
      addAiMsg('準備完了です！支出・ドル転・将来の出費などをチャットで教えてください。');
    }
  };

  // ── Main chat ─────────────────────────────────────────────────────────────
  const handleMainInput = async (input: string) => {
    addUserMsg(input);
    setLoading(true);
    try {
      const result = await processBudgetText(input, {
        financialAssets,
        exchangeRate,
        recentTxs: budgetTransactions.slice(0, 5),
      });
      if (result.type === 'general') {
        addAiMsg(result.responseMessage);
      } else {
        setPending({ type: result.type as any, label: result.confirmLabel, data: result.data });
        addAiMsg(result.responseMessage);
      }
    } catch {
      addAiMsg('すみません、エラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  // ── Confirm ───────────────────────────────────────────────────────────────
  const confirmAction = () => {
    if (!pending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const { type, data } = pending;
    const now = new Date().toISOString().split('T')[0];

    if (type === 'expense') {
      updateFinancialAssets({ jpyCash: Math.max(0, financialAssets.jpyCash - data.amount) });
      addBudgetTransaction({ id: `tx-${Date.now()}`, type: 'expense', description: data.description, amount: data.amount, date: now });
    } else if (type === 'usd_buy') {
      const usdBought = data.jpyAmount / exchangeRate;
      updateFinancialAssets({
        jpyCash: Math.max(0, financialAssets.jpyCash - data.jpyAmount),
        usdAmount: financialAssets.usdAmount + usdBought,
      });
      addBudgetTransaction({ id: `tx-${Date.now()}`, type: 'usd_buy', description: 'ドル転', amount: data.jpyAmount, usdAmount: usdBought, date: now });
    } else if (type === 'future_lock') {
      updateFinancialAssets({
        futureExpenses: [...financialAssets.futureExpenses, {
          id: `fe-${Date.now()}`, description: data.description, amount: data.amount, dueMonth: data.dueMonth || '',
        }],
      });
      addBudgetTransaction({ id: `tx-${Date.now()}`, type: 'future_lock', description: data.description, amount: data.amount, date: now });
    } else if (type === 'income') {
      updateFinancialAssets({ jpyCash: financialAssets.jpyCash + data.amount });
      addBudgetTransaction({ id: `tx-${Date.now()}`, type: 'income', description: data.description || '収入', amount: data.amount, date: now });
    } else if (type === 'device_add') {
      updateFinancialAssets({
        deviceAssets: [...financialAssets.deviceAssets, { id: `d-${Date.now()}`, name: data.name, resaleValue: data.resaleValue }],
      });
    } else if (type === 'correction') {
      const last = budgetTransactions.find(t => t.type === 'expense');
      if (last) {
        const diff = data.newAmount - last.amount;
        updateFinancialAssets({ jpyCash: financialAssets.jpyCash - diff });
        removeBudgetTransaction(last.id);
        addBudgetTransaction({ ...last, id: `tx-${Date.now()}`, amount: data.newAmount });
      }
    }

    addAiMsg('確定しました。');
    setPending(null);
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = () => {
    const input = text.trim();
    if (!input) return;
    setText('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!financialAssets.setupDone && setupStep < 5) {
      handleSetupInput(input);
    } else {
      handleMainInput(input);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.container}>

        {/* Dashboard */}
        {financialAssets.setupDone && (
          <View style={styles.dashboard}>
            {/* 実質防衛資金 */}
            <View style={styles.defenseCard}>
              <Text style={styles.defenseLabel}>実質防衛資金</Text>
              <Text style={[styles.defenseAmount, realDefense < 0 && { color: '#ef4444' }]}>
                {fmt(realDefense)}
              </Text>
              <Text style={styles.totalSub}>総資産 {fmt(totalAssets)}</Text>
            </View>

            {/* Asset chips */}
            <View style={styles.chipsRow}>
              <View style={styles.chip}>
                <Text style={styles.chipLabel}>円</Text>
                <Text style={styles.chipValue}>{fmtShort(financialAssets.jpyCash)}</Text>
              </View>
              <View style={styles.chip}>
                <Text style={styles.chipLabel}>USD</Text>
                <Text style={styles.chipValue}>${financialAssets.usdAmount.toFixed(0)}</Text>
                <Text style={styles.chipSub}>{fmtShort(usdInJpy)}</Text>
              </View>
              {deviceTotal > 0 && (
                <View style={styles.chip}>
                  <Text style={styles.chipLabel}>資産</Text>
                  <Text style={styles.chipValue}>{fmtShort(deviceTotal)}</Text>
                </View>
              )}
              {rateLoaded && (
                <View style={styles.chip}>
                  <Text style={styles.chipLabel}>USD/JPY</Text>
                  <Text style={styles.chipValue}>{exchangeRate.toFixed(1)}</Text>
                </View>
              )}
            </View>

            {/* USD ratio bar */}
            <View style={styles.usdSection}>
              <View style={styles.usdLabelRow}>
                <Text style={styles.usdLabel}>USD比率 {usdRatio.toFixed(1)}%</Text>
                <Text style={styles.usdTarget}>目標 30%</Text>
              </View>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${Math.min((usdRatio / 30) * 100, 100)}%` as any }]} />
                <View style={styles.barMarker} />
              </View>
              {usdNeeded > 0 ? (
                <Text style={styles.usdHint}>
                  あと ${Math.round(usdNeeded / exchangeRate).toLocaleString()} で目標達成 · 次の給料日 {getNextPayday(paydayDate)}
                </Text>
              ) : (
                <Text style={[styles.usdHint, { color: colors.text }]}>目標達成</Text>
              )}
            </View>
          </View>
        )}

        {/* Chat area */}
        <ScrollView
          ref={scrollRef}
          style={styles.chatArea}
          contentContainerStyle={styles.chatContent}
          showsVerticalScrollIndicator={false}
        >
          {budgetMessages.map((msg, i) => {
            const msgDate = msg.date ? new Date(msg.date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) : null;
            const prevDate = i > 0 && budgetMessages[i - 1].date
              ? new Date(budgetMessages[i - 1].date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
              : null;
            const showDate = msgDate && msgDate !== prevDate;
            return (
              <React.Fragment key={i}>
                {showDate && (
                  <View style={styles.dateDivider}>
                    <Text style={styles.dateDividerText}>{msgDate}</Text>
                  </View>
                )}
                <View style={[styles.msgRow, msg.role === 'user' && styles.msgRowUser]}>
                  <View style={[styles.bubble, msg.role === 'user' ? styles.bubbleUser : styles.bubbleAi]}>
                    <Text style={[styles.bubbleText, msg.role === 'user' && styles.bubbleTextUser]}>
                      {msg.text}
                    </Text>
                  </View>
                </View>
              </React.Fragment>
            );
          })}
          {loading && (
            <View style={styles.msgRow}>
              <View style={[styles.bubble, styles.bubbleAi]}>
                <ActivityIndicator size="small" color={colors.textSecondary} />
              </View>
            </View>
          )}
          {/* Pending action card */}
          {pending && (
            <View style={styles.pendingCard}>
              <Text style={styles.pendingLabel}>{pending.label}</Text>
              <TouchableOpacity style={styles.confirmBtn} onPress={confirmAction}>
                <Text style={styles.confirmBtnText}>それ！</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>

        {/* Session modal */}
        <Modal visible={sessionModalVisible} transparent animationType="none">
          <Animated.View style={[styles.sessionOverlay, { opacity: sessionOverlayAnim }]}>
            <TouchableOpacity style={{ flex: 1 }} onPress={closeSessionModal} />
          </Animated.View>
          <Animated.View style={[styles.sessionPanel, { transform: [{ translateY: sessionSlideAnim }] }]}>
            <View style={styles.sessionHeader}>
              <Text style={styles.sessionHeaderTitle}>履歴</Text>
              <TouchableOpacity
                style={styles.newChatBtn}
                onPress={() => { createNewBudgetSession(); closeSessionModal(); }}
              >
                <Ionicons name="add" size={14} color={colors.background} />
                <Text style={styles.newChatBtnText}>新しい会話</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={budgetSessions}
              keyExtractor={s => s.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.sessionRow, item.id === currentBudgetSessionId && styles.sessionRowActive]}
                  onPress={() => { switchBudgetSession(item.id); closeSessionModal(); }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sessionTitle}>{item.title}</Text>
                    <Text style={styles.sessionDate}>
                      {new Date(item.createdAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
                    </Text>
                  </View>
                  {budgetSessions.length > 1 && (
                    <TouchableOpacity onPress={() => deleteBudgetSession(item.id)} style={{ padding: 8 }}>
                      <Ionicons name="trash-outline" size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              )}
            />
          </Animated.View>
        </Modal>

        {/* Input bar */}
        <View style={styles.bottomBar}>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.textInput}
              placeholder="スタバ 700円 / 3万円ドル転 / 車検 15万 4月"
              placeholderTextColor={colors.border}
              value={text}
              onChangeText={setText}
              onSubmitEditing={handleSubmit}
              returnKeyType="send"
            />
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: text.trim() ? colors.text : colors.border }]}
              onPress={handleSubmit}
              disabled={!text.trim() || loading}
            >
              <Ionicons name="arrow-up" size={16} color={colors.background} />
            </TouchableOpacity>
          </View>
        </View>

      </View>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  topBar: {
    flexDirection: 'row', justifyContent: 'flex-end',
    paddingHorizontal: 16, paddingTop: 8, gap: 4,
  },
  topBarBtn: { padding: 8 },

  // Session modal
  sessionOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  sessionPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    maxHeight: '60%',
    paddingBottom: 32,
  },
  sessionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle,
  },
  sessionHeaderTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  newChatBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.text, paddingHorizontal: 12,
    paddingVertical: 7, borderRadius: 8, gap: 4,
  },
  newChatBtnText: { fontSize: 13, fontWeight: '600', color: colors.background },
  sessionRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle,
  },
  sessionRowActive: { backgroundColor: colors.borderSubtle },
  sessionTitle: { fontSize: 14, fontWeight: '500', color: colors.text },
  sessionDate: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },

  // Dashboard
  dashboard: {
    backgroundColor: colors.background,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  defenseCard: { marginBottom: 12 },
  defenseLabel: { fontSize: 11, fontWeight: '600', color: colors.textSecondary, letterSpacing: 0.5, textTransform: 'uppercase' },
  defenseAmount: { fontSize: 32, fontWeight: '700', color: colors.text, letterSpacing: -1, marginTop: 2 },
  totalSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  chipsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  chip: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 8,
    padding: 8, borderWidth: 1, borderColor: colors.borderSubtle,
  },
  chipLabel: { fontSize: 10, color: colors.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  chipValue: { fontSize: 14, fontWeight: '600', color: colors.text, marginTop: 2 },
  chipSub: { fontSize: 10, color: colors.textSecondary },

  usdSection: { marginBottom: 4 },
  usdLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  usdLabel: { fontSize: 12, color: colors.text, fontWeight: '500' },
  usdTarget: { fontSize: 12, color: colors.textSecondary },
  barTrack: {
    height: 6, backgroundColor: colors.borderSubtle, borderRadius: 3,
    overflow: 'visible', position: 'relative', marginBottom: 6,
  },
  barFill: { height: 6, backgroundColor: colors.text, borderRadius: 3 },
  barMarker: {
    position: 'absolute', left: '100%', top: -3,
    width: 1, height: 12, backgroundColor: colors.textSecondary,
  },
  usdHint: { fontSize: 11, color: colors.textSecondary },

  // Chat
  chatArea: { flex: 1 },
  chatContent: { padding: 16, gap: 8 },
  msgRow: { flexDirection: 'row' },
  msgRowUser: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '80%', padding: 12, borderRadius: 12 },
  bubbleAi: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSubtle, borderBottomLeftRadius: 3 },
  bubbleUser: { backgroundColor: colors.text, borderBottomRightRadius: 3 },
  bubbleText: { fontSize: 15, color: colors.text, lineHeight: 22 },
  bubbleTextUser: { color: colors.background },
  dateDivider: { alignItems: 'center', marginVertical: 8 },
  dateDividerText: { fontSize: 11, color: colors.textSecondary, backgroundColor: colors.borderSubtle, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 },

  // Pending
  pendingCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: 10,
    padding: 14, marginTop: 8,
    borderWidth: 1, borderColor: colors.border,
  },
  pendingLabel: { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1 },
  confirmBtn: {
    backgroundColor: colors.text, borderRadius: 8,
    paddingHorizontal: 16, paddingVertical: 8, marginLeft: 12,
  },
  confirmBtnText: { fontSize: 14, fontWeight: '600', color: colors.background },

  // Input
  bottomBar: {
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: colors.background,
    borderTopWidth: 1, borderTopColor: colors.borderSubtle,
  },
  inputContainer: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderWidth: 1,
    borderColor: colors.border, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  textInput: {
    flex: 1, fontSize: 15, color: colors.text,
    maxHeight: 120, lineHeight: 22, paddingVertical: 0,
  },
  submitBtn: {
    width: 26, height: 26, borderRadius: 6,
    justifyContent: 'center', alignItems: 'center',
    marginLeft: 8, flexShrink: 0,
  },
});
