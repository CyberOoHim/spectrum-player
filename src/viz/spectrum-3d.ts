import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AppSettingsV1 } from '../storage/settings';

export interface Spectrum3DOptions {
  onContextLost?: () => void;
}

function isReducedMotion(settings: AppSettingsV1): boolean {
  return (
    settings.reducedMotionOverride === 'on' ||
    (settings.reducedMotionOverride === 'system' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  );
}

export class Spectrum3D {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private resizeObserver: ResizeObserver;
  private onContextLostCb?: () => void;

  private instancedMeshBars: THREE.InstancedMesh | null = null;
  private instancedMeshRadial: THREE.InstancedMesh | null = null;
  private dummy: THREE.Object3D = new THREE.Object3D();
  private colorHelper: THREE.Color = new THREE.Color();

  private particleSystem: THREE.Points | null = null;
  private particlePositions: Float32Array | null = null;
  private particleOriginals: Float32Array | null = null;

  private orbGroup: THREE.Group | null = null;
  private orbCoreMesh: THREE.Mesh | null = null;
  private orbWireframeMesh: THREE.Mesh | null = null;
  private orbOriginalPositions: Float32Array | null = null;

  private currentBarCount: number = 0;
  private isDestroyed: boolean = false;
  private contextLost: boolean = false;

  constructor(container: HTMLElement, options: Spectrum3DOptions = {}) {
    this.container = container;
    this.onContextLostCb = options.onContextLost;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.container.clientWidth || 800, this.container.clientHeight || 400);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.container.appendChild(this.renderer.domElement);

    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestored);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      45,
      (this.container.clientWidth || 800) / (this.container.clientHeight || 400),
      0.1,
      1000
    );
    this.camera.position.set(0, 12, 32);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.1;
    this.controls.target.set(0, 2, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0x6ee7ff, 2.5);
    dirLight.position.set(10, 20, 15);
    this.scene.add(dirLight);

    const pointLight = new THREE.PointLight(0xa855f7, 3, 50);
    pointLight.position.set(0, 5, 0);
    this.scene.add(pointLight);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
  }

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.onContextLostCb?.();
  };

  private handleContextRestored = (): void => {
    this.contextLost = false;
    this.currentBarCount = 0;
    this.resize();
  };

  private resize(): void {
    if (this.isDestroyed || this.contextLost) return;
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 400;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private disposeObject(object: THREE.Object3D): void {
    this.scene.remove(object);
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      const material = (mesh as THREE.Mesh).material;
      if (Array.isArray(material)) {
        material.forEach((item) => item.dispose());
      } else if (material) {
        material.dispose();
      }
    });
  }

  private disposeGeneratedMeshes(): void {
    if (this.instancedMeshBars) {
      this.disposeObject(this.instancedMeshBars);
      this.instancedMeshBars = null;
    }
    if (this.instancedMeshRadial) {
      this.disposeObject(this.instancedMeshRadial);
      this.instancedMeshRadial = null;
    }
    if (this.particleSystem) {
      this.disposeObject(this.particleSystem);
      this.particleSystem = null;
      this.particlePositions = null;
      this.particleOriginals = null;
    }
    if (this.orbGroup) {
      this.disposeObject(this.orbGroup);
      this.orbGroup = null;
      this.orbCoreMesh = null;
      this.orbWireframeMesh = null;
      this.orbOriginalPositions = null;
    }
    this.currentBarCount = 0;
  }

  private setupMeshes(barCount: number): void {
    if (this.currentBarCount === barCount && this.instancedMeshBars && this.instancedMeshRadial) {
      return;
    }

    this.disposeGeneratedMeshes();
    this.currentBarCount = barCount;

    const boxGeometry = new THREE.BoxGeometry(0.35, 1, 0.35);
    const boxMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.2,
      metalness: 0.8,
    });

    this.instancedMeshBars = new THREE.InstancedMesh(boxGeometry, boxMaterial, barCount);
    this.instancedMeshRadial = new THREE.InstancedMesh(boxGeometry, boxMaterial.clone(), barCount);

    this.scene.add(this.instancedMeshBars);
    this.scene.add(this.instancedMeshRadial);

    const particleCount = Math.max(300, barCount * 8);
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const originals = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const radius = 6 + Math.random() * 14;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta);
      const z = radius * Math.cos(phi);

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      originals[i * 3] = x;
      originals[i * 3 + 1] = y;
      originals[i * 3 + 2] = z;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pMaterial = new THREE.PointsMaterial({
      color: 0x6ee7ff,
      size: 0.3,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
    });

    this.particleSystem = new THREE.Points(geometry, pMaterial);
    this.particlePositions = positions;
    this.particleOriginals = originals;
    this.scene.add(this.particleSystem);

    this.orbGroup = new THREE.Group();
    const orbCoreGeom = new THREE.IcosahedronGeometry(4.5, 4);
    const orbCoreMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.1,
      metalness: 0.9,
      flatShading: true,
    });
    this.orbCoreMesh = new THREE.Mesh(orbCoreGeom, orbCoreMat);
    this.orbGroup.add(this.orbCoreMesh);

    const posAttr = orbCoreGeom.attributes.position;
    this.orbOriginalPositions = new Float32Array(posAttr.array);

    const orbWireGeom = new THREE.IcosahedronGeometry(5.4, 2);
    const orbWireMat = new THREE.MeshBasicMaterial({
      color: 0xc084fc,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
    });
    this.orbWireframeMesh = new THREE.Mesh(orbWireGeom, orbWireMat);
    this.orbGroup.add(this.orbWireframeMesh);

    this.scene.add(this.orbGroup);
  }

  public render(bands: Float32Array, settings: AppSettingsV1): void {
    if (this.isDestroyed || this.contextLost) return;

    const barCount = bands.length;
    if (barCount === 0) return;

    this.setupMeshes(barCount);

    const reduced = isReducedMotion(settings);
    const requestedMode = settings.visualizerMode;
    const mode =
      reduced && (requestedMode === 'particles' || requestedMode === 'orb') ? 'bars' : requestedMode;

    this.controls.autoRotate = settings.cameraAutoRotate && !reduced;
    this.controls.autoRotateSpeed = (settings.cameraAutoRotateSpeed ?? 1.0) * 1.2;
    this.controls.update();

    if (this.instancedMeshBars) this.instancedMeshBars.visible = mode === 'bars';
    if (this.instancedMeshRadial) this.instancedMeshRadial.visible = mode === 'radial';
    if (this.particleSystem) this.particleSystem.visible = mode === 'particles';
    if (this.orbGroup) this.orbGroup.visible = mode === 'orb';

    if (mode === 'bars' && this.instancedMeshBars) {
      const spacing = 0.55;
      const startX = -((barCount * spacing) / 2);

      for (let i = 0; i < barCount; i++) {
        const val = bands[i];
        const scaleY = Math.max(0.1, val * 16.0);

        this.dummy.position.set(startX + i * spacing, scaleY / 2, 0);
        this.dummy.scale.set(1, scaleY, 1);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();

        this.instancedMeshBars.setMatrixAt(i, this.dummy.matrix);
        this.applyColor(this.instancedMeshBars, i, val, i / barCount, settings.colorMode);
      }
      this.instancedMeshBars.instanceMatrix.needsUpdate = true;
      if (this.instancedMeshBars.instanceColor) this.instancedMeshBars.instanceColor.needsUpdate = true;
    }

    if (mode === 'radial' && this.instancedMeshRadial) {
      const radius = 7;

      for (let i = 0; i < barCount; i++) {
        const val = bands[i];
        const scaleY = Math.max(0.1, val * 14.0);
        const angle = (i / barCount) * Math.PI * 2;

        const x = Math.cos(angle) * (radius + val * 2.0);
        const z = Math.sin(angle) * (radius + val * 2.0);

        this.dummy.position.set(x, scaleY / 2, z);
        this.dummy.scale.set(1, scaleY, 1);
        this.dummy.rotation.set(0, -angle + Math.PI / 2, 0);
        this.dummy.updateMatrix();

        this.instancedMeshRadial.setMatrixAt(i, this.dummy.matrix);
        this.applyColor(this.instancedMeshRadial, i, val, i / barCount, settings.colorMode);
      }
      this.instancedMeshRadial.instanceMatrix.needsUpdate = true;
      if (this.instancedMeshRadial.instanceColor) this.instancedMeshRadial.instanceColor.needsUpdate = true;
    }

    if (!reduced && mode === 'particles' && this.particleSystem && this.particlePositions && this.particleOriginals) {
      let bass = 0, mid = 0, treble = 0;
      const third = Math.floor(barCount / 3);

      for (let i = 0; i < barCount; i++) {
        if (i < third) bass += bands[i];
        else if (i < third * 2) mid += bands[i];
        else treble += bands[i];
      }
      bass = bass / Math.max(1, third);
      mid = mid / Math.max(1, third);
      treble = treble / Math.max(1, third);

      const time = performance.now() * 0.001;
      const count = this.particlePositions.length / 3;

      for (let i = 0; i < count; i++) {
        const ox = this.particleOriginals[i * 3];
        const oy = this.particleOriginals[i * 3 + 1];
        const oz = this.particleOriginals[i * 3 + 2];

        const pulse = 1 + bass * 0.8 + Math.sin(time * 2 + i) * 0.1;

        this.particlePositions[i * 3] = ox * pulse;
        this.particlePositions[i * 3 + 1] = oy * pulse + Math.sin(time + ox) * mid * 2.0;
        this.particlePositions[i * 3 + 2] = oz * pulse;
      }

      this.particleSystem.geometry.attributes.position.needsUpdate = true;
    }

    if (!reduced && mode === 'orb' && this.orbGroup && this.orbCoreMesh && this.orbOriginalPositions) {
      let bass = 0, mid = 0, treble = 0;
      const third = Math.floor(barCount / 3);

      for (let i = 0; i < barCount; i++) {
        if (i < third) bass += bands[i];
        else if (i < third * 2) mid += bands[i];
        else treble += bands[i];
      }
      bass = bass / Math.max(1, third);
      mid = mid / Math.max(1, third);
      treble = treble / Math.max(1, third);

      const time = performance.now() * 0.0015;
      const posAttr = this.orbCoreMesh.geometry.attributes.position;
      const posArray = posAttr.array as Float32Array;
      const count = posArray.length / 3;

      for (let i = 0; i < count; i++) {
        const ox = this.orbOriginalPositions[i * 3];
        const oy = this.orbOriginalPositions[i * 3 + 1];
        const oz = this.orbOriginalPositions[i * 3 + 2];

        const bandIdx = i % barCount;
        const energy = bands[bandIdx];
        const idleWave = Math.sin(ox * 1.5 + time * 2) * Math.cos(oy * 1.5 + time * 1.5) * 0.06;
        const noise = Math.sin(ox * 2 + time * 3) * Math.cos(oy * 2 + time * 2) * (bass * 1.5 + energy);
        const factor = 1 + idleWave + noise * 0.2 + energy * 0.3;

        posArray[i * 3] = ox * factor;
        posArray[i * 3 + 1] = oy * factor;
        posArray[i * 3 + 2] = oz * factor;
      }
      posAttr.needsUpdate = true;

      if (this.orbWireframeMesh) {
        this.orbWireframeMesh.rotation.y = time * 0.5;
        this.orbWireframeMesh.rotation.x = time * 0.3;
        const wireScale = 1 + treble * 0.4 + Math.sin(time * 4) * 0.05;
        this.orbWireframeMesh.scale.set(wireScale, wireScale, wireScale);
      }

      const mat = this.orbCoreMesh.material as THREE.MeshStandardMaterial;
      if (settings.colorMode === 'mono') {
        mat.color.setHex(0x38bdf8);
      } else if (settings.colorMode === 'mood') {
        mat.color.setHSL(0.75 + bass * 0.2, 0.9, 0.55);
      } else {
        mat.color.setHSL((time * 0.1 + bass * 0.5) % 1.0, 0.85, 0.5);
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  private applyColor(
    mesh: THREE.InstancedMesh,
    index: number,
    value: number,
    ratio: number,
    colorMode: 'spectrum' | 'mono' | 'mood'
  ): void {
    if (colorMode === 'mono') {
      this.colorHelper.setHex(0x6ee7ff);
    } else if (colorMode === 'mood') {
      const hue = 0.7 + value * 0.2;
      this.colorHelper.setHSL(hue, 0.85, 0.55);
    } else {
      const hue = ratio * 0.75;
      this.colorHelper.setHSL(hue, 0.9, 0.5);
    }
    mesh.setColorAt(index, this.colorHelper);
  }

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.resizeObserver.disconnect();
    this.controls.dispose();

    this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.handleContextRestored);

    this.disposeGeneratedMeshes();
    this.scene.clear();
    this.renderer.dispose();

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
