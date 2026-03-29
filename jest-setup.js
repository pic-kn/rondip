import '@testing-library/jest-native/extend-expect';

process.env.EXPO_PUBLIC_AI_WORKER_URL = 'http://test-worker.com';
process.env.EXPO_PUBLIC_AI_SECRET = 'test-secret';

// --- Mocks ---

// AsyncStorage Mock
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Expo Location Mock
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(() => Promise.resolve({
    coords: { latitude: 35.6812, longitude: 139.7671 },
  })),
  reverseGeocodeAsync: jest.fn(() => Promise.resolve([{ city: 'Tokyo' }])),
}));

// Expo Notifications Mock
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  cancelAllScheduledNotificationsAsync: jest.fn(),
}));

// Haptics Mock
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
}));

// Expo Core Mock
jest.mock('expo', () => ({}));

// Reanimated Mock
global.ReanimatedDataCollector = {
  registerAction: jest.fn(),
};

// --- Global Setup ---
global.fetch = jest.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve({}),
  })
);
