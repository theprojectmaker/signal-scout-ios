import { useColorScheme } from 'react-native';
import { useMemo } from 'react';

export function useTheme() {
  const dark = useColorScheme() === 'dark';
  return useMemo(() => dark ? {
    dark: true,
    bg: '#000000', card: '#1C1C1E', fill: '#2C2C2E', sep: '#38383A',
    label: '#FFFFFF', label2: '#98989F', label3: '#636366',
    blue: '#0A84FF', green: '#30D158', red: '#FF453B', onBlue: '#FFFFFF',
    bubbleUser: '#0A84FF', bubbleAI: '#1C1C1E',
  } : {
    dark: false,
    bg: '#F2F2F7', card: '#FFFFFF', fill: '#E9E9EB', sep: '#E5E5EA',
    label: '#1C1C1E', label2: '#8E8E93', label3: '#C7C7CC',
    blue: '#007AFF', green: '#34C759', red: '#FF3B30', onBlue: '#FFFFFF',
    bubbleUser: '#007AFF', bubbleAI: '#FFFFFF',
  }, [dark]);
}
