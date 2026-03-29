import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { useAppContext } from '../context/AppContext';
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

const getNextPayday = (paydayDate: number): string => {
  const now = new Date();
  let target = new Date(now.getFullYear(), now.getMonth(), paydayDate);
  if (target <= now) target = new Date(now.getFullYear(), now.getMonth() + 1, paydayDate);
  return `${target.getMonth() + 1}月${target.getDate()}日`;
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function BudgetScreen() {
  const {
    financialAssets, budgetTransactions, paydayDate,
  } = useAppContext();

  const navigation = useNavigation<any>();
  const [showSetupPrompt, setShowSetupPrompt] = useState(true);
  const [exchangeRate, setExchangeRate] = useState(150);
  const [rateLoaded, setRateLoaded] = useState(false);

  // Header setup - 未設定時のみ「設定」ボタンを出す
  useEffect(() => {
    if (!financialAssets.setupDone) {
      navigation.setOptions({
        headerRight: () => (
          <TouchableOpacity
            style={{ 
              backgroundColor: colors.text, paddingHorizontal: 12, paddingVertical: 6, 
              borderRadius: 14, marginRight: 8, flexDirection: 'row', alignItems: 'center', gap: 4
            }}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              navigation.navigate('AIに話す', { initialMessage: '家計簿の設定をしたいです' });
            }}
          >
            <Ionicons name="sparkles" size={14} color={colors.background} />
            <Text style={{ color: colors.background, fontSize: 12, fontWeight: '700' }}>設定</Text>
          </TouchableOpacity>
        ),
      });
    } else {
      navigation.setOptions({ headerRight: null });
    }
  }, [financialAssets.setupDone]);

  // Init exchange rate on mount
  useEffect(() => {
    fetchExchangeRate()
      .then(r => { setExchangeRate(r); setRateLoaded(true); })
      .catch(() => setRateLoaded(true));
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Dashboard - 設定完了時のみ表示 */}
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
              <Text style={styles.chipValue}>${(financialAssets.usdAmount ?? 0).toFixed(0)}</Text>
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
                <Text style={styles.chipValue}>{(exchangeRate ?? 150).toFixed(1)}</Text>
              </View>
            )}
          </View>

          {/* USD ratio bar */}
          <View style={styles.usdSection}>
            <View style={styles.usdLabelRow}>
              <Text style={styles.usdLabel}>USD比率 {(usdRatio ?? 0).toFixed(1)}%</Text>
              <Text style={styles.usdTarget}>目標 30%</Text>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${Math.min((usdRatio / 30) * 100, 100)}%` }]} />
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

      {/* Setup Prompt - 未設定かつ非表示にされていない場合 */}
      {!financialAssets.setupDone && showSetupPrompt && (
        <View style={styles.setupContainer}>
          <View style={styles.setupCard}>
            <View style={styles.setupIconBg}>
              <Ionicons name="wallet-outline" size={32} color={colors.text} />
            </View>
            <Text style={styles.setupTitle}>資産の見える化を始めましょう</Text>
            <Text style={styles.setupDesc}>
              今の現金や固定費をAIに伝えるだけで、将来にわたる実質的な防衛資金を自動で算出します。
            </Text>
            <TouchableOpacity
              style={styles.setupPrimaryBtn}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                navigation.navigate('AIに話す', { initialMessage: '家計簿の設定をしたいです' });
              }}
            >
              <Text style={styles.setupPrimaryText}>AIで設定を開始</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.background} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.setupSecondaryBtn}
              onPress={() => setShowSetupPrompt(false)}
            >
              <Text style={styles.setupSecondaryText}>今はしない</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  // Dashboard
  dashboard: {
    backgroundColor: colors.background,
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 24,
  },
  defenseCard: { marginBottom: 24, paddingHorizontal: 4 },
  defenseLabel: { 
    fontSize: 11, 
    fontWeight: '700', 
    color: colors.textSecondary, 
    letterSpacing: 1.5, 
    textTransform: 'uppercase' 
  },
  defenseAmount: { 
    fontSize: 40, 
    fontWeight: '800', 
    color: colors.text, 
    letterSpacing: -1.5, 
    marginTop: 6 
  },
  totalSub: { fontSize: 13, color: colors.textSecondary, marginTop: 6, fontWeight: '500' },

  chipsRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  chip: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 20,
    padding: 14, borderWidth: 1, borderColor: 'rgba(0,0,0,0.02)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04, shadowRadius: 10, elevation: 2,
  },
  chipLabel: { fontSize: 10, color: colors.textSecondary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  chipValue: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 4 },
  chipSub: { fontSize: 10, color: colors.textSecondary },

  usdSection: { marginBottom: 4 },
  usdLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  usdLabel: { fontSize: 12, color: colors.text, fontWeight: '600' },
  usdTarget: { fontSize: 11, color: colors.textSecondary, fontWeight: '500' },
  barTrack: {
    height: 8, backgroundColor: colors.borderSubtle, borderRadius: 4,
    overflow: 'hidden', position: 'relative', marginBottom: 8,
  },
  barFill: { height: 8, backgroundColor: colors.text, borderRadius: 4 },
  barMarker: {
    position: 'absolute', left: '100%', top: -2,
    width: 2, height: 12, backgroundColor: colors.textSecondary,
  },
  usdHint: { fontSize: 11, color: colors.textSecondary, fontWeight: '500' },

  // Setup UI
  setupContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  setupCard: {
    backgroundColor: colors.surface,
    padding: 32,
    borderRadius: 32,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.08,
    shadowRadius: 40,
    elevation: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  setupIconBg: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.borderSubtle,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 24,
  },
  setupTitle: { 
    ...typography.h3, 
    fontSize: 20, 
    fontWeight: '800', 
    color: colors.text, 
    textAlign: 'center', 
    marginBottom: 14 
  },
  setupDesc: { 
    ...typography.body, 
    fontSize: 14, 
    color: colors.textSecondary, 
    textAlign: 'center', 
    lineHeight: 22,
    marginBottom: 32,
    paddingHorizontal: 8,
  },
  setupPrimaryBtn: {
    flexDirection: 'row',
    backgroundColor: colors.text,
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 24,
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
    width: '100%',
    justifyContent: 'center',
  },
  setupPrimaryText: { color: colors.background, fontSize: 16, fontWeight: '700' },
  setupSecondaryBtn: { padding: 10 },
  setupSecondaryText: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
});
