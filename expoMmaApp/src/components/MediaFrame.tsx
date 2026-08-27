import { type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { radii } from '@/theme/radii';
import { useAppTheme } from '@/theme/useAppTheme';

type MediaFrameProps = {
  children: ReactNode;
  aspectRatio: number;
  style?: ViewStyle;
};

export function MediaFrame({ children, aspectRatio, style }: MediaFrameProps) {
  const theme = useAppTheme();

  return (
    <View
      style={[
        styles.frame,
        {
          aspectRatio,
          backgroundColor: theme.surfaceMuted,
          borderColor: theme.border,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: radii.md,
    borderWidth: 1,
  },
});
