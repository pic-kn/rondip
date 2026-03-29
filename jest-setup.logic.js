global.__DEV__ = true;
process.env.EXPO_PUBLIC_AI_WORKER_URL = 'http://test-worker.com';
process.env.EXPO_PUBLIC_AI_SECRET = 'test-secret';

global.fetch = jest.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve({}),
  })
);
