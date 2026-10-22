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
    </Tabs>
  );
}
