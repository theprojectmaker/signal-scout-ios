// Reachability Lab endpoint catalog.
// Each probe: { id, name, cat, type:'https'|'wss', url, channel:bool }
// channel=true  -> if REACHABLE, it could plausibly carry a two-way control channel to a
//                  Windows PC (messaging API, realtime pub/sub, tunnel, mesh-VPN coordinator,
//                  relay host, websocket, or your own infra). These are the prizes.
// Built at runtime so the source stays compact. Call buildProbes().

// ---- region tables -----------------------------------------------------------
const AWS_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1', 'ca-west-1',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-central-2', 'eu-north-1',
  'eu-south-1', 'eu-south-2', 'sa-east-1', 'ap-south-1', 'ap-south-2', 'ap-southeast-1',
  'ap-southeast-2', 'ap-southeast-3', 'ap-southeast-4', 'ap-southeast-5', 'ap-southeast-7',
  'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3', 'ap-east-1', 'me-south-1',
  'me-central-1', 'af-south-1', 'il-central-1', 'mx-central-1',
];
const AWS_SERVICES = [
  's3', 'execute-api', 'dynamodb', 'ec2', 'lambda', 'sqs', 'sns', 'iot', 'appsync', 'kinesis',
  'rds', 'sts', 'cognito-idp', 'cognito-identity', 'ssm', 'secretsmanager', 'kms', 'logs',
  'monitoring', 'elasticache', 'events', 'states', 'apigateway',
];
const AZURE_REGIONS = [
  'eastus', 'eastus2', 'westus', 'westus2', 'westus3', 'centralus', 'southcentralus',
  'northcentralus', 'westcentralus', 'canadacentral', 'canadaeast', 'brazilsouth',
  'northeurope', 'westeurope', 'uksouth', 'ukwest', 'francecentral', 'germanywestcentral',
  'switzerlandnorth', 'norwayeast', 'swedencentral', 'polandcentral', 'italynorth',
  'eastasia', 'southeastasia', 'japaneast', 'japanwest', 'australiaeast', 'australiasoutheast',
  'centralindia', 'southindia', 'koreacentral', 'uaenorth', 'southafricanorth', 'qatarcentral',
];
const ORACLE_REGIONS = [
  'us-ashburn-1', 'us-phoenix-1', 'us-sanjose-1', 'us-chicago-1', 'ca-toronto-1', 'ca-montreal-1',
  'sa-saopaulo-1', 'sa-santiago-1', 'uk-london-1', 'uk-cardiff-1', 'eu-frankfurt-1', 'eu-amsterdam-1',
  'eu-zurich-1', 'eu-madrid-1', 'eu-marseille-1', 'eu-milan-1', 'eu-paris-1', 'eu-stockholm-1',
  'me-jeddah-1', 'me-dubai-1', 'ap-tokyo-1', 'ap-osaka-1', 'ap-seoul-1', 'ap-singapore-1',
  'ap-mumbai-1', 'ap-hyderabad-1', 'ap-sydney-1', 'ap-melbourne-1', 'af-johannesburg-1',
];
const DO_REGIONS = ['nyc3', 'sfo2', 'sfo3', 'ams3', 'sgp1', 'lon1', 'fra1', 'tor1', 'blr1', 'syd1'];
const LINODE_REGIONS = ['us-east-1', 'us-southeast-1', 'us-ord-1', 'us-sea-1', 'eu-central-1', 'ap-south-1', 'fr-par-1', 'nl-ams-1', 'se-sto-1', 'in-maa-1', 'jp-osa-1', 'br-gru-1'];
const VULTR_REGIONS = ['ewr', 'ord', 'dfw', 'sea', 'lax', 'atl', 'ams', 'lhr', 'fra', 'sgp', 'nrt', 'syd'];
const WASABI_REGIONS = ['us-east-1', 'us-east-2', 'us-central-1', 'us-west-1', 'eu-central-1', 'eu-west-1', 'eu-west-2', 'ap-northeast-1', 'ap-southeast-1', 'ap-southeast-2'];
const PUSHER_CLUSTERS = ['mt1', 'us2', 'us3', 'eu', 'ap1', 'ap2', 'ap3', 'ap4', 'sa1'];

