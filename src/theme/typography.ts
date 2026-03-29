import { TextStyle } from 'react-native';
import { colors } from './colors';

export const typography = {
  h1: { fontSize: 24, fontWeight: '900', color: '#000000', fontFamily: 'TsukuARoundGothic-Regular', letterSpacing: 2 } as TextStyle,
  h2: { fontSize: 20, fontWeight: '800', color: '#000000', fontFamily: 'TsukuARoundGothic-Regular', letterSpacing: 1 } as TextStyle,
  h3: { fontSize: 18, fontWeight: '700', color: '#000000', fontFamily: 'TsukuARoundGothic-Regular' } as TextStyle,
  body: { fontSize: 16, color: '#000000', fontFamily: 'TsukuARoundGothic-Regular' } as TextStyle,
  bodySecondary: { fontSize: 14, color: '#4B5563', fontFamily: 'TsukuARoundGothic-Regular' } as TextStyle,
  caption: { fontSize: 12, color: '#6B7280', fontFamily: 'TsukuARoundGothic-Regular', letterSpacing: 1 } as TextStyle,
};
