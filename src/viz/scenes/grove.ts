import * as THREE from 'three';
import { AppSettingsV1 } from '../../storage/settings';
import { AudioEnergySmoother } from '../audio-energy';
import { atmosphereSpeed, SceneVisualizerOptions } from '../scene';
import { SceneRuntime } from '../scene-runtime';

const MAX_POLLEN = 90;
const MAX_FALLING_LEAVES = 24;

interface PollenMote {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
}

interface FallingLeaf {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Vector3;
  rotSpeed: THREE.Vector3;
  size: number;
  colorIdx: number;
}

const SHAFT_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SHAFT_FRAG = /* glsl */ `
precision highp float;

varying vec2 vUv;
varying vec3 vWorldPos;

uniform vec3 uCamPos;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uEnergy;
uniform float uPulse;
uniform float uHue;
uniform float uSat;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = rot * p * 2.02 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

vec3 paletteShift(vec3 col, float hue, float sat) {
  float angle = hue * 6.28318;
  vec3 shift = vec3(
    0.14 * sin(angle),
    0.06 * sin(angle + 2.1),
    0.16 * cos(angle)
  );
  return mix(col, clamp(col + shift, 0.0, 1.0), sat * 0.55);
}

void main() {
  vec3 viewDir = normalize(uCamPos - vWorldPos);

  // Volumetric light beam intensity across the cylinder cone
  float radialDist = abs(vUv.x - 0.5) * 2.0;
  float beamShape = pow(clamp(1.0 - radialDist, 0.0, 1.0), 2.2);

  // Canopy leaf shadow noise modulation
  vec2 shaftNoiseUv = vec2(vUv.x * 4.0, vUv.y * 2.5 - uTime * 0.12);
  float canopyShadow = fbm(shaftNoiseUv);
  float leafFlutter = sin(uTime * 1.8 + vWorldPos.y * 3.0) * (0.05 + uMid * 0.08);

  // Vertical beam fade (intense at top canopy, soft at forest floor)
  float vertFade = smoothstep(0.02, 0.35, vUv.y) * (1.0 - smoothstep(0.85, 1.0, vUv.y));

  // Breathing intensity with bass
  float brightness = (0.55 + uBass * 0.65 + uPulse * 0.45) * (0.45 + canopyShadow * 0.75 + leafFlutter);
  float alpha = beamShape * vertFade * brightness * 0.65;

  // Warm golden sunray color
  vec3 rayColor = vec3(1.0, 0.92, 0.68) * (1.0 + uTreble * 0.35);
  rayColor = paletteShift(rayColor, uHue, uSat);

  gl_FragColor = vec4(rayColor, alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const POLLEN_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 color;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vColor = color;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.2, aSize * (180.0 / max(-mv.z, 0.1)) * uPixelRatio);
  gl_Position = projectionMatrix * mv;
}
`;

const POLLEN_FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.0) discard;
  float glow = pow(1.0 - d, 2.0);
  float core = pow(max(0.0, 1.0 - d * 2.5), 2.2);
  vec3 col = vColor * glow + vec3(1.0, 0.98, 0.85) * core;
  gl_FragColor = vec4(col, glow * vAlpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function canvasTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  colorSpace: typeof THREE.SRGBColorSpace | typeof THREE.NoColorSpace = THREE.SRGBColorSpace
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to create canvas texture');
  draw(ctx, size);
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = colorSpace;
  map.anisotropy = 8;
  map.needsUpdate = true;
  return map;
}