// ---- curated host groups -----------------------------------------------------
const GROUPS = [
  ['Apple — core (should pass)', false, 'https', [
    'apple.com', 'www.apple.com', 'support.apple.com', 'developer.apple.com', 'id.apple.com',
    'captive.apple.com', 'time.apple.com', 'ocsp.apple.com', 'ocsp2.apple.com', 'crl.apple.com',
    'configuration.apple.com', 'mesu.apple.com', 'gs.apple.com', 'gsa.apple.com', 'gsas.apple.com',
    'identity.apple.com', 'appattest.apple.com', 'certs.apple.com', 'valid.apple.com',
  ]],
  ['Apple — push & iMessage (channels)', true, 'https', [
    'push.apple.com', '1-courier.push.apple.com', '2-courier.push.apple.com', '5-courier.push.apple.com',
    'courier.push.apple.com', 'api.push.apple.com', 'gateway.push.apple.com', 'feedback.push.apple.com',
    'init.push.apple.com', 'ids.apple.com', 'identityservices.apple.com', 'service.ess.apple.com',
    'comms.apple.com', 'imap.mail.me.com', 'smtp.mail.me.com', 'p01-imap.mail.me.com',
  ]],
  ['Apple — iCloud / services', false, 'https', [
    'icloud.com', 'www.icloud.com', 'setup.icloud.com', 'gateway.icloud.com', 'p01-content.icloud.com',
    'p01-caldav.icloud.com', 'p01-ckdatabase.icloud.com', 'ckdatabasews.icloud.com', 'keyvalueservice.icloud.com',
    'p01-fmip.icloud.com', 'fmipmobile.icloud.com', 'cvws.icloud-content.com', 'bookmarks.icloud.com',
    'weatherkit.apple.com', 'api.weatherkit.apple.com', 'gsp-ssl.ls.apple.com', 'gsp64-ssl.ls.apple.com',
    'xp.apple.com', 'metrics.icloud.com', 'statici.icloud.com', 'cl1.apple.com', 'cl5.apple.com',
    'buy.itunes.apple.com', 'init.itunes.apple.com', 'play.itunes.apple.com', 'su.itunes.apple.com',
    'appleid.apple.com', 'idmsa.apple.com', 'itunes.apple.com', 'books.itunes.apple.com',
    'mdmenrollment.apple.com', 'deviceenrollment.apple.com', 'business.apple.com', 'school.apple.com',
    'gdmf.apple.com', 'cdn-apple.com', 'mzstatic.com', 'is1-ssl.mzstatic.com', 'smoot.apple.com',
  ]],
  ['iCloud mailbox candidates (channels ⭐⭐)', true, 'https', [
    'api.apple-cloudkit.com', 'cloudkit.icloud.com', 'gateway.icloud.com', 'p01-ckdatabase.icloud.com',
    'p01-ckdatabasews.icloud.com', 'p01-ubiquityws.icloud.com', 'p01-docws.icloud.com', 'docws.icloud.com',
    'p01-keyvalueservice.icloud.com', 'p01-contacts.icloud.com', 'p01-reminders.icloud.com',
    'p01-notes.icloud.com', 'idmsa.apple.com', 'ckdatabasews.icloud.com', 'p01-fmf.icloud.com',
  ]],
  ['Mesh VPN / zero-config (channels ⭐⭐)', true, 'https', [
    'controlplane.tailscale.com', 'login.tailscale.com', 'derp.tailscale.com', 'api.tailscale.com',
    'my.zerotier.com', 'my.zerotier.com', 'api.zerotier.com', 'download.zerotier.com',
    'api.twingate.com', 'tailscale.com', 'zerotier.com', 'www.wireguard.com', 'ngrok.com',
    'tunnel.cloudflare.com', 'api.cloudflare.com', 'api.ngrok.com', 'connect.ngrok-agent.com',
    'relay.nebula.defined.net', 'api.defined.net', 'hamachi.cc', 'vpn.hamachi.cc',
    'netbird.io', 'api.netbird.io', 'headscale.net', 'api.tailscale.io',
  ]],
  ['Tunnels / reverse proxies (channels ⭐)', true, 'https', [
    'ngrok.io', 'ngrok-free.app', 'connect.ngrok.com', 'trycloudflare.com', 'loca.lt', 'localtunnel.me',
    'serveo.net', 'tunnelto.dev', 'pagekite.me', 'localhost.run', 'bore.pub', 'telebit.cloud',
    'packetriot.com', 'expose.sh', 'tunnelmole.com', 'playit.gg', 'api.playit.gg', 'zrok.io',
    'pinggy.io', 'a.pinggy.io', 'relay.dev', 'webhookrelay.com', 'smee.io', 'hookdeck.com',
  ]],
  ['DNS-over-HTTPS (channels ⭐)', true, 'https', [
    'dns.google', 'cloudflare-dns.com', 'mozilla.cloudflare-dns.com', 'dns.quad9.net', 'doh.opendns.com',
    'dns.nextdns.io', 'doh.cleanbrowsing.org', 'dns.adguard-dns.com', 'doh.dns.sb', 'dns.alidns.com',
    'doh.pub', 'dns.twnic.tw', 'doh.libredns.gr', 'odvr.nic.cz', 'doh.360.cn',
  ]],
  ['Messaging APIs (channels ⭐)', true, 'https', [
    'api.telegram.org', 'core.telegram.org', 'web.telegram.org', 'telegram.org', 't.me',
    'discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com', 'gateway.discord.gg',
    'discord.gg', 'cdn.discordapp.com', 'media.discordapp.net',
    'slack.com', 'api.slack.com', 'hooks.slack.com', 'wss-primary.slack.com', 'files.slack.com',
    'api.twilio.com', 'chat.twilio.com', 'conversations.twilio.com', 'messaging.twilio.com',
    'ntfy.sh', 'push.pushover.net', 'api.pushover.net', 'onesignal.com', 'api.onesignal.com',
    'onesignal.notify.net', 'api.pushbullet.com', 'stream.pushbullet.com', 'gotify.net',
    'api.whatsapp.com', 'web.whatsapp.com', 'graph.facebook.com', 'graph.instagram.com',
    'api.line.me', 'access.line.me', 'matrix.org', 'api.groupme.com', 'push.groupme.com',
    'api.pushsafer.com', 'alertzy.app', 'api.simplepush.io', 'api.spontit.com', 'prowlapp.com',
    'api.mailgun.net', 'api.sendgrid.com', 'api.resend.com', 'api.postmarkapp.com',
  ]],
  ['Realtime / pub-sub (channels ⭐)', true, 'https', [
    'rest.ably.io', 'realtime.ably.io', 'cloud.ably.io', 'ps.pndsn.com', 'pubsub.pubnub.com',
    'www.pubnub.com', 'api.pusher.com', 'sockjs.pusher.com', 'realtime.supabase.co', 'api.supabase.com',
    'app.supabase.com', 'centrifugo.io', 'getstream.io', 'stream-io-api.com', 'chat.stream-io-api.com',
    'firebasedatabase.app', 'firebaseio.com', 'web.app', 'firebaseapp.com', 'liveblocks.io',
    'api.liveblocks.io', 'partykit.io', 'hamr.partykit.dev', 'websocket.in', 'api.deepstream.io',
    'scaledrone.com', 'api.scaledrone.com', 'fanout.io', 'api.fanout.io', 'pushpin.org',
  ]],
  ['WebSocket echo (channels ⭐)', true, 'wss', [
    'wss://echo.websocket.events', 'wss://echo.websocket.org', 'wss://ws.postman-echo.com/raw',
    'wss://socketsbay.com/wss/v2/1/demo/', 'wss://ws.ifelse.io', 'wss://demos.kaazing.com/echo',
    'wss://libwebsockets.org', 'wss://streaming.vn.teslamotors.com',
  ]],
  ['MQTT over WSS (channels ⭐)', true, 'wss', [
    'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081', 'wss://broker.emqx.io:8084/mqtt',
    'wss://mqtt.eclipseprojects.io:443/mqtt', 'wss://public.cloud.shiftr.io', 'wss://broker.mqttdashboard.com:8884/mqtt',
  ]],
  ['Realtime WSS (channels ⭐)', true, 'wss', [
    'wss://ws-mt1.pusher.com/app/demo', 'wss://realtime.ably.io', 'wss://ps.pndsn.com',
    'wss://gateway.discord.gg/?v=10&encoding=json', 'wss://ntfy.sh/_test/ws', 'wss://relay.walletconnect.com',
  ]],
  ['WebRTC STUN/TURN providers (channels ⭐)', true, 'https', [
    'relay.metered.ca', 'openrelay.metered.ca', 'global.turn.twilio.com', 'global.stun.twilio.com',
    'xirsys.com', 'global.xirsys.net', 'www.metered.ca', 'cloudflare.com', 'icelink.frozenmountain.com',
    'numb.viagenie.ca', 'stun.l.google.com', 'freeturn.net', 'api.metered.ca',
  ]],
  ['Hosting platforms (channels ⭐)', true, 'https', [
    'vercel.com', 'vercel.app', 'netlify.com', 'netlify.app', 'onrender.com', 'render.com',
    'railway.app', 'up.railway.app', 'fly.io', 'fly.dev', 'deno.dev', 'deno.com', 'val.town',
    'glitch.me', 'glitch.com', 'herokuapp.com', 'heroku.com', 'replit.com', 'repl.co', 'replit.dev',
    'pythonanywhere.com', 'cyclic.app', 'koyeb.app', 'adaptable.app', 'workers.dev', 'pages.dev',
    'web.app', 'firebaseapp.com', 'surge.sh', 'github.io', 'gitlab.io', 'now.sh', 'supabase.co',
  ]],
  ['Google', false, 'https', [
    'google.com', 'www.google.com', 'www.googleapis.com', 'firestore.googleapis.com', 'fcm.googleapis.com',
    'firebaseremoteconfig.googleapis.com', 'firebaseinstallations.googleapis.com', 'apis.google.com',
    'script.google.com', 'script.googleusercontent.com', 'storage.googleapis.com',
    'commondatastorage.googleapis.com', 'classroom.googleapis.com', 'accounts.google.com', 'gstatic.com',
    'www.gstatic.com', 'youtube.com', 'docs.google.com', 'drive.google.com', 'mail.google.com',
    'chat.googleapis.com', 'oauth2.googleapis.com', 'run.app', 'appspot.com', 'cloudfunctions.net',
  ]],
  ['Cloudflare', false, 'https', [
    'cloudflare.com', 'www.cloudflare.com', '1.1.1.1', 'cloudflare-dns.com', 'one.one.one.one',
    'cdnjs.cloudflare.com', 'workers.dev', 'pages.dev', 'cloudflareinsights.com', 'speed.cloudflare.com',
  ]],
  ['CDNs', false, 'https', [
    'cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'ajax.googleapis.com', 'esm.sh',
    'stackpath.bootstrapcdn.com', 'maxcdn.bootstrapcdn.com', 'code.jquery.com', 'cdn.skypack.dev',
    'fastly.jsdelivr.net', 'cdn.statically.io', 'use.fontawesome.com', 'fonts.googleapis.com',
    'fonts.gstatic.com', 'polyfill.io', 'akamai.com', 'akamaized.net', 'fastly.com', 'bunny.net',
    'b-cdn.net', 'kxcdn.com', 'jsdelivr.net',
  ]],
  ['Big sites (web baseline)', false, 'https', [
    'wikipedia.org', 'en.wikipedia.org', 'github.com', 'raw.githubusercontent.com', 'api.github.com',
    'bing.com', 'duckduckgo.com', 'reddit.com', 'microsoft.com', 'amazon.com', 'facebook.com',
    'instagram.com', 'x.com', 'twitter.com', 'cloudfront.net', 'stackoverflow.com', 'yahoo.com',
    'baidu.com', 'fast.com', 'speedtest.net', 'netflix.com', 'office.com', 'live.com', 'bing.net',
  ]],
  ['Your infrastructure (channels ⭐)', true, 'https', [
    'remote.agentdomains.co', 'scriptly.workers.dev', 'greatneck.workers.dev',
    'messages.scriptly.workers.dev', 'fidgettrack.greatneck.workers.dev', 'studento.greatneck.workers.dev',
    'classroom-sync.greatneck.workers.dev', 'classroom-bot.greatneck.workers.dev',
    'aichat-proxy.greatneck.workers.dev', 'soly-works.scriptly.workers.dev', 'motordex.pages.dev',
    'trip-manifest.pages.dev', 'geometry-hq.pages.dev', 'photo3d.pages.dev', 'dadpc.pages.dev',
    'remote-control-3jx.pages.dev', 'beam-gateway.pages.dev', 'storage.googleapis.com',
    'commondatastorage.googleapis.com', 'script.google.com',
  ]],
];

