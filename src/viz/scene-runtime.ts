import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { AppSettingsV1 } from '../storage/settings';
import { isReducedMotion, SceneVisualizerOptions } from './scene';

export interface SceneRuntimeOptions extends SceneVisualizerOptions {
  fov?: number;
  near?: number;
  far?: number;
  cameraPosition?: readonly [number, number, number];
  target?: readonly [number, number, number];
  enablePan?: boolean;
  minDistance?: number;
  maxDistance?: number;
  minPolarAngle?: number;
  maxPolarAngle?: number;
  dampingFactor?: number;
  background?: number;
  fogDensity?: number;
  toneMappingExposure?: number;
  useEnvironment?: boolean;
  environmentIntensity?: number;
  environmentBlur?: number;
  autoRotateSpeedScale?: number;
  onResize?: () => void;
}

export class SceneRuntime {
  readonly container: HTMLElement;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  envMap: THREE.Texture | null = null;

  isDestroyed = false;
  contextLost = false;

  currentPixelRatio = 1;
  minPixelRatio = 0.55;
  maxPixelRatio = 1;

  private readonly pmrem: THREE.PMREMGenerator | null = null;
  private readonly resizeObserver: ResizeObserver;
  private readonly onContextLostCb?: () => void;
  private readonly onResizeCb?: () => void;
  private readonly autoRotateSpeedScale: number;

  private emaFrameTime = 16.6;
  private lastDprAdjustTime = 0;
  private lastTime = 0;

  constructor(container: HTMLElement, options: SceneRuntimeOptions = {}) {
    this.container = container;
    this.onContextLostCb = options.onContextLost;
    this.onResizeCb = options.onResize;
    this.autoRotateSpeedScale = options.autoRotateSpeedScale ?? 1.5;

    const isMobile =
      typeof window !== 'undefined' &&
      (window.innerWidth < 768 ||
        (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
        /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));

    this.maxPixelRatio = isMobile ? 0.9 : Math.min(window.devicePixelRatio || 1, 1.0);
    this.currentPixelRatio = isMobile ? 0.8 : this.maxPixelRatio;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(this.currentPixelRatio);
    this.renderer.setSize(this.container.clientWidth || 800, this.container.clientHeight || 400);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = options.toneMappingExposure ?? 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');

    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestored);

    const bg = options.background ?? 0x0c0709;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(bg);
    if (options.fogDensity !== undefined && options.fogDensity > 0) {
      this.scene.fog = new THREE.FogExp2(bg, options.fogDensity);
    }

    if (options.useEnvironment !== false) {
      this.pmrem = new THREE.PMREMGenerator(this.renderer);
      const envScene = new RoomEnvironment();
      this.envMap = this.pmrem.fromScene(envScene, options.environmentBlur ?? 0.04).texture;
      this.scene.environment = this.envMap;
      this.scene.environmentIntensity = options.environmentIntensity ?? 0.28;
      envScene.dispose();
    }

    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 400;
    this.camera = new THREE.PerspectiveCamera(
      options.fov ?? 36,
      width / height,
      options.near ?? 0.1,
      options.far ?? 120
    );
    const cam = options.cameraPosition ?? [0.22, 6.85, 24.5];
    this.camera.position.set(cam[0], cam[1], cam[2]);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = options.dampingFactor ?? 0.06;
    this.controls.enablePan = options.enablePan ?? false;
    this.controls.minDistance = options.minDistance ?? 16;
    this.controls.maxDistance = options.maxDistance ?? 42;
    this.controls.minPolarAngle = options.minPolarAngle ?? Math.PI * 0.32;
    this.controls.maxPolarAngle = options.maxPolarAngle ?? Math.PI * 0.62;
    const target = options.target ?? [0, 6.85, 0];
    this.controls.target.set(target[0], target[1], target[2]);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.container.appendChild(this.renderer.domElement);
    this.applySize(false);
  }

  get alive(): boolean {
    return !this.isDestroyed && !this.contextLost;
  }

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.onContextLostCb?.();
  };

  private handleContextRestored = (): void => {
    this.contextLost = false;
    this.resize();
  };

  beginFrame(): { now: number; rawDt: number } {
    const now = performance.now();
    const rawDt = this.lastTime ? Math.min(0.05, (now - this.lastTime) / 1000) : 0.016;
    this.lastTime = now;
    return { now, rawDt };
  }

  applyControls(settings: AppSettingsV1, speedScale?: number): boolean {
    const reduced = isReducedMotion(settings);
    this.controls.autoRotate = settings.cameraAutoRotate && !reduced;
    this.controls.autoRotateSpeed = (settings.cameraAutoRotateSpeed ?? 1.0) * (speedScale ?? this.autoRotateSpeedScale);
    this.controls.update();
    return reduced;
  }

  renderScene(now: number): void {
    const renderStart = performance.now();
    this.renderer.render(this.scene, this.camera);
    const renderDuration = performance.now() - renderStart;
    this.emaFrameTime = this.emaFrameTime * 0.9 + renderDuration * 0.1;

    if (now - this.lastDprAdjustTime > 2000) {
      if (this.emaFrameTime > 22.0 && this.currentPixelRatio > this.minPixelRatio) {
        this.currentPixelRatio = Math.max(this.minPixelRatio, this.currentPixelRatio - 0.08);
        this.renderer.setPixelRatio(this.currentPixelRatio);
        this.resize();
        this.lastDprAdjustTime = now;
      } else if (this.emaFrameTime < 12.0 && this.currentPixelRatio < this.maxPixelRatio) {
        this.currentPixelRatio = Math.min(this.maxPixelRatio, this.currentPixelRatio + 0.04);
        this.renderer.setPixelRatio(this.currentPixelRatio);
        this.resize();
        this.lastDprAdjustTime = now;
      }
    }
  }

  degradeQuality(): boolean {
    if (this.currentPixelRatio > this.minPixelRatio + 0.05) {
      this.currentPixelRatio = Math.max(this.minPixelRatio, this.currentPixelRatio - 0.15);
      this.renderer.setPixelRatio(this.currentPixelRatio);
      this.resize();
      return true;
    }
    return false;
  }

  resize(): void {
    this.applySize(true);
  }

  private applySize(runCallback: boolean): void {
    if (!this.alive) return;
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 400;
    this.camera.aspect = width / height;
    if (runCallback) this.onResizeCb?.();
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  disposeSceneGraph(): void {
    this.scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) {
        material.forEach((item) => item.dispose());
      } else if (material) {
        material.dispose();
      }
    });
    this.scene.clear();
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.envMap?.dispose();
    this.pmrem?.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
