import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { typography } from '../theme/typography';

interface ListItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  title: string;
  subtitle?: string;
  rightText?: string;
  rightComponent?: React.ReactNode;
  onPress?: () => void;
  showChevron?: boolean;
  isLast?: boolean;
  style?: ViewStyle;
}

export default function ListItem({
  icon, iconColor = colors.text, title, subtitle, rightText, rightComponent, onPress, showChevron = true, isLast = false, style
}: ListItemProps) {
  const Component = onPress ? TouchableOpacity : View;

  return (
    <Component style={[styles.container, style]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.iconContainer}>
        <Ionicons name={icon} size={24} color={iconColor} />
      </View>
      
      <View style={[styles.contentContainer, !isLast && styles.borderBottom]}>
        <View style={styles.textContainer}>
          <Text style={typography.body}>{title}</Text>
          {subtitle && <Text style={[typography.caption, { marginTop: 4 }]}>{subtitle}</Text>}
        </View>
        
        {rightText && (
          <Text style={[typography.bodySecondary, { marginRight: 8 }]}>{rightText}</Text>
        )}

        {rightComponent}

        {showChevron && (
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        )}
      </View>
    </Component>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  iconContainer: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 16,
    marginRight: 12,
  },
  contentContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingRight: 16,
  },
  borderBottom: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  textContainer: {
    flex: 1,
    justifyContent: 'center',
  },
});
