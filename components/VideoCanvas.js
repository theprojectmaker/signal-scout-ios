// Video β player: a WebView hosting a <video> fed by MSE (ManagedMediaSource on iOS 17+, MediaSource else).
// The hook reassembles H.264 segments from CloudKit and hands them here through `sinkRef` — we set
// sinkRef.current to a function that injects each segment into the page, where MSE appends it and the
// <video> hardware-decodes. Keeps the player near the live edge so latency stays as low as the link allows.
// No native module → ships as an OTA (react-native-webview is already a dependency).
import React, { useRef, useEffect, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

const PLAYER_HTML = `<!doctype html><html><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;background:#000;height:100%;overflow:hidden}
#v{position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#000}</style></head>
<body><video id=v autoplay muted playsinline webkit-playsinline></video>
<script>
var V=document.getElementById('v'), MS=window.ManagedMediaSource||window.MediaSource, ms=null, sb=null;
var q=[], gen=-1, started=false, MIME='video/mp4; codecs="avc1.42E01E"';
function post(o){ try{ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(o)); }catch(e){} }
function b2u(s){ var bin=atob(s), u=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i); return u; }
function reset(){
  try{ if(sb&&ms&&ms.readyState==='open') ms.removeSourceBuffer(sb); }catch(e){}
  sb=null; q=[]; started=false;
  ms=new MS();
  V.disableRemotePlayback=true;
  if(window.ManagedMediaSource){ V.srcObject=null; try{ V.srcObject=ms; }catch(e){} }
  if(!V.srcObject) V.src=URL.createObjectURL(ms);
  ms.addEventListener('sourceopen', function(){
    try{ if(!(MS&&MS.isTypeSupported&&MS.isTypeSupported(MIME))){ post({t:'err',m:'codec unsupported'});} }catch(e){}
    try{ sb=ms.addSourceBuffer(MIME); }catch(e){ post({t:'err',m:'addSourceBuffer '+e.message}); return; }
    sb.mode='sequence';
    sb.addEventListener('updateend', pump);
    sb.addEventListener('error', function(){ post({t:'err',m:'sourcebuffer'}); });
    post({t:'ready'});
    pump();
  });
  // ManagedMediaSource needs a 'startstreaming'/'endstreaming' dance; appending on sourceopen covers the common path
}
function pump(){
  if(!sb||sb.updating||!ms||ms.readyState!=='open') return;
  // keep near the live edge: if we've buffered too much ahead of playback, jump forward (low latency over smoothness)
  try{ if(V.buffered.length){ var end=V.buffered.end(V.buffered.length-1); if(end-V.currentTime>2.0){ V.currentTime=end-0.4; } } }catch(e){}
  if(q.length){ var seg=q.shift(); try{ sb.appendBuffer(seg); }catch(e){ if(e.name==='QuotaExceededError'){ try{ var s=V.buffered.start(0); sb.remove(s, Math.max(s, V.currentTime-1)); }catch(_){}; q.unshift(seg);} else post({t:'err',m:'append '+e.message}); } }
}
// messages in from RN: {t:'init', g, d} resets the stream with a new init; {t:'seg', d} appends a media segment
function onMsg(raw){
  var m; try{ m=JSON.parse(raw); }catch(e){ return; }
  if(m.t==='init'){ if(m.g!==gen){ gen=m.g; reset(); } setTimeout(function(){ try{ if(sb&&!sb.updating) sb.appendBuffer(b2u(m.d)); else q.unshift(b2u(m.d)); }catch(e){ q.unshift(b2u(m.d)); } }, 30); }
  else if(m.t==='seg'){ q.push(b2u(m.d)); if(q.length>30) q.splice(0,q.length-20); pump(); }
  else if(m.t==='play'){ V.play().catch(function(){}); }
}
document.addEventListener('message', function(e){ onMsg(e.data); });      // iOS
window.addEventListener('message', function(e){ onMsg(e.data); });         // Android/other
V.addEventListener('playing', function(){ post({t:'playing'}); });
V.addEventListener('error', function(){ post({t:'err',m:'video '+(V.error&&V.error.code)}); });
setInterval(function(){ if(V.paused) V.play().catch(function(){}); pump(); }, 500);
post({t:'boot', mms: !!window.ManagedMediaSource, ms: !!window.MediaSource});
</script></body></html>`;

export default function VideoCanvas({ sinkRef, onStat }) {
  const wref = useRef(null);
  const readyRef = useRef(false);
  const pendingRef = useRef([]);     // messages queued before the WebView booted

  const send = useCallback((obj) => {
    const str = JSON.stringify(obj);
    // inject a postMessage-style delivery; large base64 is safe inside a JSON string literal
    const js = `(function(){try{onMsg(${JSON.stringify(str)})}catch(e){}})();true;`;
    if (readyRef.current && wref.current) wref.current.injectJavaScript(js);
    else pendingRef.current.push(js);
  }, []);

  useEffect(() => {
    // expose the sink the hook pushes into
    if (sinkRef) sinkRef.current = send;
    return () => { if (sinkRef && sinkRef.current === send) sinkRef.current = null; };
  }, [sinkRef, send]);

  const onMessage = useCallback((e) => {
    let m; try { m = JSON.parse(e.nativeEvent.data); } catch (err) { return; }
    if (m.t === 'boot' || m.t === 'ready') {
      readyRef.current = true;
      const q = pendingRef.current; pendingRef.current = [];
      for (const js of q) wref.current && wref.current.injectJavaScript(js);
    }
    if (onStat) onStat(m);
  }, [onStat]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <WebView
        ref={wref}
        source={{ html: PLAYER_HTML }}
        originWhitelist={['*']}
        style={{ flex: 1, backgroundColor: '#000' }}
        javaScriptEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        onMessage={onMessage}
        androidLayerType="hardware"
        setSupportMultipleWindows={false}
      />
    </View>
  );
}
