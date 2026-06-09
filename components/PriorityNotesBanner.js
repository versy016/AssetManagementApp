// components/PriorityNotesBanner.js
// Prominent banner for priority (pinned) notes — shown at the top of an asset
// on both the asset detail screen and the scan / asset-actions screen.
// When onRemovePriority is provided, each note shows a control to demote it
// back to a normal note (the note itself is kept, just unpinned).

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, sf } from '../constants/uiTheme';

export default function PriorityNotesBanner({ notes, style, onRemovePriority }) {
  if (!Array.isArray(notes) || notes.length === 0) return null;
  return (
    <View style={[s.wrap, style]}>
      {notes.map((n, i) => (
        <View key={n.id || i} style={[s.item, i > 0 && s.itemDivider]}>
          <View style={s.iconWrap}><MaterialIcons name="priority-high" size={18} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.text}>{n.note}</Text>
            {n.who ? <Text style={s.who}>— {n.who}</Text> : null}
          </View>
          {onRemovePriority ? (
            <TouchableOpacity
              onPress={() => onRemovePriority(n)}
              style={s.removeBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialIcons name="flag" size={14} color={Colors.dangerFg} />
              <Text style={s.removeText}>Remove from priority</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { borderWidth: 2, borderColor: Colors.dangerFg, backgroundColor: Colors.dangerBg, borderRadius: Radius.md, padding: 12, marginBottom: 12, gap: 10 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  itemDivider: { borderTopWidth: 1, borderTopColor: '#FECACA', paddingTop: 10 },
  iconWrap: { width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.dangerFg, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: sf(15), fontWeight: '700', color: Colors.text, lineHeight: sf(20) },
  who: { fontSize: sf(12), color: Colors.sub, marginTop: 3, fontStyle: 'italic' },
  removeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 1 },
  removeText: { fontSize: sf(12), fontWeight: '700', color: Colors.dangerFg, textDecorationLine: 'underline' },
});
