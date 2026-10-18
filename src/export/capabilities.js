import { waitMedia, seekFrame } from '../media/decoder.js';
export async function exportConfig(width, height, bitrate) {
  if (!globalThis.VideoEncoder || !globalThis.AudioEncoder || !globalThis.VideoFrame || !globalThis.AudioData) throw new Error('MP4 export requires WebCodecs video and audio encoding. Try current Chrome or Edge.');
  const audio = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 };
  if (!(await AudioEncoder.isConfigSupported(audio).catch(() => ({}))).supported) throw new Error('AAC encoding is unavailable. This browser cannot produce the supported MP4 audio format.');
  for (const codec of ['avc1.64002a', 'avc1.420028']) {
    const video = { codec, width, height, bitrate, framerate: 30 };
    if ((await VideoEncoder.isConfigSupported(video).catch(() => ({}))).supported) return { video, audio };
  }
  throw new Error('H.264 encoding is unavailable at this resolution. Select a lower export resolution.');
}
export async function verifyExport(blob, expectedDuration) {
  if (blob.size < 32 || String.fromCharCode(...new Uint8Array(await blob.slice(4, 8).arrayBuffer())) !== 'ftyp') throw new Error('The exporter produced an invalid MP4 container.');
  const video = document.createElement('video'); const url = URL.createObjectURL(blob);
  video.muted = true; video.preload = 'auto'; video.src = url;
  try {
    await waitMedia(video);
    if (Math.abs(video.duration - expectedDuration) > 0.3) throw new Error('Export duration verification failed.');
    for (const time of [0, expectedDuration / 2, Math.max(0, expectedDuration - 0.1)]) await seekFrame(video, time);
    return 'MP4 duration and first/middle/final frame decoding checked; audio alignment needs listening review.';
  } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}
