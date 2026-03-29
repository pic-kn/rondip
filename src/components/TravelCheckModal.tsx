import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useLocation } from '../hooks/useLocation';
import { getTravelTimes } from '../services/maps';
import { getGoogleMapsUrl } from '../services/maps';

interface Props {
  visible: boolean;
  destination: string;
  eventTitle: string;
  eventTime: string;
  onClose: () => void;
}

export default function TravelCheckModal({ visible, destination, eventTitle, eventTime, onClose }: Props) {
  const { locationData } = useLocation();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    driving?: { minutes: number };
    walking?: { minutes: number };
  } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (visible && locationData.coords) {
      calculate();
    }
  }, [visible, locationData.coords]);

  const calculate = async () => {
    if (!locationData.coords) return;
    setLoading(true);
    setError(false);
    setResult(null);
    try {
      const times = await getTravelTimes(locationData.coords, destination);
      setResult(times);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const formatMinutes = (min: number) => {
    if (min >= 60) {
      const h = Math.floor(min / 60);
      const m = min % 60;
      return m > 0 ? `${h}時間${m}分` : `${h}時間`;
    }
    return `${min}分`;
  };

  const getDepartureAdvice = () => {
    if (!result) return null;
    const best = Math.min(result.driving?.minutes ?? 999, result.walking?.minutes ?? 999);
    if (best === 999) return null;

    const [h, m] = eventTime.split(':').map(Number);
    const eventMs = new Date().setHours(h, m, 0, 0);
    const departureMs = eventMs - (best + 5) * 60 * 1000;
    const now = Date.now();
    const diffMin = Math.round((departureMs - now) / 60000);

    if (diffMin <= 0) return { text: '今すぐ出発してください！', urgent: true };
    if (diffMin <= 10) return { text: `あと${diffMin}分で出発してください`, urgent: true };
    return { text: `あと${diffMin}分後に出発すれば間に合います`, urgent: false };
  };

  const advice = getDepartureAdvice();

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <Text style={styles.title}>{eventTitle}</Text>
          <Text style={styles.subtitle}>{eventTime} · {destination}</Text>

          {loading && (
            <View style={styles.center}>
              <ActivityIndicator color={colors.text} />
              <Text style={styles.loadingText}>現在地から計算中...</Text>
            </View>
          )}

          {error && (
            <View style={styles.center}>
              <Text style={styles.errorText}>移動時間を取得できませんでした</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={calculate}>
                <Text style={styles.retryText}>再試行</Text>
              </TouchableOpacity>
            </View>
          )}

          {result && !loading && (
            <View style={styles.resultContainer}>
              {advice && (
                <View style={[styles.adviceBanner, advice.urgent && styles.adviceBannerUrgent]}>
                  <Text style={[styles.adviceText, advice.urgent && styles.adviceTextUrgent]}>
                    {advice.text}
                  </Text>
                </View>
              )}

              <View style={styles.travelRow}>
                <Ionicons name="car-outline" size={20} color={colors.textSecondary} />
                <Text style={styles.travelLabel}>車</Text>
                <Text style={styles.travelTime}>
                  {result.driving ? formatMinutes(result.driving.minutes) : '—'}
                </Text>
              </View>
              <View style={styles.travelRow}>
                <Ionicons name="walk-outline" size={20} color={colors.textSecondary} />
                <Text style={styles.travelLabel}>徒歩</Text>
                <Text style={styles.travelTime}>
                  {result.walking ? formatMinutes(result.walking.minutes) : '—'}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.mapsBtn}
                onPress={() => Linking.openURL(getGoogleMapsUrl(null, destination))}
              >
                <Ionicons name="map-outline" size={16} color={colors.background} />
                <Text style={styles.mapsBtnText}>Google Maps で確認</Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>閉じる</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: colors.border, alignSelf: 'center', marginBottom: 20,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 4, marginBottom: 20 },

  center: { alignItems: 'center', paddingVertical: 24, gap: 12 },
  loadingText: { fontSize: 14, color: colors.textSecondary },
  errorText: { fontSize: 14, color: colors.textSecondary },
  retryBtn: { paddingVertical: 8, paddingHorizontal: 20, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  retryText: { fontSize: 14, color: colors.text },

  resultContainer: { gap: 12 },
  adviceBanner: {
    backgroundColor: colors.borderSubtle,
    borderRadius: 10, padding: 12,
  },
  adviceBannerUrgent: { backgroundColor: colors.ink },
  adviceText: { fontSize: 15, fontWeight: '600', color: colors.text, textAlign: 'center' },
  adviceTextUrgent: { color: colors.background },

  travelRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle,
  },
  travelLabel: { flex: 1, fontSize: 14, color: colors.textSecondary },
  travelTime: { fontSize: 16, fontWeight: '600', color: colors.text },

  mapsBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: colors.text, borderRadius: 12,
    paddingVertical: 12, marginTop: 4,
  },
  mapsBtnText: { fontSize: 14, fontWeight: '600', color: colors.background },

  closeBtn: { marginTop: 16, alignItems: 'center', paddingVertical: 12 },
  closeBtnText: { fontSize: 15, color: colors.textSecondary },
});
