import React, { useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { colors } from '../theme/colors';

interface Props {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
}

const toLocalDateStr = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const formatDate = (value: string): string => {
  const date = new Date(`${value}T12:00:00`);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

export default function NativeDatePicker({ value, onChange }: Props) {
  const [show, setShow] = useState(false);
  const date = useMemo(() => new Date(`${value}T12:00:00`), [value]);

  return (
    <>
      <TouchableOpacity style={styles.button} onPress={() => setShow(true)}>
        <Text style={styles.text}>{formatDate(value)}</Text>
      </TouchableOpacity>
      <Modal visible={show} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <View />
              <TouchableOpacity onPress={() => setShow(false)}>
                <Text style={styles.done}>完了</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={date}
              mode="date"
              display="spinner"
              locale="ja"
              onChange={(_, selected) => {
                if (selected) {
                  onChange(toLocalDateStr(selected));
                }
              }}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.borderSubtle,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  text: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
  },
  done: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
});
