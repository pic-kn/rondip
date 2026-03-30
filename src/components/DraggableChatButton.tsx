import React from 'react';
import { StyleSheet, Dimensions, Platform } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import * as Haptics from 'expo-haptics';
import { navigationRef } from '../services/navigation';
import { useAppContext } from '../context/AppContext';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BUTTON_SIZE = 48;
const MARGIN = 16;
// 初期位置（右下に配置）
const INITIAL_X = SCREEN_WIDTH - BUTTON_SIZE - MARGIN;
const INITIAL_Y = SCREEN_HEIGHT - BUTTON_SIZE - 100;

export default function DraggableChatButton() {
  const { createNewSession } = useAppContext();
  const translateX = useSharedValue(INITIAL_X);
  const translateY = useSharedValue(INITIAL_Y);
  const context = useSharedValue({ x: 0, y: 0 });

  // 1. JSスレッドで実行する関数を一箇所にまとめる（クラッシュ防止）
  const handlePress = () => {
    // 新規セッションを作成
    createNewSession();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (navigationRef.isReady()) {
      // 即座にAIチャット画面へ遷移
      navigationRef.navigate('AIに話す' as never);
    }
  };

  const panGesture = Gesture.Pan()
    .onStart(() => {
      context.value = { x: translateX.value, y: translateY.value };
    })
    .onUpdate((event) => {
      translateX.value = event.translationX + context.value.x;
      translateY.value = event.translationY + context.value.y;
    })
    .onEnd(() => {
      // 左右端への吸着
      const snapLeft = MARGIN;
      const snapRight = SCREEN_WIDTH - BUTTON_SIZE - MARGIN;
      
      if (translateX.value + BUTTON_SIZE / 2 < SCREEN_WIDTH / 2) {
        translateX.value = withSpring(snapLeft);
      } else {
        translateX.value = withSpring(snapRight);
      }

      // 上下越境防止
      const minY = 60;
      const maxY = SCREEN_HEIGHT - BUTTON_SIZE - 100;
      
      if (translateY.value < minY) {
        translateY.value = withSpring(minY);
      } else if (translateY.value > maxY) {
        translateY.value = withSpring(maxY);
      }
    });

  const tapGesture = Gesture.Tap()
    .onEnd(() => {
      // UIスレッドからJS関数を安全に呼び出す
      runOnJS(handlePress)();
    });

  // 2. 止まっているスタイル（Shadow, borderRadius等）はAnimatedStyleの外に出す
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  return (
    <GestureDetector gesture={Gesture.Exclusive(panGesture, tapGesture)}>
      <Animated.View style={[styles.staticButton, animatedStyle]}>
        <Ionicons name="add" size={20} color={colors.surface} />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  staticButton: {
    position: 'absolute',
    top: 0, left: 0, 
    zIndex: 9999,
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    backgroundColor: colors.text,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.14,
        shadowRadius: 18,
      },
      android: {
        elevation: 6,
      },
    }),
  },
});
