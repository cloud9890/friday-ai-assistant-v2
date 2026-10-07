/* ==========================================================================
   F.R.I.D.A.Y. // SCREEN SHARE MANAGER
   Captures the user's display through getDisplayMedia (requires a user
   gesture + permission) and produces downscaled JPEG frames that ride along
   with agent requests, so the analyze_screen skill can see the screen.
   Nothing is captured while sharing is off.
   ========================================================================== */

const FRAME_MAX_WIDTH = 1024;
const FRAME_QUALITY = 0.55;

export class ScreenShareManager {
  constructor() {
    this.enabled = false;
    this.stream = null;
    this.video = null;
    this.canvas = document.createElement('canvas');
  }

  async toggle() {
    if (this.enabled) {
      this.stop();
      return false;
    }
    return this.start();
  }

  async start() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      throw new Error('Screen sharing is not supported in this browser.');
    }
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 5 },
      audio: false
    });
    this.enabled = true;

    // The browser stops sharing from its own UI too — react to that.
    this.stream.getVideoTracks()[0].addEventListener('ended', () => this.stop());

    this.video = document.createElement('video');
    this.video.srcObject = this.stream;
    this.video.muted = true;
    await this.video.play();
    return true;
  }

  stop() {
    this.enabled = false;
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
  }

  /** Latest frame as a downscaled JPEG data URL, or null when not sharing. */
  captureFrame() {
    if (!this.enabled || !this.video || !this.video.videoWidth) return null;
    const scale = Math.min(1, FRAME_MAX_WIDTH / this.video.videoWidth);
    this.canvas.width = Math.round(this.video.videoWidth * scale);
    this.canvas.height = Math.round(this.video.videoHeight * scale);
    const ctx = this.canvas.getContext('2d');
    ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    return this.canvas.toDataURL('image/jpeg', FRAME_QUALITY);
  }
}
