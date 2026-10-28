import { Tabs } from 'expo-router';
import { useColorScheme } from 'react-native';
import Svg, { Rect, Path } from 'react-native-svg';

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
function ChatIcon({ color }) {
  return (
    <Svg width={26} height={26} viewBox="0 0 26 26">
      <Path
        d="M5 4.5h16A2.5 2.5 0 0 1 23.5 7v9A2.5 2.5 0 0 1 21 18.5H11l-5.3 4.2A.8.8 0 0 1 4.5 22v-3.5H5A2.5 2.5 0 0 1 2.5 16V7A2.5 2.5 0 0 1 5 4.5Z"
        fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round"
      />
    </Svg>
  );
}

function PhotosIcon({ color }) {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24">
      <Path d="M4 6h3l1.5-2h7L17 6h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
      <Path d="M15.5 13a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z" fill="none" stroke={color} strokeWidth={1.8} />
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

function LightIcon({ color }) {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24">
      <Path d="M9 3h6v4a3 3 0 0 1-.9 2.1L13 10.2V14h-2v-3.8L9.9 9.1A3 3 0 0 1 9 7V3Z" fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
      <Path d="M11 14h2v6a1 1 0 0 1-2 0v-6Z" fill={color} />
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
      <Tabs.Screen name="chat" options={{ title: 'Chat', tabBarIcon: ({ color }) => <ChatIcon color={color} /> }} />
      <Tabs.Screen name="photos" options={{ title: 'Photos', tabBarIcon: ({ color }) => <PhotosIcon color={color} /> }} />
      <Tabs.Screen name="remote" options={{ title: 'Remote', tabBarIcon: ({ color }) => <RemoteIcon color={color} /> }} />
      <Tabs.Screen name="browser" options={{ title: 'Browser', tabBarIcon: ({ color }) => <BrowserIcon color={color} /> }} />
      <Tabs.Screen name="light" options={{ title: 'Light', tabBarIcon: ({ color }) => <LightIcon color={color} /> }} />
    </Tabs>
  );
}
