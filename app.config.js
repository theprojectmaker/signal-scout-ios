// Extends app.json and injects this user's defaults + secrets at build / publish time.
//
// SECURITY: this repo is PUBLIC. Never hardcode the agent password or the CloudKit token here.
// They come from process.env ONLY (empty when unset) and are provided as GitHub Actions / EAS
// secrets for builds, or exported in the shell before `eas update`. Non-secret identifiers
// (hostId, relay, container, room) have safe defaults so the app is pre-configured out of the box.
module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    entitlements: {
      ...(config.ios && config.ios.entitlements),
      'com.apple.developer.icloud-container-identifiers': ['iCloud.com.solyapps.signalscout'],
      'com.apple.developer.icloud-services': ['CloudKit'],
    },
  },
  extra: {
    ...config.extra,
    rc: {
      // Normal Remote tab (identifiers, not secret — the password is the real gate)
      hostId: process.env.RC_HOST_ID || '075e6fc2-308f-4c15-823b-c24d32d472c5',
      relay: process.env.RC_RELAY || 'wss://remote.agentdomains.co',
      // iCloud Remote (CloudKit)
      container: process.env.RC_CK_CONTAINER || 'iCloud.com.solyapps.signalscout',
      room: process.env.RC_ROOM || 'SOLYPC',
      env: process.env.RC_CK_ENV || 'production',
      // SECRETS — env only; leave empty if unset, never commit a value.
      // CloudKit tokens are per-environment, so carry both; the app picks by env.
      cloudkitTokenProd: process.env.RC_CLOUDKIT_TOKEN || '',       // GitHub secret = production token
      cloudkitTokenDev: process.env.RC_CLOUDKIT_TOKEN_DEV || '',
      password: process.env.RC_PASSWORD || '',
    },
  },
});
