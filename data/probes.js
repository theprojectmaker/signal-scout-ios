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

// ======================= EXPANSION: ~5000 more real endpoints =======================
// Same compact-table idea, generated at runtime. On an Apple-only locked network almost all of these
// are expected to be BLOCKED — the point is to empirically surface ANY host that unexpectedly answers
// (a CDN edge, a cloud region, a push/relay host) that could carry a faster control channel.

// AWS has ~200 services with regional endpoints (<service>.<region>.amazonaws.com). Non-existent
// combos just NXDOMAIN (fast-fail), so a wide matrix is cheap to probe.
const AWS_SERVICES2 = [
  'acm', 'acm-pca', 'airflow', 'amplify', 'amplifybackend', 'apprunner', 'appstream2', 'appflow',
  'application-autoscaling', 'appmesh', 'aps', 'athena', 'auditmanager', 'autoscaling-plans', 'backup',
  'batch', 'braket', 'cassandra', 'ce', 'cloud9', 'cloudcontrolapi', 'clouddirectory', 'cloudformation',
  'cloudhsmv2', 'cloudsearch', 'cloudtrail', 'codeartifact', 'codebuild', 'codecommit', 'codedeploy',
  'codepipeline', 'codestar-connections', 'cognito-sync', 'comprehend', 'comprehendmedical', 'config',
  'connect', 'controltower', 'databrew', 'dataexchange', 'datapipeline', 'datasync', 'dax', 'detective',
  'devicefarm', 'devops-guru', 'directconnect', 'dlm', 'dms', 'docdb', 'drs', 'ds', 'ebs', 'ec2messages',
  'ecr', 'ecs', 'eks', 'elasticbeanstalk', 'elasticfilesystem', 'elasticloadbalancing', 'elasticmapreduce',
  'email', 'emr-containers', 'emr-serverless', 'es', 'evidently', 'finspace', 'firehose', 'fis', 'fms',
  'forecast', 'frauddetector', 'fsx', 'gamelift', 'glacier', 'glue', 'grafana', 'greengrass',
  'groundstation', 'guardduty', 'health', 'healthlake', 'identitystore', 'imagebuilder', 'inspector2',
  'iotanalytics', 'iotevents', 'iotsitewise', 'iotwireless', 'ivs', 'ivschat', 'kafka', 'kafkaconnect',
  'kendra', 'kinesisanalytics', 'kinesisvideo', 'lakeformation', 'lex', 'license-manager', 'lightsail',
  'logs', 'lookoutmetrics', 'lookoutvision', 'm2', 'macie2', 'managedblockchain', 'mediaconnect',
  'mediaconvert', 'medialive', 'mediapackage', 'mediastore', 'mediatailor', 'memorydb', 'mgn', 'mobile',
  'mq', 'mturk-requester', 'network-firewall', 'networkmanager', 'oam', 'oidc', 'opsworks', 'outposts',
  'panorama', 'personalize', 'pi', 'pinpoint', 'polly', 'pricing', 'profile', 'proton', 'qldb',
  'quicksight', 'ram', 'rbin', 'rds-data', 'redshift', 'redshift-serverless', 'rekognition', 'resiliencehub',
  'resource-groups', 'robomaker', 'rolesanywhere', 'route53-recovery-control-config', 'route53resolver',
  'rum', 's3-control', 'sagemaker', 'sagemaker-runtime', 'scheduler', 'schemas', 'sdb', 'securityhub',
  'serverlessrepo', 'servicecatalog', 'servicediscovery', 'shield', 'signer', 'sms', 'snowball',
  'ssm-contacts', 'ssm-incidents', 'sso', 'storagegateway', 'swf', 'synthetics', 'textract', 'timestream',
  'transcribe', 'transfer', 'translate', 'voiceid', 'waf-regional', 'wafv2', 'wellarchitected', 'wisdom',
  'workdocs', 'workmail', 'workspaces', 'workspaces-web', 'xray',
];
const AWS_S3_VARIANTS = ['s3-website', 's3-accesspoint', 's3-fips', 's3-object-lambda', 's3-control'];
// <name>.googleapis.com — Google exposes hundreds; a representative ~170.
const GOOGLE_APIS = [
  'translate', 'vision', 'speech', 'texttospeech', 'language', 'documentai', 'videointelligence',
  'dialogflow', 'maps', 'places', 'geocoding', 'routes', 'roads', 'timezone', 'elevation', 'youtube',
  'youtubeanalytics', 'youtubereporting', 'drive', 'sheets', 'slides', 'docs', 'calendar', 'gmail',
  'people', 'contacts', 'admin', 'cloudidentity', 'cloudresourcemanager', 'iam', 'iamcredentials',
  'serviceusage', 'servicecontrol', 'servicemanagement', 'servicenetworking', 'storage', 'storagetransfer',
  'bigquery', 'bigquerystorage', 'bigqueryconnection', 'bigquerydatatransfer', 'bigqueryreservation',
  'dataflow', 'dataproc', 'composer', 'datafusion', 'datacatalog', 'datalineage', 'dataplex', 'spanner',
  'datastore', 'firestore', 'redis', 'memcache', 'sqladmin', 'alloydb', 'bigtableadmin', 'bigtable',
  'cloudkms', 'secretmanager', 'certificatemanager', 'privateca', 'dns', 'domains', 'networkservices',
  'networkconnectivity', 'networksecurity', 'compute', 'container', 'gkehub', 'gkeconnect', 'gkemulticloud',
  'artifactregistry', 'containerregistry', 'cloudbuild', 'clouddeploy', 'eventarc', 'workflows',
  'workflowexecutions', 'cloudscheduler', 'cloudtasks', 'cloudfunctions', 'appengine', 'apigateway',
  'apigee', 'endpoints', 'servicedirectory', 'monitoring', 'logging', 'clouderrorreporting', 'cloudtrace',
  'cloudprofiler', 'billingbudgets', 'cloudbilling', 'recommender', 'orgpolicy', 'accesscontextmanager',
  'binaryauthorization', 'containeranalysis', 'ondemandscanning', 'websecurityscanner', 'cloudasset',
  'policytroubleshooter', 'essentialcontacts', 'chat', 'meet', 'forms', 'keep', 'tasks', 'classroom',
  'licensing', 'reseller', 'groupssettings', 'groupsmigration', 'gamesmanagement', 'games',
  'androidpublisher', 'androidmanagement', 'androiddeviceprovisioning', 'playintegrity', 'playcustomapp',
  'fcm', 'fcmdata', 'firebaseml', 'firebasehosting', 'firebasestorage', 'firebasedatabase',
  'firebasedynamiclinks', 'firebaseappcheck', 'firebaseappdistribution', 'firebaseremoteconfig',
  'firebaseinstallations', 'firebaserules', 'testing', 'toolresults', 'identitytoolkit', 'securetoken',
  'recaptchaenterprise', 'webrisk', 'safebrowsing', 'customsearch', 'knowledgegraph', 'factchecktools',
  'analyticsreporting', 'analyticsdata', 'analyticsadmin', 'tagmanager', 'searchconsole', 'indexing',
  'blogger', 'books', 'photoslibrary', 'fitness', 'tasks', 'script', 'apps-apis', 'workstations',
  'run', 'vpcaccess', 'cloudshell', 'file', 'baremetalsolution', 'vmmigration', 'migrationcenter',
  'batch', 'notebooks', 'aiplatform', 'generativelanguage', 'ml', 'automl', 'discoveryengine', 'retail',
  'recommendationengine', 'contactcenterinsights', 'cloudsupport', 'connectors', 'integrations',
];
const GOOGLE_EXTRA = [
  'clients3.google.com', 'clients4.google.com', 'clients6.google.com', 'www.googleadservices.com',
  'content-autofill.googleapis.com', 'android.googleapis.com', 'android.clients.google.com',
  'mtalk.google.com', 'alt1-mtalk.google.com', 'play.google.com', 'play.googleapis.com',
  'update.googleapis.com', 'redirector.gvt1.com', 'www.gstatic.com', 'ssl.gstatic.com',
  'connectivitycheck.gstatic.com', 'gvt1.com', 'gvt2.com', 'notifications.google.com',
  'chromewebstore.google.com', 'safebrowsing.googleapis.com', 'inbox.google.com', 'hangouts.google.com',
  'meet.google.com', 'chat.google.com', 'currents.google.com', 'tasks.google.com', 'keep.google.com',
];
const ALIBABA_OSS = ['cn-hangzhou', 'cn-shanghai', 'cn-qingdao', 'cn-beijing', 'cn-zhangjiakou', 'cn-huhehaote', 'cn-wulanchabu', 'cn-shenzhen', 'cn-heyuan', 'cn-guangzhou', 'cn-chengdu', 'cn-hongkong', 'us-west-1', 'us-east-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3', 'ap-southeast-5', 'ap-southeast-6', 'ap-southeast-7', 'ap-south-1', 'ap-northeast-1', 'ap-northeast-2', 'eu-central-1', 'eu-west-1', 'me-east-1'];
const TENCENT_COS = ['ap-beijing', 'ap-nanjing', 'ap-shanghai', 'ap-guangzhou', 'ap-chengdu', 'ap-chongqing', 'ap-shenzhen-fsi', 'ap-hongkong', 'ap-singapore', 'ap-mumbai', 'ap-jakarta', 'ap-seoul', 'ap-bangkok', 'ap-tokyo', 'na-siliconvalley', 'na-ashburn', 'na-toronto', 'sa-saopaulo', 'eu-frankfurt', 'eu-moscow'];
const IBM_COS = ['us-south', 'us-east', 'us-geo', 'eu-gb', 'eu-de', 'eu-geo', 'ap-geo', 'jp-tok', 'au-syd', 'ca-tor', 'br-sao', 'jp-osa'];
const B2_REGIONS = ['us-west-000', 'us-west-001', 'us-west-002', 'us-west-004', 'eu-central-003'];
const SCW_REGIONS = ['fr-par', 'nl-ams', 'pl-waw'];
const OTHER_OBJ = [
  ['Exoscale', 'sos-ch-gva-2.exo.io'], ['Exoscale', 'sos-ch-dk-2.exo.io'], ['Exoscale', 'sos-de-fra-1.exo.io'],
  ['Exoscale', 'sos-at-vie-1.exo.io'], ['Exoscale', 'sos-bg-sof-1.exo.io'], ['OVH', 's3.gra.io.cloud.ovh.net'],
  ['OVH', 's3.sbg.io.cloud.ovh.net'], ['OVH', 's3.rbx.io.cloud.ovh.net'], ['OVH', 's3.de.io.cloud.ovh.net'],
  ['UpCloud', 'fi-hel1.upcloudobjects.com'], ['UpCloud', 'de-fra1.upcloudobjects.com'],
  ['Cloudflare R2', 'r2.cloudflarestorage.com'], ['Storj', 'gateway.storjshare.io'],
  ['Filebase', 's3.filebase.com'], ['iDrive e2', 'edge.c8-1.idrivee2-14.com'], ['Tigris', 'fly.storage.tigris.dev'],
];

