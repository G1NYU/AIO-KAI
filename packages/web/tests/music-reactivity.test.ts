import { describe, expect, it } from 'vitest';
import { mascotImageInfo, nativeMotionLevel, pcmMotionLevel, parsePlayerVisuals, MAX_MASCOT_BYTES } from '../src/lib/music/player-visuals';

describe('measured music visuals', () => {
  it('defaults to reactive seek motion with an opt-in mascot and rejects unknown modes', () => {
    expect(parsePlayerVisuals(null)).toEqual({seekMotion:true,mascot:'off'});
    expect(parsePlayerVisuals({seekMotion:false,mascot:'custom'})).toEqual({seekMotion:false,mascot:'custom'});
    expect(parsePlayerVisuals({seekMotion:'false',mascot:'remote'})).toEqual({seekMotion:true,mascot:'off'});
  });
  it('rejects stale, future and malformed native samples and bounds valid RMS', () => {
    expect(nativeMotionLevel({level:.8,at:100},749)).toBe(.8);
    expect(nativeMotionLevel({level:.8,at:100},750)).toBe(0);
    expect(nativeMotionLevel({level:.8,at:100},99)).toBe(0);
    expect(nativeMotionLevel({level:NaN,at:100},100)).toBe(0);
    expect(nativeMotionLevel({level:4,at:100},100)).toBe(1);
    expect(nativeMotionLevel({level:-1,at:100},100)).toBe(0);
    expect(nativeMotionLevel(null,100)).toBe(0);
  });
  it('measures actual PCM RMS; silence cannot invent motion', () => {
    expect(pcmMotionLevel(new Uint8Array(16).fill(128))).toBe(0);
    expect(pcmMotionLevel(Uint8Array.of(64,192,64,192))).toBe(.5);
    expect(pcmMotionLevel(Uint8Array.of(0,128))).toBeCloseTo(Math.SQRT1_2);
    expect(pcmMotionLevel(new Uint8Array())).toBe(0);
  });
});

describe('bounded mascot raster headers', () => {
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAHUlEQVR4nGOsqF3FQApgIkn1qIZRDaMaRjWQrAEA4jkBz8UryC4AAAAASUVORK5CYII=','base64'));
  const gif = Uint8Array.from(Buffer.from('R0lGODlhDAAMAIEAAHZcqAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAADAAMAAAIFgABCBxIsKDBgwgTKlzIsKHDhxARBgQAIfkEAQoAAQAsAAAAAAwADACBeMa8AAAAAAAAAAAACBYAAQgcSLCgwYMIEypcyLChw4cQEQYEADs=','base64'));
  it('recognizes PNG and GIF dimensions from bytes rather than the file name', () => {
    expect(mascotImageInfo(png)).toEqual({type:'image/png',width:16,height:24});
    expect(mascotImageInfo(gif)).toEqual({type:'image/gif',width:12,height:12});
  });
  it('recognizes extended and lossless WebP dimensions with bounded chunks', () => {
    const webp = new Uint8Array(30);
    webp.set(Buffer.from('RIFF'),0); webp.set(Buffer.from('WEBPVP8X'),8);
    const view = new DataView(webp.buffer);
    view.setUint32(4,22,true);view.setUint32(16,10,true);webp[24]=31;webp[27]=47;
    expect(mascotImageInfo(webp)).toEqual({type:'image/webp',width:32,height:48});
    webp.set(Buffer.from('VP8L'),12);view.setUint32(16,10,true);webp[20]=47;
    view.setUint32(21, (47<<14)|31,true);
    expect(mascotImageInfo(webp)).toEqual({type:'image/webp',width:32,height:48});
    view.setUint32(4,99,true);
    expect(mascotImageInfo(webp)).toBeNull();
  });
  it('rejects oversized, zero-sized and spoofed images before decoding', () => {
    const huge = png.slice();new DataView(huge.buffer).setUint32(16,100000);
    expect(mascotImageInfo(huge)).toBeNull();
    const zero = gif.slice();zero[6]=zero[7]=0;
    expect(mascotImageInfo(zero)).toBeNull();
    expect(mascotImageInfo(new Uint8Array(MAX_MASCOT_BYTES+1))).toBeNull();
    expect(mascotImageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(mascotImageInfo(png.slice(0,20))).toBeNull();
  });
});
