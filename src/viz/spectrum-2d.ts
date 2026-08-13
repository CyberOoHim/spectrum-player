import { AppSettingsV1 } from '../storage/settings';

export class Spectrum2D {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private container: HTMLElement;
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.container.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D canvas context');
    }
    this.ctx = ctx;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
  }

  public resize(): void {
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 400;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.ctx.scale(dpr, dpr);
  }

  public render(bands: Float32Array, settings: AppSettingsV1): void {
    const width = this.canvas.width / (Math.min(window.devicePixelRatio || 1, 2));
    const height = this.canvas.height / (Math.min(window.devicePixelRatio || 1, 2));

    this.ctx.clearRect(0, 0, width, height);

    const count = bands.length;
    if (count === 0) return;

    const gap = 3;
    const totalGapWidth = gap * (count + 1);
    const barWidth = Math.max(2, (width - totalGapWidth) / count);

    for (let i = 0; i < count; i++) {
      const val = bands[i];
      const barHeight = Math.max(2, val * (height * 0.85));
      const x = gap + i * (barWidth + gap);
      const y = height - barHeight;

      let fillStyle: string | CanvasGradient;
      if (settings.colorMode === 'mono') {
        fillStyle = '#6ee7ff';
      } else if (settings.colorMode === 'mood') {
        const hue = 260 + val * 60; // Violet to Cyan
        fillStyle = `hsl(${hue}, 80%, 60%)`;
      } else {
        // Spectrum gradient
        const hue = (i / count) * 280; // Red to Violet
        fillStyle = `hsl(${hue}, 85%, 55%)`;
      }

      this.ctx.fillStyle = fillStyle;
      this.ctx.beginPath();
      if (this.ctx.roundRect) {
        this.ctx.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
      } else {
        this.ctx.rect(x, y, barWidth, barHeight);
      }
      this.ctx.fill();
    }
  }

  public destroy(): void {
    this.resizeObserver.disconnect();
    if (this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
  }
}
