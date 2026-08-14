import * as THREE from 'three';
import { AppSettingsV1 } from '../../storage/settings';
import { AudioEnergySmoother } from '../audio-energy';
import { atmosphereSpeed, SceneVisualizerOptions } from '../scene';
import { SceneRuntime } from '../scene-runtime';

const MAX_FIREFLIES = 45;
const KOI_COUNT = 7;
const LANTERN_COUNT = 4;

interface Firefly {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  phase: number;
  blinkSpeed: number;
  size: number;
}

interface KoiFish {
  pos: THREE.Vector3;
  heading: number;
  speed: number;
  swimPhase: number;
  colorIdx: number;
  turnTimer: number;
  depth: number;
  meshGroup: THREE.Group;
  tailMesh: THREE.Mesh;
  bodyMesh: THREE.Mesh;
}

interface FloatingLantern {
  pos: THREE.Vector3;
  basePos: THREE.Vector3;
  rot: number;
  phase: number;
  meshGroup: THREE.Group;
  light: THREE.PointLight;
}

const WATER_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormal;

void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const WATER_FRAG = /* glsl */ `
precision highp float;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormal;

uniform vec3 uCamPos;
uniform vec3 uLanternPos[4];
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

  // Concentric water ripples from lanterns and koi
  float ripple = 0.0;
  for (int i = 0; i < 4; i++) {
    float dist = length(vWorldPos.xz - uLanternPos[i].xz);
    float ring = sin(dist * 14.0 - uTime * 3.5);
    ripple += ring * exp(-dist * 1.6) * (0.04 + uBass * 0.05);
  }

  // Gentle ambient pond micro-chatter
  vec2 nUv = vWorldPos.xz * 4.5 + vec2(uTime * 0.1, uTime * 0.08);
  float n1 = fbm(nUv);
  float n2 = fbm(nUv * 2.0 - vec2(0.0, uTime * 0.15));
  vec3 pondNormal = normalize(vec3((n1 - 0.5) * 0.15 + ripple * 0.8, 1.0, (n2 - 0.5) * 0.15 + ripple * 0.8));

  // Fresnel glass-like reflection
  float fresnel = pow(1.0 - max(dot(viewDir, pondNormal), 0.0), 4.0);
  fresnel = clamp(fresnel * 0.82 + 0.1, 0.0, 1.0);

  // Pond water base color (deep clear jade / midnight water)
  vec3 waterDeep = vec3(0.02, 0.06, 0.08);
  vec3 waterShallow = vec3(0.04, 0.14, 0.16);
  vec3 skyReflect = vec3(0.06, 0.1, 0.18);

  float pondEdge = length(vWorldPos.xz) / 3.2;
  vec3 waterColor = mix(waterShallow, waterDeep, clamp(1.0 - pondEdge, 0.0, 1.0));

  // Dynamic warm lantern reflection highlights across ripples
  vec3 lanternReflection = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec3 lDir = normalize(uLanternPos[i] - vWorldPos);
    vec3 halfVec = normalize(viewDir + lDir);
    float spec = pow(max(dot(pondNormal, halfVec), 0.0), 38.0);
    float dist = length(uLanternPos[i] - vWorldPos);
    float atten = 1.0 / (1.0 + dist * 2.5);
    lanternReflection += vec3(1.0, 0.72, 0.28) * spec * atten * (2.8 + uBass * 2.5);
  }

  // Water surface glints & sparkles
  float sparkle = pow(clamp(n1 * n2 * 1.8, 0.0, 1.0), 4.5) * (0.2 + uTreble * 0.9);
  vec3 sparkleColor = vec3(1.0, 0.95, 0.8) * sparkle;

  vec3 finalColor = mix(waterColor, skyReflect, fresnel);
  finalColor += lanternReflection;
  finalColor += sparkleColor;
  finalColor = paletteShift(finalColor, uHue, uSat);

  gl_FragColor = vec4(finalColor, 0.88);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const FIREFLY_VERT = /* glsl */ `
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
  gl_PointSize = max(1.2, aSize * (200.0 / max(-mv.z, 0.1)) * uPixelRatio);
  gl_Position = projectionMatrix * mv;
}
`;

const FIREFLY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.0) discard;
  float glow = pow(1.0 - d, 1.8);
  float core = pow(max(0.0, 1.0 - d * 2.6), 2.2);
  vec3 col = vColor * glow + vec3(1.0, 1.0, 0.8) * core;
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

function makeLilyPadTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, size) => {
    const center = size * 0.5;
    ctx.fillStyle = '#1c3e1e';
    ctx.beginPath();
    // Lily pad with notch cut
    ctx.arc(center, center, center * 0.9, 0.35, Math.PI * 2 - 0.35);
    ctx.lineTo(center, center);
    ctx.closePath();
    ctx.fill();

    // Veins
    ctx.strokeStyle = '#2d5c2f';
    ctx.lineWidth = 2.0;
    for (let i = 0; i < 8; i++) {
      const ang = 0.5 + (i / 8) * (Math.PI * 2 - 1.0);
      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.lineTo(center + Math.cos(ang) * center * 0.85, center + Math.sin(ang) * center * 0.85);
      ctx.stroke();
    }
  });
}

export class LanternPond {
  private readonly runtime: SceneRuntime;
  private readonly energy = new AudioEnergySmoother({
    bass: 0.16,
    mid: 0.14,
    treble: 0.2,
    energy: 0.12,
    pulseDecay: 2.05,
  });

  private readonly lilyMap: THREE.CanvasTexture;
  private readonly waterMaterial: THREE.ShaderMaterial;
  private readonly waterMesh: THREE.Mesh;

  private readonly lanterns: FloatingLantern[] = [];
  private readonly koiFishList: KoiFish[] = [];

  private readonly fireflyGeom: THREE.BufferGeometry;
  private readonly fireflyMat: THREE.ShaderMaterial;
  private readonly fireflyPositions: Float32Array;
  private readonly fireflySizes: Float32Array;
  private readonly fireflyAlphas: Float32Array;
  private readonly fireflyColors: Float32Array;
  private readonly fireflies: Firefly[] = [];

  private simTime = 0;
  private qualityTier = 2;

  constructor(container: HTMLElement, options: SceneVisualizerOptions = {}) {
    this.runtime = new SceneRuntime(container, {
      onContextLost: options.onContextLost,
      fov: 42,
      near: 0.1,
      far: 50,
      cameraPosition: [0.3, 1.35, 2.8],
      target: [0, 0.2, 0],
      enablePan: false,
      minDistance: 1.1,
      maxDistance: 5.2,
      minPolarAngle: Math.PI * 0.15,
      maxPolarAngle: Math.PI * 0.76,
      dampingFactor: 0.07,
      background: 0x060c12,
      fogDensity: 0.035,
      toneMappingExposure: 1.02,
      useEnvironment: true,
      environmentIntensity: 0.18,
      environmentBlur: 0.15,
      autoRotateSpeedScale: 0.55,
      onResize: () => this.framePond(),
    });

    this.lilyMap = makeLilyPadTexture();

    this.buildGardenPondBank();
    this.buildLilyPadsAndLotuses();
    this.buildLanterns();
    this.buildKoiFish();

    // Water Surface Shader
    this.waterMaterial = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: {
        uCamPos: { value: new THREE.Vector3() },
        uLanternPos: {
          value: [
            new THREE.Vector3(-0.6, 0.08, 0.4),
            new THREE.Vector3(0.7, 0.08, -0.3),
            new THREE.Vector3(-0.2, 0.08, -0.8),
            new THREE.Vector3(0.5, 0.08, 0.6),
          ],
        },
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
      side: THREE.DoubleSide,
    });

    this.waterMesh = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), this.waterMaterial);
    this.waterMesh.rotation.x = -Math.PI / 2;
    this.waterMesh.position.set(0, 0.02, 0);
    this.waterMesh.renderOrder = 2;
    this.runtime.scene.add(this.waterMesh);

    // Firefly System
    const ff = this.buildFireflies();
    this.fireflyGeom = ff.geometry;
    this.fireflyMat = ff.material;
    this.fireflyPositions = ff.positions;
    this.fireflySizes = ff.sizes;
    this.fireflyAlphas = ff.alphas;
    this.fireflyColors = ff.colors;

    this.runtime.resize();
  }

  private buildGardenPondBank(): void {
    const scene = this.runtime.scene;

    // Ground Bank
    const bankMat = new THREE.MeshStandardMaterial({
      color: 0x161e14,
      roughness: 0.9,
    });
    const bank = new THREE.Mesh(new THREE.RingGeometry(3.0, 5.5, 36), bankMat);
    bank.rotation.x = -Math.PI / 2;
    bank.position.y = 0.04;
    scene.add(bank);

    // River Stones around pond edge
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x222a28,
      roughness: 0.72,
    });
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + (Math.random() - 0.5) * 0.15;
      const r = 3.05 + (Math.random() - 0.5) * 0.2;
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1), stoneMat);
      const s = 0.12 + Math.random() * 0.14;
      stone.scale.set(s * 1.3, s * 0.7, s * 1.1);
      stone.position.set(Math.cos(a) * r, 0.06, Math.sin(a) * r);
      stone.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      scene.add(stone);
    }

    // Sky Dome
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(20, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshBasicMaterial({ color: 0x040810, side: THREE.BackSide, fog: false })
    );
    sky.position.y = 0;
    scene.add(sky);

    scene.add(new THREE.AmbientLight(0x0e1824, 0.35));
    const hemi = new THREE.HemisphereLight(0x28455e, 0x08120e, 0.3);
    scene.add(hemi);
  }

  private buildLilyPadsAndLotuses(): void {
    const scene = this.runtime.scene;
    const padMat = new THREE.MeshStandardMaterial({
      map: this.lilyMap,
      roughness: 0.55,
      transparent: true,
      side: THREE.DoubleSide,
    });

    const lotusMat = new THREE.MeshStandardMaterial({
      color: 0xff88a8,
      roughness: 0.4,
      emissive: new THREE.Color(0xff4477),
      emissiveIntensity: 0.25,
    });

    const padPositions = [
      [-1.1, 0.03, 0.6],
      [-1.3, 0.03, 0.4],
      [1.0, 0.03, -0.8],
      [1.25, 0.03, -0.6],
      [-0.4, 0.03, -1.2],
      [0.85, 0.03, 0.9],
    ];

    for (let i = 0; i < padPositions.length; i++) {
      const pos = padPositions[i];
      const r = 0.22 + (i % 3) * 0.06;
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), padMat);
      pad.rotation.x = -Math.PI / 2;
      pad.rotation.z = i * 1.35;
      pad.position.set(pos[0], pos[1], pos[2]);
      pad.renderOrder = 3;
      scene.add(pad);

      // Add lotus flower on a couple of lily pads
      if (i === 0 || i === 2) {
        const lotusGroup = new THREE.Group();
        lotusGroup.position.set(pos[0] + 0.04, pos[1] + 0.02, pos[2] + 0.04);
        for (let p = 0; p < 8; p++) {
          const petal = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.075, 4), lotusMat);
          petal.rotation.z = Math.PI / 3;
          petal.rotation.y = (p / 8) * Math.PI * 2;
          lotusGroup.add(petal);
        }
        scene.add(lotusGroup);
      }
    }
  }

  private buildLanterns(): void {
    const scene = this.runtime.scene;
    const basePositions = [
      new THREE.Vector3(-0.6, 0.08, 0.4),
      new THREE.Vector3(0.7, 0.08, -0.3),
      new THREE.Vector3(-0.2, 0.08, -0.8),
      new THREE.Vector3(0.5, 0.08, 0.6),
    ];

    const paperMat = new THREE.MeshStandardMaterial({
      color: 0xffe8b8,
      emissive: new THREE.Color(0xff8a28),
      emissiveIntensity: 0.95,
      roughness: 0.65,
    });

    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x1f140e,
      roughness: 0.8,
    });

    for (let i = 0; i < LANTERN_COUNT; i++) {
      const grp = new THREE.Group();
      const bPos = basePositions[i];
      grp.position.copy(bPos);

      // Wood base float
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.18), woodMat);
      grp.add(base);

      // Paper Lantern body
      const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.16, 6), paperMat);
      paper.position.y = 0.09;
      grp.add(paper);

      // Wood top cap
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.015, 0.16), woodMat);
      cap.position.y = 0.175;
      grp.add(cap);

      // PointLight for glowing lantern
      const light = new THREE.PointLight(0xff8a28, 2.5, 3.8, 1.6);
      light.position.set(0, 0.1, 0);
      grp.add(light);

      scene.add(grp);

      this.lanterns.push({
        pos: grp.position,
        basePos: bPos.clone(),
        rot: Math.random() * Math.PI * 2,
        phase: i * 1.57,
        meshGroup: grp,
        light,
      });
    }
  }

  private buildKoiFish(): void {
    const scene = this.runtime.scene;
    const koiColors = [0xff4411, 0xffffff, 0xff8800, 0xee2211, 0xffffff, 0xff5522, 0xffffff];

    for (let i = 0; i < KOI_COUNT; i++) {
      const grp = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({
        color: koiColors[i % koiColors.length],
        roughness: 0.35,
        metalness: 0.1,
      });

      // Elongated streamlined fish body
      const bodyGeom = new THREE.ConeGeometry(0.045, 0.22, 8);
      bodyGeom.rotateX(Math.PI / 2);
      const bodyMesh = new THREE.Mesh(bodyGeom, mat);
      grp.add(bodyMesh);

      // Tail fin
      const tailGeom = new THREE.PlaneGeometry(0.06, 0.08);
      tailGeom.rotateY(Math.PI / 2);
      const tailMesh = new THREE.Mesh(tailGeom, mat);
      tailMesh.position.set(0, 0, -0.13);
      grp.add(tailMesh);

      const angle = (i / KOI_COUNT) * Math.PI * 2;
      const radius = 0.8 + (i % 3) * 0.45;
      grp.position.set(Math.cos(angle) * radius, -0.05 - (i % 2) * 0.04, Math.sin(angle) * radius);
      scene.add(grp);

      this.koiFishList.push({
        pos: grp.position,
        heading: angle + Math.PI / 2,
        speed: 0.32 + Math.random() * 0.2,
        swimPhase: i * 1.4,
        colorIdx: i,
        turnTimer: 2.0 + Math.random() * 3.0,
        depth: -0.05 - (i % 2) * 0.04,
        meshGroup: grp,
        tailMesh,
        bodyMesh,
      });
    }
  }

  private buildFireflies(): {
    geometry: THREE.BufferGeometry;
    material: THREE.ShaderMaterial;
    positions: Float32Array;
    sizes: Float32Array;
    alphas: Float32Array;
    colors: Float32Array;
  } {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_FIREFLIES * 3);
    const sizes = new Float32Array(MAX_FIREFLIES);
    const alphas = new Float32Array(MAX_FIREFLIES);
    const colors = new Float32Array(MAX_FIREFLIES * 3);

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.ShaderMaterial({
      vertexShader: FIREFLY_VERT,
      fragmentShader: FIREFLY_FRAG,
      uniforms: {
        uPixelRatio: { value: this.runtime.currentPixelRatio },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 5;
    this.runtime.scene.add(points);

    for (let i = 0; i < MAX_FIREFLIES; i++) {
      this.fireflies.push({
        pos: new THREE.Vector3(
          (Math.random() - 0.5) * 3.6,
          0.15 + Math.random() * 1.4,
          (Math.random() - 0.5) * 3.6
        ),
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.04),
        phase: Math.random() * Math.PI * 2,
        blinkSpeed: 1.5 + Math.random() * 2.5,
        size: 0.022 + Math.random() * 0.03,
      });
    }

    return { geometry, material, positions, sizes, alphas, colors };
  }

  private updateLanterns(_dt: number, reduced: boolean): void {
    const uPos = this.waterMaterial.uniforms.uLanternPos.value as THREE.Vector3[];
    for (let i = 0; i < LANTERN_COUNT; i++) {
      const l = this.lanterns[i];
      if (!reduced) {
        // Slow gentle bobbing and drifting on water
        const bob = Math.sin(this.simTime * 1.8 + l.phase) * 0.015;
        const driftX = Math.sin(this.simTime * 0.4 + l.phase) * 0.08;
        const driftZ = Math.cos(this.simTime * 0.35 + l.phase) * 0.08;

        l.meshGroup.position.set(l.basePos.x + driftX, l.basePos.y + bob, l.basePos.z + driftZ);
        l.meshGroup.rotation.y = l.rot + Math.sin(this.simTime * 0.2 + l.phase) * 0.2;
      }
      uPos[i].copy(l.meshGroup.position);

      // Light breathing with bass
      l.light.intensity = 2.0 + this.energy.bass * 2.8 + this.energy.heatPulse * 1.2;
    }
  }

  private updateKoi(dt: number, reduced: boolean): void {
    if (reduced) return;
    const swimSpeedMult = 1.0 + this.energy.mid * 1.2;

    for (const koi of this.koiFishList) {
      koi.swimPhase += dt * (2.8 + this.energy.mid * 4.0);
      koi.turnTimer -= dt;

      if (koi.turnTimer <= 0) {
        koi.turnTimer = 2.0 + Math.random() * 3.5;
        koi.heading += (Math.random() - 0.5) * 1.4;
      }

      // Steer back toward center if straying too far
      const distFromCenter = Math.sqrt(koi.pos.x * koi.pos.x + koi.pos.z * koi.pos.z);
      if (distFromCenter > 2.2) {
        const toCenter = Math.atan2(-koi.pos.z, -koi.pos.x);
        koi.heading = toCenter + (Math.random() - 0.5) * 0.6;
      }

      const vx = Math.cos(koi.heading) * koi.speed * swimSpeedMult;
      const vz = Math.sin(koi.heading) * koi.speed * swimSpeedMult;
      koi.pos.x += vx * dt;
      koi.pos.z += vz * dt;

      // Sine wave body undulation
      const sway = Math.sin(koi.swimPhase) * 0.28;
      koi.meshGroup.position.copy(koi.pos);
      koi.meshGroup.rotation.y = -koi.heading + Math.PI / 2 + sway * 0.4;
      koi.tailMesh.rotation.y = sway * 0.9;
    }
  }

  private updateFireflies(dt: number, reduced: boolean): void {
    for (let i = 0; i < MAX_FIREFLIES; i++) {
      const f = this.fireflies[i];
      if (!reduced) {
        f.pos.addScaledVector(f.vel, dt);
        f.pos.x += Math.sin(this.simTime * 2.0 + i) * 0.015 * dt;
        f.pos.z += Math.cos(this.simTime * 1.8 + i) * 0.015 * dt;

        // Keep inside garden bounds
        if (Math.abs(f.pos.x) > 2.5) f.vel.x *= -1;
        if (Math.abs(f.pos.z) > 2.5) f.vel.z *= -1;
        if (f.pos.y < 0.1 || f.pos.y > 1.6) f.vel.y *= -1;
      }

      // Firefly blinking pulse
      const blink = Math.sin(this.simTime * f.blinkSpeed + f.phase);
      const alpha = powClamped(Math.max(0, blink), 3.0) * (0.35 + this.energy.treble * 0.65);

      this.fireflyPositions[i * 3] = f.pos.x;
      this.fireflyPositions[i * 3 + 1] = f.pos.y;
      this.fireflyPositions[i * 3 + 2] = f.pos.z;
      this.fireflySizes[i] = f.size * (1.0 + this.energy.treble * 0.6);
      this.fireflyAlphas[i] = alpha;

      // Warm chartreuse / golden firefly glow
      this.fireflyColors[i * 3] = 0.85;
      this.fireflyColors[i * 3 + 1] = 1.0;
      this.fireflyColors[i * 3 + 2] = 0.35;
    }

    this.fireflyGeom.getAttribute('position').needsUpdate = true;
    this.fireflyGeom.getAttribute('aSize').needsUpdate = true;
    this.fireflyGeom.getAttribute('aAlpha').needsUpdate = true;
    this.fireflyGeom.getAttribute('color').needsUpdate = true;
    this.fireflyMat.uniforms.uPixelRatio.value = this.runtime.currentPixelRatio;
  }

  private framePond(): void {
    this.runtime.controls.target.set(0, 0.2, 0);
    const vFov = THREE.MathUtils.degToRad(this.runtime.camera.fov);
    const aspect = Math.max(this.runtime.camera.aspect, 0.2);
    const fitH = 2.4;
    const fitW = 2.4;
    const distH = fitH / 2 / Math.tan(vFov / 2);
    const distW = fitW / 2 / (Math.tan(vFov / 2) * aspect);
    const dist = Math.max(distH, distW) * 1.08;

    const offset = this.runtime.camera.position.clone().sub(this.runtime.controls.target);
    if (offset.lengthSq() < 1e-6) offset.set(0.3, 0.8, 2.4);
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
    const reduced = this.runtime.applyControls(settings, 0.55);
    const dt = reduced ? 0 : rawDt * atmosphereSpeed(settings);
    if (!reduced) {
      this.simTime += dt;
      this.energy.update(bands, dt);
    }

    // Update water uniforms
    const u = this.waterMaterial.uniforms;
    u.uCamPos.value.copy(this.runtime.camera.position);
    u.uTime.value = this.simTime;
    u.uBass.value = this.energy.bass;
    u.uMid.value = this.energy.mid;
    u.uTreble.value = this.energy.treble;
    u.uEnergy.value = this.energy.energy;
    u.uPulse.value = this.energy.heatPulse;
    u.uHue.value = settings.colorMode === 'spectrum' ? (this.energy.mid * 0.15) % 1 : 0;
    u.uSat.value = settings.colorMode === 'mono' ? 0.05 : 0.35;

    this.updateLanterns(dt, reduced);
    this.updateKoi(dt, reduced);
    this.updateFireflies(dt, reduced);

    this.runtime.renderScene(now);
  }

  public destroy(): void {
    if (this.runtime.isDestroyed) return;
    this.lilyMap.dispose();
    this.runtime.disposeSceneGraph();
    this.runtime.destroy();
  }
}

function powClamped(val: number, p: number): number {
  return Math.pow(Math.max(0, Math.min(1, val)), p);
}
