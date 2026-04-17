// components/ui/Chip.js
import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Radius, FontWeights } from '../../constants/uiTheme';

export default function Chip({ label, active, onPress, icon, style, textStyle, tone = 'default' }) {
  const palette = makePalette(tone, active);
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.chip,
        palette.container,
        style
      ]}
      activeOpacity={0.8}
    >
      {icon ? (
        <Feather
          name={icon}
          size={14}
          color={palette.icon}
          style={{ marginRight: 6 }}
        />
      ) : null}
      <Text
        style={[
          styles.text,
          { color: palette.text },
          textStyle
        ]}
        numberOfLines={1}
      >
        {label?.toUpperCase?.()}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    marginRight: 6,
  },
  text: {
    fontWeight: FontWeights.bold,
    fontSize: 12,
    letterSpacing: 0.5,
  },
});

function makePalette(tone, active) {
  if (!active) {
    // inactive
    return {
      container: {
        backgroundColor: Colors.card,
        borderColor: Colors.line,
      },
      text: Colors.sub,
      icon: Colors.sub,
    };
  }

  switch (tone) {
    case 'warning':
      return {
        container: {
          backgroundColor: Colors.warningBg,
          borderColor: Colors.warningBorder,
        },
        text: Colors.warningFg,
        icon: Colors.warningFg,
      };
    case 'success':
      return {
        container: {
          backgroundColor: Colors.successBg,
          borderColor: Colors.successBorder,
        },
        text: Colors.successFg,
        icon: Colors.successFg,
      };
    case 'danger':
      return {
        container: {
          backgroundColor: Colors.dangerBg,
          borderColor: Colors.dangerBorder,
        },
        text: Colors.dangerFg,
        icon: Colors.dangerFg,
      };
    case 'info':
      return {
        container: {
          backgroundColor: Colors.infoBg,
          borderColor: Colors.infoBorder,
        },
        text: Colors.infoFg,
        icon: Colors.infoFg,
      };
    default:
      return {
        container: {
          backgroundColor: Colors.primaryLight,
          borderColor: Colors.primary,
        },
        text: Colors.primary,
        icon: Colors.primary,
      };
  }
}
