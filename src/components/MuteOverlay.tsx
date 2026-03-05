import { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import type { PracticeLineItem, PromptLevel } from '@/types';

interface Props {
  item: PracticeLineItem;
  promptLevel: PromptLevel;
}

export function MuteOverlay({ item, promptLevel }: Props) {
  const theme = useTheme();
  const progressAnim = useRef(new Animated.Value(1)).current;
  const flashAnim = useRef(new Animated.Value(0)).current;

  const charColor = item.character?.color ?? theme.colors.primary;

  // Flash character color at line start
  useEffect(() => {
    flashAnim.setValue(1);
    Animated.timing(flashAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [item.line.id]);

  // Countdown progress bar
  useEffect(() => {
    progressAnim.setValue(1);
    Animated.timing(progressAnim, {
      toValue: 0,
      duration: item.estimatedDurationMs,
      useNativeDriver: false,
    }).start();
  }, [item.line.id, item.estimatedDurationMs]);

  const promptText = (): string | null => {
    if (promptLevel === 'hidden') return null;
    if (promptLevel === 'first_word') {
      const firstWord = item.line.text.trim().split(/\s+/)[0];
      return `${firstWord}...`;
    }
    return item.line.text;
  };

  const flashBg = flashAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['transparent', charColor + '44'],
  });

  const barWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const hint = promptText();

  return (
    <Animated.View style={[styles.container, { backgroundColor: flashBg }]}>
      {/* Character name */}
      <Text variant="labelLarge" style={[styles.charName, { color: charColor }]}>
        {item.character?.name ?? 'YOUR LINE'}
      </Text>

      {/* YOUR TURN indicator */}
      <View style={[styles.yourTurnBadge, { borderColor: charColor }]}>
        <Text variant="labelMedium" style={{ color: charColor }}>
          YOUR LINE
        </Text>
      </View>

      {/* Progress bar */}
      <View style={[styles.progressTrack, { backgroundColor: theme.colors.surfaceVariant }]}>
        <Animated.View
          style={[
            styles.progressBar,
            { backgroundColor: charColor, width: barWidth },
          ]}
        />
      </View>

      {/* Prompt text */}
      {hint && (
        <Text
          variant={promptLevel === 'full_text' ? 'bodyMedium' : 'titleMedium'}
          style={[
            styles.hint,
            {
              color: promptLevel === 'full_text'
                ? theme.colors.onSurface + 'AA'
                : theme.colors.onSurface,
            },
          ]}
          numberOfLines={promptLevel === 'first_word' ? 1 : 10}
        >
          {hint}
        </Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  charName: {
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
    fontWeight: '700',
  },
  yourTurnBadge: {
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginBottom: 20,
  },
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 20,
  },
  progressBar: {
    height: '100%',
    borderRadius: 3,
  },
  hint: {
    textAlign: 'center',
    paddingHorizontal: 16,
  },
});
