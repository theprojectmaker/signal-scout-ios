import { Tabs } from 'expo-router';
import { useColorScheme } from 'react-native';
import Svg, { Rect, Path, Circle } from 'react-native-svg';

// Signal Scout is a personal tool: a signal detector + remote control (PC remote, web-over-iCloud
// browser, and the reachability lab). The AI / notes / photos / tools live in the Aria app instead.

function ScoutIcon({ color }) {
  return (
    <Svg width={26} height={26} viewBox="0 0 26 26">
      <Rect x="3" y="15" width="3.6" height="7" rx="1.2" fill={color} />
      <Rect x="9" y="11" width="3.6" height="11" rx="1.2" fill={color} />
      <Rect x="15" y="7" width="3.6" height="15" rx="1.2" fill={color} />
      <Rect x="21" y="3" width="3.6" height="19" rx="1.2" fill={color} />
    </Svg>
  );
}
function RemoteIcon({ color }) {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24">
      <Rect x="3" y="4" width="18" height="12" rx="1.6" fill="none" stroke={color} strokeWidth={1.8} />
      <Path d="M9 20h6M12 16v4" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M8.5 10.2a5 5 0 0 1 7 0M10.6 8.2a2 2 0 0 1 2.8 0" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}
function BrowserIcon({ color }) {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24">
      <Path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" fill="none" stroke={color} strokeWidth={1.8} />
      <Path d="M3 12h18M12 3c2.5 2.3 2.5 15.7 0 18M12 3c-2.5 2.3-2.5 15.7 0 18" fill="none" stroke={color} strokeWidth={1.6} />
    </Svg>
  );
}
function LabIcon({ color }) {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="2.2" fill={color} />
      <Path d="M12 5.5a6.5 6.5 0 0 1 6.5 6.5M12 2.5A9.5 9.5 0 0 1 21.5 12" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      <Path d="M12 18.5A6.5 6.5 0 0 1 5.5 12M12 21.5A9.5 9.5 0 0 1 2.5 12" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
    </Svg>
  );
}

export default function TabsLayout() {
  const dark = useColorScheme() === 'dark';
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: dark ? '#0A84FF' : '#007AFF',
        tabBarInactiveTintColor: dark ? '#98989F' : '#8E8E93',
        tabBarStyle: {
          backgroundColor: dark ? '#1C1C1E' : '#FFFFFF',
          borderTopColor: dark ? '#38383A' : '#E5E5EA',
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Scout', tabBarIcon: ({ color }) => <ScoutIcon color={color} /> }} />
      <Tabs.Screen name="icloudremote" options={{ title: 'Remote', tabBarIcon: ({ color }) => <RemoteIcon color={color} /> }} />
      <Tabs.Screen name="browser" options={{ title: 'Web', tabBarIcon: ({ color }) => <BrowserIcon color={color} /> }} />
      <Tabs.Screen name="probe" options={{ title: 'Lab', tabBarIcon: ({ color }) => <LabIcon color={color} /> }} />
      {/* Live Remote (normal-Wi-Fi backup) — reached from the Remote tab's ••• menu, hidden from the bar */}
      <Tabs.Screen name="remote" options={{ href: null, title: 'Live Remote' }} />
    </Tabs>
  );
}