function makeForestFloorMap(): THREE.CanvasTexture {
  return canvasTexture(512, (ctx, size) => {
    // Rich mossy green-brown loam
    ctx.fillStyle = '#1e2416';
    ctx.fillRect(0, 0, size, size);

    // Moss patches
    for (let i = 0; i < 180; i++) {
      const isMoss = Math.random() > 0.45;
      const r = isMoss ? 38 + Math.random() * 30 : 45 + Math.random() * 25;
      const g = isMoss ? 65 + Math.random() * 45 : 35 + Math.random() * 20;
      const b = isMoss ? 25 + Math.random() * 20 : 18 + Math.random() * 15;
      ctx.fillStyle = `rgba(${r},${g},${b},${0.15 + Math.random() * 0.25})`;
      ctx.beginPath();
      ctx.ellipse(
        Math.random() * size,
        Math.random() * size,
        6 + Math.random() * 22,
        4 + Math.random() * 14,
        Math.random() * Math.PI,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    // Fallen twigs / pine needles
    for (let i = 0; i < 90; i++) {
      ctx.strokeStyle = `rgba(30, 18, 10, ${0.3 + Math.random() * 0.4})`;
      ctx.lineWidth = 1 + Math.random() * 1.5;
      const x = Math.random() * size;
      const y = Math.random() * size;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 22, y + (Math.random() - 0.5) * 22);
      ctx.stroke();
    }
  });
}

function makeTreeBarkMap(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, size) => {
    ctx.fillStyle = '#2d1e14';
    ctx.fillRect(0, 0, size, size);

    // Vertical bark ridges
    for (let i = 0; i < 65; i++) {
      ctx.strokeStyle = `rgba(18, 10, 6, ${0.25 + Math.random() * 0.4})`;
      ctx.lineWidth = 1.5 + Math.random() * 3.5;
      const x = Math.random() * size;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (Math.random() - 0.5) * 8, size);
      ctx.stroke();
    }
    // Moss on bark
    for (let i = 0; i < 25; i++) {
      ctx.fillStyle = `rgba(55, 85, 30, ${0.12 + Math.random() * 0.2})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 8 + Math.random() * 25, 4 + Math.random() * 12);
    }
  });
}

export class GroveLightwells {
  private readonly runtime: SceneRuntime;
  private readonly energy = new AudioEnergySmoother({
    bass: 0.16,
    mid: 0.14,
    treble: 0.2,
    energy: 0.12,
    pulseDecay: 2.0,
  });

  private readonly floorMap: THREE.CanvasTexture;
  private readonly barkMap: THREE.CanvasTexture;

  private readonly shaftMaterial: THREE.ShaderMaterial;
  private readonly shaftMeshes: THREE.Mesh[] = [];
  private readonly sunLight: THREE.DirectionalLight;
  private readonly clearingLight: THREE.PointLight;

  private readonly pollenGeom: THREE.BufferGeometry;
  private readonly pollenMat: THREE.ShaderMaterial;
  private readonly pollenPositions: Float32Array;
  private readonly pollenSizes: Float32Array;
  private readonly pollenAlphas: Float32Array;
  private readonly pollenColors: Float32Array;
  private readonly pollenMotes: PollenMote[] = [];

  private readonly leafMesh: THREE.InstancedMesh;
  private readonly leafDummy = new THREE.Object3D();
  private readonly fallingLeaves: FallingLeaf[] = [];

  private simTime = 0;
  private qualityTier = 2;

  constructor(container: HTMLElement, options: SceneVisualizerOptions = {}) {
    this.runtime = new SceneRuntime(container, {
      onContextLost: options.onContextLost,
      fov: 42,
      near: 0.1,
      far: 50,
      cameraPosition: [0.35, 1.4, 3.2],
      target: [0, 1.1, 0],
      enablePan: false,
      minDistance: 1.2,
      maxDistance: 5.5,
      minPolarAngle: Math.PI * 0.16,
      maxPolarAngle: Math.PI * 0.78,
      dampingFactor: 0.07,
      background: 0x141e12,
      fogDensity: 0.028,
      toneMappingExposure: 1.05,
      useEnvironment: true,
      environmentIntensity: 0.22,
      environmentBlur: 0.18,
      autoRotateSpeedScale: 0.58,
      onResize: () => this.frameGrove(),
    });

    this.floorMap = makeForestFloorMap();
    this.barkMap = makeTreeBarkMap();

    this.buildForestClearing();
    this.buildCanopyAndTrees();

    // Volumetric Sun Shafts (God Rays)
    this.shaftMaterial = new THREE.ShaderMaterial({
      vertexShader: SHAFT_VERT,
      fragmentShader: SHAFT_FRAG,
      uniforms: {
        uCamPos: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTreble: { value: 0 },
        uEnergy: { value: 0 },
        uPulse: { value: 0 },
        uHue: { value: 0 },
        uSat: { value: 0.35 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    // Multiple angled sun shaft cones streaming into the clearing
    const shaftGeom = new THREE.CylinderGeometry(0.25, 1.4, 4.2, 16, 1, true);
    const shaftConfigs = [
      { pos: new THREE.Vector3(-0.35, 2.1, 0.1), rot: new THREE.Euler(0.22, 0.1, -0.28), scale: 1.0 },
      { pos: new THREE.Vector3(0.45, 2.2, -0.25), rot: new THREE.Euler(0.18, -0.15, -0.32), scale: 0.85 },
      { pos: new THREE.Vector3(0.1, 2.0, 0.35), rot: new THREE.Euler(0.28, 0.2, -0.25), scale: 0.75 },
    ];

    for (const cfg of shaftConfigs) {
      const mesh = new THREE.Mesh(shaftGeom, this.shaftMaterial);
      mesh.position.copy(cfg.pos);
      mesh.rotation.copy(cfg.rot);
      mesh.scale.setScalar(cfg.scale);
      mesh.renderOrder = 3;
      this.shaftMeshes.push(mesh);
      this.runtime.scene.add(mesh);
    }

    // Sunlight
    this.sunLight = new THREE.DirectionalLight(0xfffae0, 2.8);
    this.sunLight.position.set(-2.5, 6.0, 2.0);
    this.runtime.scene.add(this.sunLight);

    this.clearingLight = new THREE.PointLight(0xffea95, 2.2, 6.5, 1.4);
    this.clearingLight.position.set(0, 1.8, 0);
    this.runtime.scene.add(this.clearingLight);

    // Floating Pollen Motes
    const pollen = this.buildPollenMotes();
    this.pollenGeom = pollen.geometry;
    this.pollenMat = pollen.material;
    this.pollenPositions = pollen.positions;
    this.pollenSizes = pollen.sizes;
    this.pollenAlphas = pollen.alphas;
    this.pollenColors = pollen.colors;

    // Drifting Autumn Leaves
    this.leafMesh = this.buildFallingLeaves();

    this.runtime.resize();
  }

  private buildForestClearing(): void {
    const scene = this.runtime.scene;

    // Forest Floor
    const floorMat = new THREE.MeshStandardMaterial({
      map: this.floorMap,
      roughness: 0.92,
      metalness: 0.02,
      color: 0x2e3822,
    });

    const floor = new THREE.Mesh(new THREE.CircleGeometry(6.2, 48), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.0;
    scene.add(floor);

    // Fallen Mossy Log in the clearing
    const logMat = new THREE.MeshStandardMaterial({
      map: this.barkMap,
      roughness: 0.85,
      color: 0x362418,
    });
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 2.2, 12), logMat);
    log.rotation.set(0.12, 0.65, 1.48);
    log.position.set(-0.65, 0.12, 0.45);
    scene.add(log);

    // Forest ambient lighting
    scene.add(new THREE.AmbientLight(0x1a2618, 0.4));
    const hemi = new THREE.HemisphereLight(0x7ea85d, 0x18140c, 0.35);
    scene.add(hemi);
  }

  private buildCanopyAndTrees(): void {
    const scene = this.runtime.scene;
    const treeMat = new THREE.MeshStandardMaterial({
      map: this.barkMap,
      roughness: 0.88,
      color: 0x2e1c12,
    });

    const canopyMat = new THREE.MeshStandardMaterial({
      color: 0x3e5e26,
      roughness: 0.75,
      side: THREE.DoubleSide,
    });

    // 6 Ancient Tree Trunks surrounding clearing
    const trunkCount = 6;
    for (let i = 0; i < trunkCount; i++) {
      const angle = (i / trunkCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const radius = 2.4 + Math.random() * 0.8;
      const trunkH = 4.8 + Math.random() * 1.5;
      const r = 0.18 + Math.random() * 0.1;

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 1.2, trunkH, 12), treeMat);
      trunk.position.set(Math.cos(angle) * radius, trunkH * 0.5 - 0.2, Math.sin(angle) * radius);
      trunk.rotation.set((Math.random() - 0.5) * 0.08, Math.random() * Math.PI, (Math.random() - 0.5) * 0.08);
      scene.add(trunk);

      // Leaf clusters at canopy height
      for (let c = 0; c < 3; c++) {
        const cluster = new THREE.Mesh(new THREE.DodecahedronGeometry(0.65 + Math.random() * 0.35, 1), canopyMat);
        cluster.position.set(
          trunk.position.x + (Math.random() - 0.5) * 0.8,
          3.5 + Math.random() * 1.2,
          trunk.position.z + (Math.random() - 0.5) * 0.8
        );
        scene.add(cluster);
      }
    }
  }

  private buildPollenMotes(): {
    geometry: THREE.BufferGeometry;
    material: THREE.ShaderMaterial;
    positions: Float32Array;
    sizes: Float32Array;
    alphas: Float32Array;
    colors: Float32Array;
  } {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_POLLEN * 3);
    const sizes = new Float32Array(MAX_POLLEN);
    const alphas = new Float32Array(MAX_POLLEN);
    const colors = new Float32Array(MAX_POLLEN * 3);

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.ShaderMaterial({
      vertexShader: POLLEN_VERT,
      fragmentShader: POLLEN_FRAG,
      uniforms: {
        uPixelRatio: { value: this.runtime.currentPixelRatio },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 4;
    this.runtime.scene.add(points);

    for (let i = 0; i < MAX_POLLEN; i++) {
      this.pollenMotes.push({
        pos: new THREE.Vector3(
          (Math.random() - 0.5) * 2.8,
          0.4 + Math.random() * 2.8,
          (Math.random() - 0.5) * 2.8
        ),
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.02, 0.02 + Math.random() * 0.03, (Math.random() - 0.5) * 0.02),
        life: Math.random() * 4.0,
        maxLife: 3.5 + Math.random() * 3.0,
        size: 0.018 + Math.random() * 0.035,
      });
    }

    return { geometry, material, positions, sizes, alphas, colors };
  }

  private buildFallingLeaves(): THREE.InstancedMesh {
    const leafGeom = new THREE.PlaneGeometry(0.08, 0.12);
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0xd48828,
      roughness: 0.65,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.InstancedMesh(leafGeom, leafMat, MAX_FALLING_LEAVES);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    for (let i = 0; i < MAX_FALLING_LEAVES; i++) {
      this.fallingLeaves.push({
        pos: new THREE.Vector3(
          (Math.random() - 0.5) * 3.2,
          1.0 + Math.random() * 2.5,
          (Math.random() - 0.5) * 3.2
        ),
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.04, -0.15 - Math.random() * 0.15, (Math.random() - 0.5) * 0.04),
        rot: new THREE.Vector3(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI),
        rotSpeed: new THREE.Vector3(1 + Math.random() * 2, 1 + Math.random() * 2, 1 + Math.random() * 2),
        size: 0.06 + Math.random() * 0.06,
        colorIdx: i % 3,
      });
    }

    this.runtime.scene.add(mesh);
    return mesh;
  }

  private updatePollen(dt: number, reduced: boolean): void {
    for (let i = 0; i < MAX_POLLEN; i++) {
      const p = this.pollenMotes[i];
      if (!reduced) {
        p.life += dt;
        if (p.life >= p.maxLife) {
          p.life = 0;
          p.pos.set((Math.random() - 0.5) * 2.8, 0.4 + Math.random() * 2.8, (Math.random() - 0.5) * 2.8);
        } else {
          p.pos.addScaledVector(p.vel, dt);
          p.pos.x += Math.sin(this.simTime * 1.5 + i) * 0.008 * dt;
        }
      }

      const progress = p.life / p.maxLife;
      const alpha = Math.sin(progress * Math.PI) * (0.35 + this.energy.treble * 0.65);

      this.pollenPositions[i * 3] = p.pos.x;
      this.pollenPositions[i * 3 + 1] = p.pos.y;
      this.pollenPositions[i * 3 + 2] = p.pos.z;
      this.pollenSizes[i] = p.size * (1.0 + this.energy.treble * 0.8);
      this.pollenAlphas[i] = alpha;

      // Golden sunlit pollen motes
      this.pollenColors[i * 3] = 1.0;
      this.pollenColors[i * 3 + 1] = 0.88;
      this.pollenColors[i * 3 + 2] = 0.52;
    }

    this.pollenGeom.getAttribute('position').needsUpdate = true;
    this.pollenGeom.getAttribute('aSize').needsUpdate = true;
    this.pollenGeom.getAttribute('aAlpha').needsUpdate = true;
    this.pollenGeom.getAttribute('color').needsUpdate = true;
    this.pollenMat.uniforms.uPixelRatio.value = this.runtime.currentPixelRatio;
  }

  private updateFallingLeaves(dt: number, reduced: boolean): void {
    if (reduced) return;
    const windSpeed = 1.0 + this.energy.mid * 0.9;
    for (let i = 0; i < MAX_FALLING_LEAVES; i++) {
      const leaf = this.fallingLeaves[i];
      leaf.pos.y += leaf.vel.y * windSpeed * dt;
      leaf.pos.x += (leaf.vel.x + Math.sin(this.simTime * 2.2 + i) * 0.08) * dt;
      leaf.rot.x += leaf.rotSpeed.x * dt;
      leaf.rot.y += leaf.rotSpeed.y * dt;

      if (leaf.pos.y < 0.05) {
        leaf.pos.y = 3.5 + Math.random() * 0.8;
        leaf.pos.x = (Math.random() - 0.5) * 3.2;
      }

      this.leafDummy.position.copy(leaf.pos);
      this.leafDummy.rotation.set(leaf.rot.x, leaf.rot.y, leaf.rot.z);
      this.leafDummy.scale.setScalar(leaf.size);
      this.leafDummy.updateMatrix();
      this.leafMesh.setMatrixAt(i, this.leafDummy.matrix);
    }
    this.leafMesh.instanceMatrix.needsUpdate = true;
  }

  private frameGrove(): void {
    this.runtime.controls.target.set(0, 1.1, 0);
    const vFov = THREE.MathUtils.degToRad(this.runtime.camera.fov);
    const aspect = Math.max(this.runtime.camera.aspect, 0.2);
    const fitH = 2.4;
    const fitW = 2.4;
    const distH = fitH / 2 / Math.tan(vFov / 2);
    const distW = fitW / 2 / (Math.tan(vFov / 2) * aspect);
    const dist = Math.max(distH, distW) * 1.1;

    const offset = this.runtime.camera.position.clone().sub(this.runtime.controls.target);
    if (offset.lengthSq() < 1e-6) offset.set(0.35, 0.4, 3.0);
    offset.normalize().multiplyScalar(dist);
    this.runtime.camera.position.copy(this.runtime.controls.target).add(offset);
    this.runtime.controls.minDistance = dist * 0.45;
    this.runtime.controls.maxDistance = dist * 2.2;
  }

  public degradeQuality(): boolean {
    if (this.runtime.degradeQuality()) return true;
    if (this.qualityTier > 0) {
      this.qualityTier -= 1;
      return true;
    }
    return false;
  }

  public render(bands: Float32Array, settings: AppSettingsV1): void {
    if (!this.runtime.alive) return;

    const { now, rawDt } = this.runtime.beginFrame();
    const reduced = this.runtime.applyControls(settings, 0.58);
    const dt = reduced ? 0 : rawDt * atmosphereSpeed(settings);
    if (!reduced) {
      this.simTime += dt;
      this.energy.update(bands, dt);
    }

    // Update light shaft shader uniforms
    const u = this.shaftMaterial.uniforms;
    u.uCamPos.value.copy(this.runtime.camera.position);
    u.uTime.value = this.simTime;
    u.uBass.value = this.energy.bass;
    u.uMid.value = this.energy.mid;
    u.uTreble.value = this.energy.treble;
    u.uEnergy.value = this.energy.energy;
    u.uPulse.value = this.energy.heatPulse;
    u.uHue.value = settings.colorMode === 'spectrum' ? (this.energy.mid * 0.15) % 1 : 0;
    u.uSat.value = settings.colorMode === 'mono' ? 0.05 : 0.35;

    // Sunlight breathing
    this.sunLight.intensity = 2.6 + this.energy.bass * 1.5 + this.energy.heatPulse * 0.8;
    this.clearingLight.intensity = 1.8 + this.energy.energy * 1.2;

    this.updatePollen(dt, reduced);
    this.updateFallingLeaves(dt, reduced);

    this.runtime.renderScene(now);
  }

  public destroy(): void {
    if (this.runtime.isDestroyed) return;
    this.floorMap.dispose();
    this.barkMap.dispose();
    this.runtime.disposeSceneGraph();
    this.runtime.destroy();
  }
}
