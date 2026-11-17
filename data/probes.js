// Reachability Lab endpoint catalog.
// Each probe: { id, name, cat, type:'https'|'wss', url, channel:bool }
// channel=true  -> if this endpoint is REACHABLE, it could plausibly carry a two-way
//                  control channel to a Windows PC (messaging API, realtime pub/sub,
//                  relay host, websocket, or your own infra). These are the prizes.
//
// Built at runtime so the source stays compact. Call buildProbes().

const AWS_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1', 'ca-west-1',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-central-2', 'eu-north-1',
  'eu-south-1', 'eu-south-2', 'sa-east-1', 'ap-south-1', 'ap-south-2', 'ap-southeast-1',
  'ap-southeast-2', 'ap-southeast-3', 'ap-southeast-4', 'ap-northeast-1', 'ap-northeast-2',
  'ap-northeast-3', 'ap-east-1', 'me-south-1', 'me-central-1', 'af-south-1', 'il-central-1',
];
const AWS_SERVICES = ['s3', 'execute-api', 'dynamodb', 'ec2', 'lambda', 'sqs', 'sns', 'iot', 'appsync', 'kinesis'];

const PUSHER_CLUSTERS = ['mt1', 'us2', 'us3', 'eu', 'ap1', 'ap2', 'ap3', 'ap4', 'sa1'];

const AZURE_HOSTS = [
  'portal.azure.com', 'management.azure.com', 'login.microsoftonline.com',
  'graph.microsoft.com', 'azure.microsoft.com', 'azurewebsites.net', 'blob.core.windows.net',
  'queue.core.windows.net', 'table.core.windows.net', 'servicebus.windows.net',
  'azure-devices.net', 'azureedge.net', 'trafficmanager.net', 'cloudapp.azure.com',
  'database.windows.net', 'cognitiveservices.azure.com', 'signalr.net', 'web.pubsub.azure.com',
];

// --- static curated hosts, grouped --------------------------------------------
const GROUPS = [
  ['Apple (should pass)', false, 'https', [
    'apple.com', 'www.apple.com', 'support.apple.com', 'push.apple.com', 'gateway.icloud.com',
    'www.icloud.com', 'p01-content.icloud.com', 'gsp-ssl.ls.apple.com', 'gs.apple.com',
    'weatherkit.apple.com', 'api.weatherkit.apple.com', 'gsas.apple.com', 'init.itunes.apple.com',
    'configuration.apple.com', 'cl1.apple.com', 'identity.apple.com', 'setup.icloud.com',
    'mesu.apple.com', 'ocsp.apple.com', 'time.apple.com', 'captive.apple.com',
  ]],
  ['Google', false, 'https', [
    'google.com', 'www.google.com', 'www.googleapis.com', 'firestore.googleapis.com',
    'fcm.googleapis.com', 'firebaseremoteconfig.googleapis.com', 'firebaseinstallations.googleapis.com',
    'apis.google.com', 'script.google.com', 'script.googleusercontent.com', 'storage.googleapis.com',
    'commondatastorage.googleapis.com', 'classroom.googleapis.com', 'accounts.google.com',
    'gstatic.com', 'www.gstatic.com', 'youtube.com', 'www.youtube.com', 'docs.google.com',
    'drive.google.com', 'mail.google.com', 'chat.googleapis.com', 'oauth2.googleapis.com',
  ]],
  ['Google (channels)', true, 'https', [
    'firebasedatabase.app', 'firebaseio.com', 'web.app', 'firebaseapp.com',
  ]],
  ['Cloudflare', false, 'https', [
    'cloudflare.com', 'www.cloudflare.com', '1.1.1.1', 'cloudflare-dns.com', 'one.one.one.one',
    'cdnjs.cloudflare.com', 'workers.dev', 'pages.dev', 'cloudflareinsights.com',
  ]],
  ['Messaging APIs (channels)', true, 'https', [
    'api.telegram.org', 'core.telegram.org', 'web.telegram.org',
    'discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com', 'gateway.discord.gg',
    'slack.com', 'api.slack.com', 'hooks.slack.com', 'wss-primary.slack.com',
    'api.twilio.com', 'chat.twilio.com', 'conversations.twilio.com',
    'ntfy.sh', 'push.pushover.net', 'api.pushover.net', 'onesignal.com', 'api.onesignal.com',
    'api.pushbullet.com', 'stream.pushbullet.com', 'fcm.googleapis.com', 'gotify.net',
    'api.whatsapp.com', 'graph.facebook.com', 'api.line.me', 'matrix.org', 'api.groupme.com',
  ]],
  ['Realtime / pub-sub (channels)', true, 'https', [
    'rest.ably.io', 'realtime.ably.io', 'ps.pndsn.com', 'pubsub.pubnub.com',
    'api.pusher.com', 'sockjs.pusher.com', 'mqtt.googleapis.com', 'iot.us-east-1.amazonaws.com',
    'realtime.supabase.co', 'api.supabase.com', 'cloud.ably.io', 'centrifugo.io',
    'www.pubnub.com', 'push.ful.io', 'stream-io-api.com', 'getstream.io',
  ]],
  ['WebSocket echo (channels)', true, 'wss', [
    'wss://echo.websocket.events', 'wss://echo.websocket.org', 'wss://ws.postman-echo.com/raw',
    'wss://socketsbay.com/wss/v2/1/demo/', 'wss://ws.ifelse.io', 'wss://demos.kaazing.com/echo',
  ]],
  ['MQTT over WSS (channels)', true, 'wss', [
    'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081',
    'wss://broker.emqx.io:8084/mqtt', 'wss://mqtt.eclipseprojects.io:443/mqtt',
  ]],
  ['Realtime WSS (channels)', true, 'wss', [
    'wss://ws-mt1.pusher.com/app/demo', 'wss://realtime.ably.io', 'wss://ps.pndsn.com',
    'wss://gateway.discord.gg/?v=10&encoding=json', 'wss://ntfy.sh/_test/ws',
  ]],
  ['Hosting platforms (channels)', true, 'https', [
    'vercel.com', 'vercel.app', 'netlify.com', 'netlify.app', 'onrender.com', 'render.com',
    'railway.app', 'up.railway.app', 'fly.io', 'fly.dev', 'deno.dev', 'deno.com',
    'glitch.me', 'glitch.com', 'herokuapp.com', 'heroku.com', 'replit.com', 'repl.co',
    'pythonanywhere.com', 'ngrok.io', 'ngrok-free.app', 'trycloudflare.com', 'loca.lt',
    'serveo.net', 'localtunnel.me', 'tunnelto.dev', 'pagekite.me', 'gist.github.com',
  ]],
  ['CDNs', false, 'https', [
    'cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'ajax.googleapis.com',
    'stackpath.bootstrapcdn.com', 'maxcdn.bootstrapcdn.com', 'code.jquery.com', 'esm.sh',
    'cdn.skypack.dev', 'fastly.jsdelivr.net', 'cdn.statically.io', 'jsdelivr.b-cdn.net',
    'use.fontawesome.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'polyfill.io',
  ]],
  ['Big sites (web baseline)', false, 'https', [
    'wikipedia.org', 'en.wikipedia.org', 'github.com', 'raw.githubusercontent.com',
    'api.github.com', 'bing.com', 'duckduckgo.com', 'reddit.com', 'microsoft.com',
    'amazon.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'cloudfront.net',
    'stackoverflow.com', 'yahoo.com', 'baidu.com', 'fast.com', 'speedtest.net',
  ]],
  ['Your infrastructure (channels)', true, 'https', [
    'remote.agentdomains.co', 'scriptly.workers.dev', 'greatneck.workers.dev',
    'messages.scriptly.workers.dev', 'fidgettrack.greatneck.workers.dev',
    'studento.greatneck.workers.dev', 'classroom-sync.greatneck.workers.dev',
    'classroom-bot.greatneck.workers.dev', 'aichat-proxy.greatneck.workers.dev',
    'soly-works.scriptly.workers.dev', 'motordex.pages.dev', 'trip-manifest.pages.dev',
    'geometry-hq.pages.dev', 'photo3d.pages.dev', 'dadpc.pages.dev', 'remote-control-3jx.pages.dev',
    'beam-gateway.pages.dev', 'storage.googleapis.com', 'commondatastorage.googleapis.com',
  ]],
];