// Big curated channel/baseline groups (added to the original GROUPS).
const GROUPS2 = [
  ['Messaging & push (more, channels ⭐)', true, 'https', [
    'api.telegram.org', 'bot.telegram.org', 'venus.telegram.org', 'pluto.telegram.org', 'flora.telegram.org',
    'api.kik.com', 'api.viber.com', 'chatapi.viber.com', 'api.imgur.com', 'api.vk.com', 'api.ok.ru',
    'api.weixin.qq.com', 'qyapi.weixin.qq.com', 'open.feishu.cn', 'oapi.dingtalk.com', 'api.mattermost.com',
    'api.rocket.chat', 'api.zulip.com', 'api.flock.com', 'api.chanify.net', 'api.day.app', 'bark.day.app',
    'api.pushdeer.com', 'wxpusher.zjiecode.com', 'sc.ftqq.com', 'sctapi.ftqq.com', 'api.ifttt.com',
    'maker.ifttt.com', 'hooks.zapier.com', 'api.make.com', 'hook.us1.make.com', 'hook.eu1.make.com',
    'api.pagerduty.com', 'events.pagerduty.com', 'api.opsgenie.com', 'api.eu.opsgenie.com',
    'api.pushe.co', 'fcm.googleapis.com', 'android.googleapis.com', 'api.airship.com', 'wallet.airship.com',
    'api.batch.com', 'api.courier.com', 'api.knock.app', 'api.novu.co', 'api.magicbell.com',
    'api.engagespot.co', 'api.suprsend.com', 'api.notificationapi.com',
  ]],
  ['Realtime / pub-sub (more, channels ⭐)', true, 'https', [
    'api.pusher.com', 'sockjs.pusher.com', 'rest.ably.io', 'realtime.ably.io', 'ps.pndsn.com',
    'pubsub.pubnub.com', 'realtime.supabase.co', 'wss.centrifugal.dev', 'api.liveblocks.io',
    'api.tinybird.co', 'api.getstream.io', 'chat.stream-io-api.com', 'video.stream-io-api.com',
    'api.100ms.live', 'prod-in2.100ms.live', 'api.dyte.io', 'api.daily.co', 'api.agora.io',
    'api.sendbird.com', 'api-us-1.sendbird.com', 'api.cometchat.io', 'api.talkjs.com', 'api.pusher.io',
    'api.diffusiondata.com', 'api.lightstreamer.com', 'push.lightstreamer.com', 'api.deepstream.io',
    'api.scaledrone.com', 'api.fanout.io', 'api.pushpin.org', 'api.soketi.app', 'api.topic.dev',
    'api.convex.dev', 'api.inngest.com', 'api.upstash.com', 'global.rest.upstash.io', 'api.momentohq.com',
    'api.piesocket.com', 'api.websocket.in', 'api.goeasy.io', 'api.pubnub.com', 'api.cloudamqp.com',
  ]],
  ['Tunnels / mesh / VPN (more, channels ⭐)', true, 'https', [
    'api.ngrok.com', 'connect.ngrok-agent.com', 'tunnel.pyjam.as', 'api.cloudflare.com', 'try.cloudflare.com',
    'api.tailscale.com', 'controlplane.tailscale.com', 'log.tailscale.io', 'api.zerotier.com',
    'my.zerotier.com', 'api.netbird.io', 'api.netmaker.io', 'api.defined.net', 'api.twingate.com',
    'api.pomerium.com', 'api.boundary.hashicorp.com', 'api.openziti.io', 'api.nord.com', 'api.mullvad.net',
    'api.protonvpn.ch', 'api.windscribe.com', 'api.wireguard.com', 'api.innernet.rs', 'api.firezone.dev',
    'api.perimeter81.com', 'api.cloudflareaccess.com', 'api.teleport.sh', 'api.gravitational.com',
    'relay1.rendezvous.magic-wormhole.io', 'api.tunnel.dev', 'api.beeceptor.com', 'api.requestbin.com',
    'api.hookbin.com', 'api.webhook.site', 'webhook.site', 'api.pipedream.com', 'api.val.town',
  ]],
  ['STUN/TURN over TLS (channels ⭐)', true, 'https', [
    'relay.metered.ca', 'openrelay.metered.ca', 'global.turn.twilio.com', 'global.relay.metered.ca',
    'a.relay.metered.ca', 'turn.cloudflare.com', 'rtc.live.cloudflare.com', 'api.xirsys.com',
    'global.xirsys.net', 'turn.anyfirewall.com', 'turn.bistri.com', 'webrtc.free-solutions.org',
    'turn.goog', 'stun.cloudflare.com', 'turn.nextcloud.com', 'freestun.net', 'eu-turn4.xirsys.com',
    'us-turn4.xirsys.com', 'turn01.hubl.in', 'numb.viagenie.ca', 'turn.matrix.org', 'turn.ekiga.net',
  ]],
  ['DNS-over-HTTPS (more, channels ⭐)', true, 'https', [
    'dns.google', 'cloudflare-dns.com', 'mozilla.cloudflare-dns.com', 'security.cloudflare-dns.com',
    'family.cloudflare-dns.com', 'dns.quad9.net', 'dns9.quad9.net', 'dns10.quad9.net', 'dns11.quad9.net',
    'doh.opendns.com', 'doh.familyshield.opendns.com', 'dns.nextdns.io', 'anycast.dns.nextdns.io',
    'doh.cleanbrowsing.org', 'doh.dns.sb', 'dns.adguard-dns.com', 'dns-unfiltered.adguard.com',
    'doh.mullvad.net', 'adblock.doh.mullvad.net', 'doh.libredns.gr', 'doh.pub', 'dns.alidns.com',
    'doh.360.cn', 'odvr.nic.cz', 'dns.switch.ch', 'dns.digitale-gesellschaft.ch', 'doh.ffmuc.net',
    'dnsforge.de', 'fdns1.dismail.de', 'dns.decloudus.com', 'doh.tiar.app', 'jp.tiar.app',
    'dns.controld.com', 'freedns.controld.com', 'doh.applied-privacy.net', 'resolver.gnutls.org',
    'kaitain.restena.lu', 'doh.seby.io', 'dns.flatuslifir.is', 'doh-de.blahdns.com', 'doh-jp.blahdns.com',
  ]],
  ['MQTT over WSS (more, channels ⭐)', true, 'wss', [
    'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081', 'wss://broker.emqx.io:8084/mqtt',
    'wss://mqtt.eclipseprojects.io:443/mqtt', 'wss://public.cloud.shiftr.io', 'wss://broker.mqttdashboard.com:8884/mqtt',
    'wss://mqtt.flespi.io', 'wss://mqtt-dashboard.com:8884/mqtt', 'wss://mqtt.swifitch.cz:9001',
    'wss://ws.coreflux.cloud:8084/mqtt', 'wss://broker.hivemq.com:8000/mqtt', 'wss://test.mosquitto.org:8091',
  ]],
  ['Hosting / PaaS (more, channels ⭐)', true, 'https', [
    'api.vercel.com', 'api.netlify.com', 'api.render.com', 'backboard.railway.app', 'api.fly.io',
    'api.machines.dev', 'api.koyeb.com', 'api.deno.com', 'dash.deno.com', 'api.val.town', 'api.replit.com',
    'api.glitch.com', 'api.cyclic.sh', 'api.adaptable.io', 'api.northflank.com', 'api.zeabur.com',
    'api.sevalla.com', 'api.platform.sh', 'api.scalingo.com', 'api.clever-cloud.com', 'api.dokku.com',
    'api.coolify.io', 'api.caprover.com', 'api.porter.run', 'api.qovery.com', 'api.aptible.com',
    'api.digitalocean.com', 'api.linode.com', 'api.vultr.com', 'api.hetzner.cloud', 'api.scaleway.com',
    'api.upcloud.com', 'api.civo.com', 'api.exoscale.com', 'api.ovh.com', 'api.gandi.net',
  ]],
  ['SaaS & dev APIs (web baseline)', false, 'https', [
    'api.stripe.com', 'api.github.com', 'api.gitlab.com', 'bitbucket.org', 'api.bitbucket.org',
    'api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com', 'api.cohere.ai',
    'api.mistral.ai', 'api.groq.com', 'api.together.xyz', 'api.replicate.com', 'api.huggingface.co',
    'api.notion.com', 'api.airtable.com', 'api.figma.com', 'api.linear.app', 'api.asana.com',
    'api.trello.com', 'api.monday.com', 'api.clickup.com', 'api.todoist.com', 'api.dropbox.com',
    'content.dropboxapi.com', 'api.box.com', 'api.onedrive.com', 'api.pcloud.com', 'api.mega.co.nz',
    'api.spotify.com', 'accounts.spotify.com', 'api.soundcloud.com', 'api.vimeo.com', 'api.twitch.tv',
    'api.unsplash.com', 'api.giphy.com', 'api.tenor.com', 'api.pexels.com', 'api.cloudinary.com',
    'api.imgbb.com', 'api.imagekit.io', 'api.bannerbear.com', 'api.deepl.com', 'api2.deepl.com',
    'api.wit.ai', 'api.assemblyai.com', 'api.deepgram.com', 'api.elevenlabs.io', 'api.play.ht',
    'api.algolia.net', 'api.meilisearch.com', 'api.typesense.net', 'api.pinecone.io', 'api.weaviate.io',
    'api.qdrant.tech', 'api.redis.com', 'api.mongodb.com', 'data.mongodb-api.com', 'api.planetscale.com',
    'api.neon.tech', 'api.cockroachlabs.cloud', 'api.fauna.com', 'db.fauna.com', 'api.xata.io',
    'api.turso.tech', 'api.nhost.io', 'api.appwrite.io', 'cloud.appwrite.io', 'api.pocketbase.io',
    'api.directus.io', 'api.strapi.io', 'api.contentful.com', 'cdn.contentful.com', 'api.sanity.io',
    'api.prismic.io', 'api.storyblok.com', 'api.hygraph.com', 'api.datocms.com', 'graphql.datocms.com',
    'api.segment.io', 'api.mixpanel.com', 'api.amplitude.com', 'api.posthog.com', 'app.posthog.com',
    'api.sentry.io', 'api.bugsnag.com', 'api.rollbar.com', 'api.datadoghq.com', 'http-intake.logs.datadoghq.com',
    'api.newrelic.com', 'api.honeycomb.io', 'api.logz.io', 'api.loggly.com', 'api.papertrailapp.com',
    'api.cloudflare.com', 'api.fastly.com', 'api.bunny.net', 'api.keycdn.com', 'api.stackpath.com',
    'api.twilio.com', 'api.vonage.com', 'rest.nexmo.com', 'api.plivo.com', 'api.bandwidth.com',
    'api.sinch.com', 'api.messagebird.com', 'rest.messagebird.com', 'api.telnyx.com', 'api.infobip.com',
    'api.clicksend.com', 'api.46elks.com', 'api.smsapi.com', 'api.mailjet.com', 'api.sparkpost.com',
    'api.elasticemail.com', 'api.mailersend.com', 'api.brevo.com', 'api.sendinblue.com',
  ]],
  ['Top sites (web baseline)', false, 'https', [
    'google.com', 'youtube.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'tiktok.com',
    'wikipedia.org', 'reddit.com', 'amazon.com', 'linkedin.com', 'netflix.com', 'microsoft.com',
    'office.com', 'live.com', 'bing.com', 'yahoo.com', 'duckduckgo.com', 'pinterest.com', 'tumblr.com',
    'twitch.tv', 'ebay.com', 'walmart.com', 'target.com', 'bestbuy.com', 'etsy.com', 'shopify.com',
    'paypal.com', 'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'cnn.com', 'bbc.com', 'bbc.co.uk',
    'nytimes.com', 'theguardian.com', 'forbes.com', 'bloomberg.com', 'wsj.com', 'espn.com', 'nba.com',
    'nfl.com', 'imdb.com', 'rottentomatoes.com', 'spotify.com', 'soundcloud.com', 'vimeo.com',
    'dailymotion.com', 'quora.com', 'medium.com', 'wordpress.com', 'blogger.com', 'wix.com',
    'squarespace.com', 'godaddy.com', 'namecheap.com', 'cloudflare.com', 'adobe.com', 'apple.com',
    'zoom.us', 'slack.com', 'discord.com', 'telegram.org', 'whatsapp.com', 'messenger.com', 'snapchat.com',
    'weather.com', 'accuweather.com', 'coinbase.com', 'binance.com', 'kraken.com', 'robinhood.com',
    'tradingview.com', 'yahoo.co.jp', 'baidu.com', 'qq.com', 'taobao.com', 'tmall.com', 'jd.com',
    'aliexpress.com', 'weibo.com', 'bilibili.com', 'douyin.com', 'naver.com', 'daum.net', 'yandex.com',
    'yandex.ru', 'mail.ru', 'vk.com', 'ok.ru', 'rakuten.co.jp', 'amazon.co.jp', 'flipkart.com',
    'samsung.com', 'intel.com', 'nvidia.com', 'amd.com', 'ibm.com', 'oracle.com', 'salesforce.com',
    'sap.com', 'dell.com', 'hp.com', 'lenovo.com', 'cisco.com', 'vmware.com', 'redhat.com', 'canonical.com',
    'mozilla.org', 'archive.org', 'wikimedia.org', 'wiktionary.org', 'wikihow.com', 'stackexchange.com',
    'serverfault.com', 'superuser.com', 'gitlab.com', 'sourceforge.net', 'npmjs.com', 'pypi.org',
    'rubygems.org', 'packagist.org', 'crates.io', 'nuget.org', 'maven.apache.org', 'docker.com',
    'hub.docker.com', 'quay.io', 'ghcr.io', 'registry.npmjs.org', 'files.pythonhosted.org',
  ]],
  ['CDN edges & mirrors (web baseline)', false, 'https', [
    'cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'gcore.jsdelivr.net', 'testingcf.jsdelivr.net', 'unpkg.com',
    'cdnjs.cloudflare.com', 'ajax.googleapis.com', 'ajax.aspnetcdn.com', 'stackpath.bootstrapcdn.com',
    'maxcdn.bootstrapcdn.com', 'netdna.bootstrapcdn.com', 'code.jquery.com', 'esm.sh', 'cdn.skypack.dev',
    'ga.jspm.io', 'jspm.dev', 'cdn.statically.io', 'use.fontawesome.com', 'kit.fontawesome.com',
    'fonts.googleapis.com', 'fonts.gstatic.com', 'use.typekit.net', 'p.typekit.net', 'fast.fonts.net',
    'polyfill.io', 'cdnjs.com', 'cdn.rawgit.com', 'rawcdn.githack.com', 'cdn.bootcss.com', 'lib.baomitu.com',
    'cdn.staticfile.org', 'g.alicdn.com', 'at.alicdn.com', 'cdn.datatables.net', 'cdn.plot.ly',
    'cdn.ckeditor.com', 'cdn.quilljs.com', 'cdn.tiny.cloud', 'cdn.ampproject.org', 'cdn.shopify.com',
    'cdn.sanity.io', 'images.unsplash.com', 'i.imgur.com', 'media.giphy.com', 'res.cloudinary.com',
    'ik.imagekit.io', 'imagedelivery.net', 'cdn.discordapp.com', 'media.discordapp.net', 'pbs.twimg.com',
    'abs.twimg.com', 'scontent.cdninstagram.com', 'static.xx.fbcdn.net', 'yt3.ggpht.com', 'i.ytimg.com',
    's.yimg.com', 'cdn.akamai.steamstatic.com', 'steamcdn-a.akamaihd.net', 'd1.awsstatic.com',
    'd3js.org', 'threejs.org', 'raw.githack.com', 'bunny.net', 'b-cdn.net', 'kxcdn.com', 'cdn77.org',
    'edgecdn.net', 'cachefly.net', 'llnwd.net', 'fastly.net', 'fastlylb.net', 'edgekey.net',
    'edgesuite.net', 'akamaiedge.net', 'akamaized.net', 'akamaihd.net', 'akamaitechnologies.com',
    'cloudfront.net', 'azureedge.net', 'azurefd.net', 'gcorelabs.com', 'gcdn.co', 'cdninstagram.com',
  ]],
  ['Public DNS & NTP (web baseline)', false, 'https', [
    'one.one.one.one', '1.1.1.1', '8.8.8.8', '8.8.4.4', '9.9.9.9', 'dns.google', 'time.cloudflare.com',
    'time.google.com', 'time.windows.com', 'time.nist.gov', 'pool.ntp.org', 'time.apple.com',
    'ntp.ubuntu.com', 'time.facebook.com', 'time.aws.com', 'ntp.aliyun.com', 'ntp.tencent.com',
  ]],
  ['Universities & big mirrors (web baseline)', false, 'https', [
    'mit.edu', 'stanford.edu', 'harvard.edu', 'berkeley.edu', 'cmu.edu', 'ox.ac.uk', 'cam.ac.uk',
    'ethz.ch', 'mirror.csclub.uwaterloo.ca', 'mirrors.kernel.org', 'mirror.rackspace.com',
    'mirrors.mit.edu', 'ftp.gnu.org', 'ftp.debian.org', 'deb.debian.org', 'archive.ubuntu.com',
    'security.ubuntu.com', 'dl.fedoraproject.org', 'download.opensuse.org', 'mirrors.edge.kernel.org',
    'cdn.kernel.org', 'repo.anaconda.com', 'conda.anaconda.org', 'download.docker.com', 'apt.llvm.org',
    'dl.google.com', 'storage.googleapis.com', 'developer.mozilla.org', 'releases.ubuntu.com',
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

  // ===== EXPANSION (~5000 more) =====
  for (const [cat, channel, type, hosts] of GROUPS2) {
    for (const h of hosts) add(type === 'wss' ? h.replace(/^wss:\/\//, '') : h, cat, type, h, channel);
  }
  // AWS: many more services × regions (+ S3 variants). Non-existent combos just NXDOMAIN (fast-fail).
  for (const r of AWS_REGIONS) {
    for (const svc of AWS_SERVICES2) add(`${svc}.${r}`, 'AWS extra (channels ⭐)', 'https', `${svc}.${r}.amazonaws.com`, true);
    for (const v of AWS_S3_VARIANTS) add(`${v}.${r}`, 'AWS S3 (channels ⭐)', 'https', `${v}.${r}.amazonaws.com`, true);
  }
  // Google APIs — <name>.googleapis.com (+ extra Google hosts)
  for (const g of GOOGLE_APIS) add(`${g}.googleapis.com`, 'Google APIs (channels ⭐)', 'https', `${g}.googleapis.com`, true);
  for (const h of GOOGLE_EXTRA) add(h, 'Google extra', 'https', h, true);
  // Object storage across more clouds — each region is a distinct host.
  for (const r of ALIBABA_OSS) add(`oss-${r}`, 'Alibaba OSS (channels ⭐)', 'https', `oss-${r}.aliyuncs.com`, true);
  for (const r of TENCENT_COS) add(`cos.${r}`, 'Tencent COS (channels ⭐)', 'https', `cos.${r}.myqcloud.com`, true);
  for (const r of IBM_COS) add(`s3.${r}`, 'IBM COS (channels ⭐)', 'https', `s3.${r}.cloud-object-storage.appdomain.cloud`, true);
  for (const r of B2_REGIONS) add(`s3.${r}`, 'Backblaze B2 (channels ⭐)', 'https', `s3.${r}.backblazeb2.com`, true);
  for (const r of SCW_REGIONS) add(`s3.${r}.scw.cloud`, 'Scaleway (channels ⭐)', 'https', `s3.${r}.scw.cloud`, true);
  for (const [name, host] of OTHER_OBJ) add(host, `${name} (channels ⭐)`, 'https', host, true);

  return out;
}

export const PROBE_COUNT_HINT = buildProbes().length;
