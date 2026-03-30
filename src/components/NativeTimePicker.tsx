import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { colors } from '../theme/colors';

interface Props {
  value: string; // HH:MM
  onChange: (value: string) => void;
}

export default function NativeTimePicker({ value, onChange }: Props) {
  const [show, setShow] = useState(false);
  const [h, m] = value.split(':').map(Number);
  const date = new Date();
  date.setHours(h, m, 0, 0);

  return (
    <>
      <TouchableOpacity style={styles.button} onPress={() => setShow(true)}>
        <Text style={styles.text}>{value}</Text>
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
              mode="time"
              display="spinner"
              minuteInterval={5}
              locale="ja"
              onChange={(_, selected) => {
                if (selected) {
                  const hh = String(selected.getHours()).padStart(2, '0');
                  const mm = String(selected.getMinutes()).padStart(2, '0');
                  onChange(`${hh}:${mm}`);
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
