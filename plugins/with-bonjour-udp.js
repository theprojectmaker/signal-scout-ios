const { withInfoPlist } = require('@expo/config-plugins');

// MultipeerConnectivity (used by expo-nearby-connections) advertises/browses over BOTH TCP and
// UDP. On iOS 14+ the system silently blocks discovery unless every service type is declared in
// NSBonjourServices. The library's own plugin adds only `_sigscout-share._tcp`, so peers are
// never found — this appends the matching `._udp` (keeping `._tcp`). Must run AFTER the
// expo-nearby-connections plugin in app.json so it sees and extends what that plugin wrote.
module.exports = function withBonjourUdp(config) {
  return withInfoPlist(config, (c) => {
    const want = ['_sigscout-share._tcp', '_sigscout-share._udp'];
    const existing = Array.isArray(c.modResults.NSBonjourServices) ? c.modResults.NSBonjourServices : [];
    c.modResults.NSBonjourServices = Array.from(new Set([...existing, ...want]));
    return c;
  });
};