export function buildProbes() {
  const out = [];
  let n = 0;
  const add = (name, cat, type, url, channel) => {
    const full = type === 'wss' ? url : (url.startsWith('http') ? url : 'https://' + url + '/');
    out.push({ id: 'p' + (n++), name, cat, type, url: full, channel: !!channel });
  };

  for (const [cat, channel, type, hosts] of GROUPS) {
    for (const h of hosts) add(type === 'wss' ? h.replace(/^wss:\/\//, '') : h, cat, type, h, channel);
  }

  // AWS: region x service — each a distinct host / IP range (+ S3 dualstack).
  for (const r of AWS_REGIONS) {
    for (const s of AWS_SERVICES) add(`${s}.${r}`, 'AWS (channels ⭐)', 'https', `${s}.${r}.amazonaws.com`, true);
    add(`s3.dualstack.${r}`, 'AWS (channels ⭐)', 'https', `s3.dualstack.${r}.amazonaws.com`, true);
  }
  for (const h of ['aws.amazon.com', 'console.aws.amazon.com', 'd1.awsstatic.com', 'cloudfront.net', 'amazonaws.com', 'iot.amazonaws.com'])
    add(h, 'AWS (channels ⭐)', 'https', h, true);

  // Azure: regional cloudapp + batch + a global set.
  for (const r of AZURE_REGIONS) {
    add(`${r}.cloudapp.azure.com`, 'Azure (channels ⭐)', 'https', `${r}.cloudapp.azure.com`, true);
    add(`${r}.batch.azure.com`, 'Azure (channels ⭐)', 'https', `${r}.batch.azure.com`, true);
  }
  for (const h of ['portal.azure.com', 'management.azure.com', 'login.microsoftonline.com', 'graph.microsoft.com',
    'azure.microsoft.com', 'azurewebsites.net', 'blob.core.windows.net', 'queue.core.windows.net',
    'servicebus.windows.net', 'azure-devices.net', 'azureedge.net', 'signalr.net', 'web.pubsub.azure.com',
    'database.windows.net', 'cognitiveservices.azure.com'])
    add(h, 'Azure (channels ⭐)', 'https', h, true);

  // GCP extras
  for (const h of ['compute.googleapis.com', 'pubsub.googleapis.com', 'cloudtasks.googleapis.com',
    'run.googleapis.com', 'realtimedatabase.googleapis.com', 'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com', 'bigquery.googleapis.com'])
    add(h, 'GCP (channels ⭐)', 'https', h, true);

  // Other clouds: object storage per region = distinct hosts.
  for (const r of ORACLE_REGIONS) add(`objectstorage.${r}`, 'Oracle Cloud', 'https', `objectstorage.${r}.oraclecloud.com`, true);
  for (const r of DO_REGIONS) add(`${r}.digitaloceanspaces.com`, 'DigitalOcean', 'https', `${r}.digitaloceanspaces.com`, true);
  for (const r of LINODE_REGIONS) add(`${r}.linodeobjects.com`, 'Linode', 'https', `${r}.linodeobjects.com`, true);
  for (const r of VULTR_REGIONS) add(`${r}.vultrobjects.com`, 'Vultr', 'https', `${r}.vultrobjects.com`, true);
  for (const r of WASABI_REGIONS) add(`s3.${r}.wasabisys.com`, 'Wasabi', 'https', `s3.${r}.wasabisys.com`, true);

  // Pusher clusters
  for (const c of PUSHER_CLUSTERS) {
    add(`ws-${c}.pusher.com`, 'Pusher (channels ⭐)', 'wss', `wss://ws-${c}.pusher.com/app/demo`, true);
    add(`sockjs-${c}.pusher.com`, 'Pusher (channels ⭐)', 'https', `sockjs-${c}.pusher.com`, true);
  }

  return out;
}

export const PROBE_COUNT_HINT = buildProbes().length;
