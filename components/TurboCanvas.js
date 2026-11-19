// Draws the Turbo picture in plain React Native (no native module → ships as an OTA update):
//   • the whole-screen PREVIEW stretched over the letterboxed screen area, then
//   • every full-resolution RECTANGLE on top at its exact position (newer ones above older ones).
// Rectangles are memoised, so a typed character re-renders ONE small image, not the screen. Coordinates in the
// view are in the PC frame's own pixel space (view.W × view.H); we scale them to the on-screen letterbox.
import React, { memo } from 'react';
import { View, Image, StyleSheet } from 'react-native';

const Rect = memo(function Rect({ uri, left, top, width, height }) {
  return <Image source={{ uri }} style={{ position: 'absolute', left, top, width, height }} resizeMode="stretch" fadeDuration={0} />;
});

export default function TurboCanvas({ view, boxW, boxH }) {
  if (!view || !view.base || !view.W || !view.H || !boxW || !boxH) return null;
  const sc = Math.min(boxW / view.W, boxH / view.H);
  const dw = view.W * sc, dh = view.H * sc, ox = (boxW - dw) / 2, oy = (boxH - dh) / 2;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={{ position: 'absolute', left: ox, top: oy, width: dw, height: dh, overflow: 'hidden' }}>
        <Image source={{ uri: view.base.uri }} style={{ position: 'absolute', left: 0, top: 0, width: dw, height: dh }} resizeMode="stretch" fadeDuration={0} />
        {view.rects.map((r) => (
          // +0.6px hides hairline seams between neighbouring tiles at fractional scales
          <Rect key={r.id} uri={r.uri} left={r.x * sc} top={r.y * sc} width={r.w * sc + 0.6} height={r.h * sc + 0.6} />
        ))}
      </View>
    </View>
  );
}
