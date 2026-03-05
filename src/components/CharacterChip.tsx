import { StyleSheet } from 'react-native';
import { Chip, useTheme } from 'react-native-paper';
import type { Character } from '@/types';

interface Props {
  character: Character;
  onPress?: () => void;
  onLongPress?: () => void;
  selected?: boolean;
}

export function CharacterChip({ character, onPress, onLongPress, selected }: Props) {
  useTheme(); // ensures theme context is available for future use

  return (
    <Chip
      mode={character.isActor || selected ? 'flat' : 'outlined'}
      style={[
        styles.chip,
        {
          backgroundColor:
            character.isActor || selected ? character.color + '33' : undefined,
          borderColor: character.color,
        },
      ]}
      textStyle={{ color: character.color }}
      onPress={onPress}
      onLongPress={onLongPress}
      icon={character.isActor ? 'account-star' : 'account-outline'}
    >
      {character.name}
    </Chip>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
  },
});
