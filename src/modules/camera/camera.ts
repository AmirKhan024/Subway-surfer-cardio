export interface CameraConfig {
  facingMode?: 'user' | 'environment';
  onStreamReady?: (video: HTMLVideoElement) => void;
}

function getCameraConstraints(): MediaStreamConstraints {
  // V2 parity (2026-05-14): V2 uses { facingMode: 'user', width: { ideal: 1280 },
  // height: { ideal: 720 } } for every game on every device. Mobile browsers
  // resolve this against the front-camera's native resolution and the
  // `object-fit: cover` rule on video/canvas then fills the portrait viewport.
  return {
    video: {
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  };
}

export class CameraManager {
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private _running = false;

  async start(videoElement: HTMLVideoElement): Promise<void> {
    this.video = videoElement;

    // Reuse existing stream if still active
    if (this.video.srcObject instanceof MediaStream) {
      const tracks = this.video.srcObject.getTracks();
      const anyLive = tracks.some((t) => t.readyState === 'live');
      if (!anyLive) {
        this.video.srcObject.getTracks().forEach((t) => t.stop());
        this.video.srcObject = null;
      }
    }

    if (!this.video.srcObject) {
      const constraints = getCameraConstraints();
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;
      await this.video.play();
    } else {
      if (this.video.paused) await this.video.play();
      this.stream = this.video.srcObject as MediaStream;
    }

    this._running = true;
  }

  stop(): void {
    this._running = false;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
  }

  get isRunning(): boolean {
    return this._running;
  }

  get videoElement(): HTMLVideoElement | null {
    return this.video;
  }

  get videoWidth(): number {
    return this.video?.videoWidth ?? 0;
  }

  get videoHeight(): number {
    return this.video?.videoHeight ?? 0;
  }
}
