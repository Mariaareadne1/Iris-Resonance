/**
 * Canvas + Web Audio recording with MediaRecorder.
 *
 * The canvas stream carries only the WebGL scene (no interface chrome); the
 * audio track is the instrument's final mix from a
 * MediaStreamAudioDestinationNode. The file extension always matches the
 * container the browser actually produced — WebM is never labelled MP4.
 */
const CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
];

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  extension: 'webm' | 'mp4';
  hasAudio: boolean;
  durationMs: number;
  filename: string;
}

export interface RecorderSupport {
  supported: boolean;
  mimeType: string | null;
  reason?: string;
}

export function recorderSupport(canvas: HTMLCanvasElement): RecorderSupport {
  if (typeof MediaRecorder === 'undefined') {
    return { supported: false, mimeType: null, reason: 'This browser has no MediaRecorder.' };
  }
  if (typeof canvas.captureStream !== 'function') {
    return { supported: false, mimeType: null, reason: 'This browser cannot capture a canvas stream.' };
  }
  const mimeType = CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
  if (!mimeType) return { supported: false, mimeType: null, reason: 'No supported video format.' };
  return { supported: true, mimeType };
}

export class CanvasRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private started = 0;
  private stream: MediaStream | null = null;
  private hasAudio = false;

  get isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }

  /** Start recording. `audio` may be null (video-only, reported honestly). */
  start(canvas: HTMLCanvasElement, audio: MediaStream | null, fps = 60): RecorderSupport & { hasAudio: boolean } {
    const support = recorderSupport(canvas);
    if (!support.supported || !support.mimeType) return { ...support, hasAudio: false };
    const video = canvas.captureStream(fps);
    const tracks: MediaStreamTrack[] = [...video.getVideoTracks()];
    const audioTracks = audio?.getAudioTracks() ?? [];
    tracks.push(...audioTracks);
    this.hasAudio = audioTracks.length > 0;
    let mimeType = support.mimeType;
    // without audio, drop the audio codec from the container request
    if (!this.hasAudio) mimeType = mimeType.startsWith('video/webm') ? 'video/webm' : 'video/mp4';
    const stream = new MediaStream(tracks);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000, audioBitsPerSecond: 192_000 });
    } catch (err) {
      video.getVideoTracks().forEach((t) => t.stop());
      const reason = err instanceof Error ? err.message : 'MediaRecorder could not start.';
      return { supported: false, mimeType: null, reason, hasAudio: false };
    }
    this.stream = stream;
    this.chunks = [];
    this.recorder = recorder;
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(250);
    this.started = performance.now();
    return { supported: true, mimeType, hasAudio: this.hasAudio };
  }

  stop(): Promise<RecordingResult | null> {
    const rec = this.recorder;
    if (!rec || rec.state === 'inactive') return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => {
        const mimeType = rec.mimeType || 'video/webm';
        const blob = new Blob(this.chunks, { type: mimeType });
        const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        // only stop the canvas video track; the audio track belongs to the engine
        this.stream?.getVideoTracks().forEach((t) => t.stop());
        this.stream = null;
        this.recorder = null;
        this.chunks = [];
        resolve({
          blob,
          mimeType,
          extension,
          hasAudio: this.hasAudio,
          durationMs: performance.now() - this.started,
          filename: `iris-resonance-${stamp}.${extension}`,
        });
      };
      rec.stop();
    });
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadUrl(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
