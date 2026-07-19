/**
 * Ambient types for the WICG video-rvfc API (HTMLVideoElement
 * .requestVideoFrameCallback) — NOT in TS 5.9's lib.dom.d.ts
 * (microsoft/TypeScript-DOM-lib-generator#927 still open).
 *
 * Interface declarations merge, so this stays safe if a future lib.dom adds
 * the real ones; deliberately NO type aliases (aliases cannot merge and
 * would collide). Delete this file when lib.dom catches up.
 */
interface VideoFrameCallbackMetadata {
  presentationTime: DOMHighResTimeStamp;
  expectedDisplayTime: DOMHighResTimeStamp;
  width: number;
  height: number;
  mediaTime: number;
  presentedFrames: number;
  processingDuration?: number;
  captureTime?: DOMHighResTimeStamp;
  receiveTime?: DOMHighResTimeStamp;
  rtpTimestamp?: number;
}

interface HTMLVideoElement {
  requestVideoFrameCallback(
    callback: (now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => void,
  ): number;
  cancelVideoFrameCallback(handle: number): void;
}
