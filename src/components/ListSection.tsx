import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { colors } from '../theme/colors';

export default function ListSection({ children, style }: { children: React.ReactNode, style?: ViewStyle }) {
  return (
    <View style={[styles.section, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginHorizontal: 16,
    marginBottom: 24,
    overflow: 'hidden',
  },
});