export function buildProbes() {
  const out = [];
  let n = 0;
  const add = (name, cat, type, url, channel) => {
    const full = type === 'wss'
      ? url
      : (url.startsWith('http') ? url : 'https://' + url + '/');
    out.push({ id: 'p' + (n++) + '_' + cat.replace(/\W+/g, '').slice(0, 6), name, cat, type, url: full, channel: !!channel });
  };

  for (const [cat, channel, type, hosts] of GROUPS) {
    for (const h of hosts) add(type === 'wss' ? h.replace(/^wss:\/\//, '') : h, cat, type, h, channel);
  }

  // AWS: region x service — each is a genuinely distinct host / IP range.
  for (const r of AWS_REGIONS) {
    for (const s of AWS_SERVICES) {
      add(`${s}.${r}`, 'AWS (channels)', 'https', `${s}.${r}.amazonaws.com`, true);
    }
  }
  // AWS global-ish
  for (const h of ['aws.amazon.com', 'console.aws.amazon.com', 'd1.awsstatic.com', 'cloudfront.net', 'amazonaws.com'])
    add(h, 'AWS (channels)', 'https', h, true);

  // Azure
  for (const h of AZURE_HOSTS) add(h, 'Azure (channels)', 'https', h, true);

  // Pusher clusters (https + wss)
  for (const c of PUSHER_CLUSTERS) {
    add(`ws-${c}.pusher.com`, 'Pusher (channels)', 'wss', `wss://ws-${c}.pusher.com/app/demo`, true);
    add(`sockjs-${c}.pusher.com`, 'Pusher (channels)', 'https', `sockjs-${c}.pusher.com`, true);
  }

  // A spread of public STUN-ish / misc hosts over https (reachability only)
  for (const h of ['stun.l.google.com', 'global.turn.twilio.com', 'relay.metered.ca', 'openrelay.metered.ca'])
    add(h, 'WebRTC relays (channels)', 'https', h, true);

  return out;
}

export const PROBE_COUNT_HINT = buildProbes().length;
