import React, { useState, useEffect } from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { NavigationContainer, DrawerActions, useNavigation } from '@react-navigation/native';
import { createDrawerNavigator, DrawerContentScrollView, DrawerItemList } from '@react-navigation/drawer';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { requestNotificationPermission } from './src/services/notifications';
import TravelCheckModal from './src/components/TravelCheckModal';
import { colors } from './src/theme/colors';
import { AppProvider } from './src/context/AppContext';

import HomeScreen from './src/screens/HomeScreen';
import BrainDumpScreen from './src/screens/BrainDumpScreen';
import BudgetScreen from './src/screens/BudgetScreen';
import TaskExecutionScreen from './src/screens/TaskExecutionScreen';
import CalendarScreen from './src/screens/CalendarScreen';
import ShiftScreen from './src/screens/ShiftScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';

const Drawer = createDrawerNavigator();

function TwoLineIcon() {
  return (
    <View style={{ gap: 5 }}>
      <View style={{ width: 22, height: 1.5, backgroundColor: colors.text }} />
      <View style={{ width: 14, height: 1.5, backgroundColor: colors.text }} />
    </View>
  );
}

function HamburgerButton() {
  const navigation = useNavigation<any>();
  return (
    <TouchableOpacity
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        navigation.dispatch(DrawerActions.toggleDrawer());
      }}
      style={{ paddingHorizontal: 16, paddingVertical: 8 }}
    >
      <TwoLineIcon />
    </TouchableOpacity>
  );
}

import DraggableChatButton from './src/components/DraggableChatButton';

const screenIcon: Record<string, keyof typeof Ionicons.glyphMap> = {
  'AIに話す':     'chatbubble-ellipses-outline',
  '設定':         'settings-outline',
  'タスク':       'checkmark-circle-outline',
  'カレンダー':   'calendar-outline',
  '家計簿':       'wallet-outline',
  'シフト':       'time-outline',
};

import { navigationRef } from './src/services/navigation';

export default function App() {
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [travelCheck, setTravelCheck] = useState<{
    destination: string; eventTitle: string; eventTime: string;
  } | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('hasCompletedOnboarding').then(val => {
      setOnboardingDone(val === 'true');
    });
    requestNotificationPermission();

    // 通知タップ検知
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as any;
      if (data?.type === 'pre_departure') {
        setTravelCheck({
          destination: data.destination,
          eventTitle: data.eventTitle,
          eventTime: data.eventTime,
        });
      }
    });
    return () => sub.remove();
  }, []);

  if (onboardingDone === null) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <AppProvider>
    {travelCheck && (
      <TravelCheckModal
        visible={!!travelCheck}
        destination={travelCheck.destination}
        eventTitle={travelCheck.eventTitle}
        eventTime={travelCheck.eventTime}
        onClose={() => setTravelCheck(null)}
      />
    )}
    {!onboardingDone ? (
      <OnboardingScreen onComplete={() => setOnboardingDone(true)} />
    ) : (
      <NavigationContainer ref={navigationRef}>
        <Drawer.Navigator
          initialRouteName="AIに話す"
          screenOptions={{
            drawerType: 'slide',
            overlayColor: 'rgba(0,0,0,0.2)',
            headerLeft: () => <HamburgerButton />,
            headerStyle: { backgroundColor: colors.background, shadowColor: 'transparent', shadowOpacity: 0, elevation: 0, borderBottomWidth: 0 },
            headerTitleStyle: { color: colors.text, fontWeight: '600' },
            drawerStyle: { backgroundColor: colors.surface, width: 300 },
            drawerActiveTintColor: colors.primary,
            drawerInactiveTintColor: colors.textSecondary,
            drawerLabelStyle: { fontSize: 15, fontWeight: '400' },
          }}
          drawerContent={(props) => (
            <DrawerContentScrollView {...props} contentContainerStyle={{ paddingTop: 40 }}>
              <DrawerItemList {...props} />
            </DrawerContentScrollView>
          )}
        >
          {Object.entries({
            'AIに話す':   BrainDumpScreen,
            'タスク':     TaskExecutionScreen,
            'カレンダー': CalendarScreen,
            '家計簿':     BudgetScreen,
            'シフト':     ShiftScreen,
            '設定':       HomeScreen,
          }).map(([name, Component]) => (
            <Drawer.Screen
              key={name}
              name={name}
              component={Component}
              options={{
                headerTitle: '',
                drawerIcon: ({ color }) => (
                  <Ionicons name={screenIcon[name]} size={18} color={color} />
                ),
              }}
            />
          ))}
        </Drawer.Navigator>
        <DraggableChatButton />
      </NavigationContainer>
    )}
    </AppProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  drawerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
    paddingHorizontal: 16,
    paddingBottom: 24,
    letterSpacing: 1,
  },
});
