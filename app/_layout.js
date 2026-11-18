import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useOtaUpdate } from '../components/useOtaUpdate';

export default function Layout() {
  // On every launch: if a newer OTA exists, fetch it and reload straight into it, so the app is
  // never a step behind after a publish. (expo's default only applies updates on the next launch.)
  useOtaUpdate();
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#0b0f17' },
        }}
      />
    </SafeAreaProvider>
  );
}
