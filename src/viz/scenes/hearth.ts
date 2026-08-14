import * as THREE from 'three';
import { AppSettingsV1 } from '../../storage/settings';
import { AudioEnergySmoother } from '../audio-energy';
import { atmosphereSpeed, SceneVisualizerOptions } from '../scene';
import { SceneRuntime } from '../scene-runtime';

const MAX_COALS = 24;
const MAX_SPARKS = 80;

interface Spark {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
}

const FIRE_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FIRE_FRAG = /* glsl */ `
precision highp float;

varying vec3 vWorldPos;

uniform vec3 uCamPos;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uEnergy;
uniform float uPulse;
uniform float uHeight;
uniform float uHue;
uniform float uSat;
uniform int uSteps;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.52;
  }
  return s;
}

vec2 boxIntersect(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (bmin - ro) * inv;
  vec3 t1 = (bmax - ro) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  float enter = max(max(tmin.x, tmin.y), tmin.z);
  float exit = min(min(tmax.x, tmax.y), tmax.z);
  return vec2(enter, exit);
}

vec3 fireTint(float t, float hue, float sat) {
  vec3 ember = vec3(0.20, 0.02, 0.004);
  vec3 orange = vec3(0.98, 0.26, 0.02);
  vec3 gold = vec3(1.0, 0.70, 0.16);
  vec3 white = vec3(1.0, 0.95, 0.78);
  vec3 col = mix(ember, orange, smoothstep(0.0, 0.32, t));
  col = mix(col, gold, smoothstep(0.26, 0.68, t));
  col = mix(col, white, smoothstep(0.58, 1.0, t));

  float angle = hue * 6.28318;
  vec3 shift = vec3(
    0.12 * sin(angle),
    0.04 * sin(angle + 2.1),
    0.10 * cos(angle)
  );
  col = mix(col, col + shift, sat * 0.55);
  return max(col, vec3(0.0));
}

void main() {
  vec3 ro = uCamPos;
  vec3 rd = normalize(vWorldPos - uCamPos);
  vec2 hit = boxIntersect(ro, rd, uBoxMin, uBoxMax);
  if (hit.y < hit.x || hit.y < 0.0) discard;

  float t0 = max(hit.x, 0.0);
  float t1 = hit.y;
  vec3 boxSize = max(uBoxMax - uBoxMin, vec3(0.001));
  float height = mix(0.40, 1.0, clamp(uHeight, 0.0, 1.0));

  vec3 acc = vec3(0.0);
  float trans = 1.0;
  int steps = clamp(uSteps, 16, 56);
  float dt = (t1 - t0) / float(steps);
  float dance = uTime * (1.05 + uEnergy * 0.85 + uPulse * 0.35);

  for (int i = 0; i < 56; i++) {
    if (i >= steps || trans < 0.012) break;
    float t = t0 + (float(i) + 0.5) * dt;
    vec3 p = ro + rd * t;

    float y = p.y / max(boxSize.y * height, 0.001);
    if (y < -0.04 || y > 1.14) continue;

    vec3 adv = p;
    adv.y -= uTime * (1.05 + uBass * 0.85 + uPulse * 0.5);
    adv.x += sin(dance * 1.55 + p.y * 3.6) * (0.07 + uBass * 0.06);
    adv.z += cos(dance * 1.28 + p.y * 2.9) * (0.06 + uBass * 0.05);
    float n = fbm(adv * vec3(2.55, 1.18, 2.55));
    float flicker = fbm(adv * 5.6 + vec3(0.0, -uTime * 2.35, 0.0));

    float swayX = sin(dance * 1.72 + p.y * 2.8 + n * 2.4) * (0.055 + uBass * 0.07 + uPulse * 0.05);
    float swayZ = cos(dance * 1.38 + p.y * 2.3 + flicker * 2.0) * (0.05 + uBass * 0.06);
    vec2 xz = p.xz - vec2(swayX, swayZ);
    xz += vec2(n - 0.5, flicker - 0.5) * (0.15 + uMid * 0.1);

    float r = length(xz);
    float ang = atan(xz.y, xz.x);

    float lobeA = pow(0.5 + 0.5 * sin(ang * 5.0 + dance * 2.55 + n * 5.4 + uPulse * 2.4), 2.15);
    float lobeB = pow(0.5 + 0.5 * sin(ang * 3.0 - dance * 1.72 + flicker * 4.2 + uMid * 1.6), 1.7);
    float lobes = 0.52 * lobeA + 0.48 * lobeB;

    float baseR = mix(0.36 + uBass * 0.14 + uPulse * 0.08, 0.034, pow(clamp(y, 0.0, 1.0), 0.66));
    float radius = baseR * mix(0.68, 1.28, lobes);
    float shape = smoothstep(radius + 0.11, radius - 0.045, r);
    shape *= smoothstep(-0.03, 0.09, y) * (1.0 - smoothstep(0.76, 1.07, y));

    float coreR = mix(0.15 + uBass * 0.04, 0.022, clamp(y, 0.0, 1.0));
    float core = smoothstep(coreR, coreR * 0.15, r) * (1.0 - smoothstep(0.52, 0.92, y));
    shape = max(shape, core * 0.96);

    float dens = shape * (0.24 + n * 1.02) * (0.48 + uEnergy * 0.95 + uPulse * 0.48);
    dens *= 1.0 - smoothstep(0.42, 1.02, y);
    dens += shape * flicker * (0.10 + uTreble * 0.34);
    dens = max(dens, 0.0);

    float heat = clamp(shape * (1.22 - y * 0.92) * (0.38 + n * 0.72 + uMid * 0.28 + core * 0.35), 0.0, 1.0);
    vec3 col = fireTint(heat, uHue, uSat);
    col += vec3(1.0, 0.86, 0.42) * pow(heat, 3.8) * (0.16 + uTreble * 0.4 + uPulse * 0.12);

    float absorb = 1.0 - exp(-dens * dt * 6.8);
    acc += trans * col * absorb;
    trans *= 1.0 - absorb;
  }

  if (acc.r + acc.g + acc.b < 0.01 && trans > 0.97) discard;
  float alpha = clamp(1.0 - trans, 0.0, 1.0);
  gl_FragColor = vec4(acc, alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const SPARK_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 color;
uniform float uPixelRatio;
varying vec3 vColor;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.2, aSize * (220.0 / max(-mv.z, 0.08)) * uPixelRatio);
  gl_Position = projectionMatrix * mv;
}
`;

const SPARK_FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.0) discard;
  float glow = pow(1.0 - d, 1.65);
  float core = pow(max(0.0, 1.0 - d * 2.4), 2.2);
  vec3 col = vColor * glow + vec3(1.0, 0.92, 0.7) * core;
  gl_FragColor = vec4(col, glow);

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
  if (!ctx) throw new Error('Failed to create hearth texture');
  draw(ctx, size);
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = colorSpace;
  map.anisotropy = 8;
  map.needsUpdate = true;
  return map;
}

function makeBarkMaps(): { map: THREE.CanvasTexture; roughness: THREE.CanvasTexture } {
  const map = canvasTexture(256, (ctx, size) => {
    const base = ctx.createLinearGradient(0, 0, size, 0);
    base.addColorStop(0, '#1c100a');
    base.addColorStop(0.35, '#4a2a16');
    base.addColorStop(0.7, '#2c1810');
    base.addColorStop(1, '#1a0e08');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 48; i++) {
      ctx.strokeStyle = `rgba(14, 8, 4, ${0.28 + Math.random() * 0.5})`;
      ctx.lineWidth = 1 + Math.random() * 3.4;
      const x = Math.random() * size;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 5, size * 0.32, x - 7, size * 0.68, x + (Math.random() - 0.5) * 10, size);
      ctx.stroke();
    }
    for (let i = 0; i < 22; i++) {
      ctx.fillStyle = `rgba(255, 110, 28, ${0.035 + Math.random() * 0.09})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 2, 16 + Math.random() * 44);
    }
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = `rgba(8, 4, 2, ${0.18 + Math.random() * 0.28})`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * size, Math.random() * size, 6 + Math.random() * 14, 3 + Math.random() * 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  const roughness = canvasTexture(
    256,
    (ctx, size) => {
      ctx.fillStyle = '#4e4e4e';
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 56; i++) {
        ctx.strokeStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.12})`;
        ctx.lineWidth = 2;
        const x = Math.random() * size;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (Math.random() - 0.5) * 7, size);
        ctx.stroke();
      }
    },
    THREE.NoColorSpace
  );
  return { map, roughness };
}

function makeEarthMap(): THREE.CanvasTexture {
  return canvasTexture(512, (ctx, size) => {
    const g = ctx.createRadialGradient(size * 0.5, size * 0.5, size * 0.04, size * 0.5, size * 0.5, size * 0.5);
    g.addColorStop(0, '#1a0c08');
    g.addColorStop(0.18, '#2a1610');
    g.addColorStop(0.42, '#3a2818');
    g.addColorStop(1, '#16110e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 220; i++) {
      const r = 70 + Math.random() * 50;
      const gg = 50 + Math.random() * 32;
      const b = 32 + Math.random() * 22;
      ctx.fillStyle = `rgba(${r},${gg},${b},${0.07 + Math.random() * 0.14})`;
      ctx.beginPath();
      ctx.ellipse(
        Math.random() * size,
        Math.random() * size,
        4 + Math.random() * 18,
        2 + Math.random() * 8,
        Math.random() * Math.PI,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    for (let i = 0; i < 80; i++) {
      ctx.fillStyle = `rgba(${20 + Math.random() * 24},${14 + Math.random() * 16},${10 + Math.random() * 10},${0.15})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1);
    }
  });
}

export class EmberHearth {
  private readonly runtime: SceneRuntime;
  private readonly energy = new AudioEnergySmoother({
    bass: 0.16,
    mid: 0.13,
    treble: 0.2,
    energy: 0.12,
    pulseDecay: 2.05,
  });

  private readonly barkMaps: { map: THREE.CanvasTexture; roughness: THREE.CanvasTexture };
  private readonly earthMap: THREE.CanvasTexture;

  private readonly fireMaterial: THREE.ShaderMaterial;
  private readonly fireMesh: THREE.Mesh;
  private readonly fireBox = new THREE.Box3(
    new THREE.Vector3(-0.7, 0.02, -0.7),
    new THREE.Vector3(0.7, 1.88, 0.7)
  );

  private readonly fireLight: THREE.PointLight;
  private readonly groundLight: THREE.PointLight;
  private readonly logMats: THREE.MeshStandardMaterial[] = [];
  private readonly groundGlow: THREE.MeshBasicMaterial;
  private readonly coalMesh: THREE.InstancedMesh;
  private readonly coalDummy = new THREE.Object3D();
  private readonly coalSeeds: Array<{ pos: THREE.Vector3; radius: number; phase: number }> = [];

  private readonly sparkGeom: THREE.BufferGeometry;
  private readonly sparkMat: THREE.ShaderMaterial;
  private readonly sparkPositions: Float32Array;
  private readonly sparkSizes: Float32Array;
  private readonly sparkColors: Float32Array;
  private readonly sparks: Spark[] = [];
  private sparkCount = MAX_SPARKS;
  private coalCount = MAX_COALS;
  private qualityTier = 2;
  private simTime = 0;
  private spawnAcc = 0;

  constructor(container: HTMLElement, options: SceneVisualizerOptions = {}) {
    this.runtime = new SceneRuntime(container, {
      onContextLost: options.onContextLost,
      fov: 40,
      near: 0.08,
      far: 40,
      cameraPosition: [2.15, 1.12, 2.4],
      target: [0, 0.5, 0],
      enablePan: false,
      minDistance: 1.55,
      maxDistance: 6.4,
      minPolarAngle: Math.PI * 0.18,
      maxPolarAngle: Math.PI * 0.78,
      dampingFactor: 0.07,
      background: 0x05070e,
      fogDensity: 0.042,
      toneMappingExposure: 0.98,
      useEnvironment: true,
      environmentIntensity: 0.1,
      environmentBlur: 0.1,
      autoRotateSpeedScale: 0.72,
      onResize: () => this.frameHearth(),
    });

    this.barkMaps = makeBarkMaps();
    this.earthMap = makeEarthMap();

    this.buildCamp();
    this.buildLogs();

    this.fireMaterial = new THREE.ShaderMaterial({
      vertexShader: FIRE_VERT,
      fragmentShader: FIRE_FRAG,
      uniforms: {
        uCamPos: { value: new THREE.Vector3() },
        uBoxMin: { value: this.fireBox.min.clone() },
        uBoxMax: { value: this.fireBox.max.clone() },
        uTime: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTreble: { value: 0 },
        uEnergy: { value: 0 },
        uPulse: { value: 0 },
        uHeight: { value: 0.72 },
        uHue: { value: 0.04 },
        uSat: { value: 0.35 },
        uSteps: { value: 42 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const fireSize = new THREE.Vector3();
    this.fireBox.getSize(fireSize);
    const fireCenter = new THREE.Vector3();
    this.fireBox.getCenter(fireCenter);
    this.fireMesh = new THREE.Mesh(new THREE.BoxGeometry(fireSize.x, fireSize.y, fireSize.z), this.fireMaterial);
    this.fireMesh.position.copy(fireCenter);
    this.fireMesh.renderOrder = 3;
    this.runtime.scene.add(this.fireMesh);

    this.fireLight = new THREE.PointLight(0xff6a28, 9.2, 8.4, 1.45);
    this.fireLight.position.set(0, 0.52, 0);
    this.runtime.scene.add(this.fireLight);

    this.groundLight = new THREE.PointLight(0xff7a38, 2.6, 4.8, 1.7);
    this.groundLight.position.set(0, 0.1, 0);
    this.runtime.scene.add(this.groundLight);

    this.groundGlow = new THREE.MeshBasicMaterial({
      color: 0x7a2208,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(new THREE.CircleGeometry(1.55, 40), this.groundGlow);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.012;
    glow.renderOrder = 1;
    this.runtime.scene.add(glow);

    this.coalMesh = this.buildCoals();
    const spark = this.buildSparks();
    this.sparkGeom = spark.geometry;
    this.sparkMat = spark.material;
    this.sparkPositions = spark.positions;
    this.sparkSizes = spark.sizes;
    this.sparkColors = spark.colors;

    this.runtime.resize();
  }

  private buildCamp(): void {
    const scene = this.runtime.scene;

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(5.4, 48),
      new THREE.MeshStandardMaterial({
        color: 0x2a1c14,
        map: this.earthMap,
        roughness: 0.94,
        metalness: 0.02,
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    scene.add(ground);

    const ash = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 28),
      new THREE.MeshStandardMaterial({
        color: 0x1a100c,
        roughness: 0.9,
        metalness: 0.04,
        emissive: new THREE.Color(0x3a1208),
        emissiveIntensity: 0.22,
      })
    );
    ash.rotation.x = -Math.PI / 2;
    ash.position.y = 0.002;
    scene.add(ash);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(9.2, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.56),
      new THREE.MeshBasicMaterial({ color: 0x060810, side: THREE.BackSide, fog: false })
    );
    sky.position.y = 0.4;
    scene.add(sky);
    this.buildStars();

    scene.add(new THREE.AmbientLight(0x141820, 0.16));
    const hemi = new THREE.HemisphereLight(0xffc29a, 0x05060c, 0.22);
    scene.add(hemi);
  }

  private buildStars(): void {
    const count = 96;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.42;
      const radius = 7.6;
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi) * 0.62 + 1.35;
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
      const warm = Math.random() > 0.82;
      colors[i * 3] = warm ? 1 : 0.78 + Math.random() * 0.2;
      colors[i * 3 + 1] = warm ? 0.86 : 0.84 + Math.random() * 0.12;
      colors[i * 3 + 2] = warm ? 0.62 : 1;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const stars = new THREE.Points(
      geom,
      new THREE.PointsMaterial({
        size: 0.035,
        vertexColors: true,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    stars.frustumCulled = false;
    this.runtime.scene.add(stars);
  }

  private buildLogs(): void {
    const specs = [
      { pos: new THREE.Vector3(-0.18, 0.078, 0.12), rot: new THREE.Euler(0.1, 0.58, 1.22), len: 0.8, r: 0.074, char: 0.32 },
      { pos: new THREE.Vector3(0.2, 0.074, 0.08), rot: new THREE.Euler(0.06, -0.82, -1.16), len: 0.76, r: 0.07, char: 0.4 },
      { pos: new THREE.Vector3(0.02, 0.072, -0.2), rot: new THREE.Euler(-0.08, 0.12, 0.16), len: 0.82, r: 0.072, char: 0.28 },
      { pos: new THREE.Vector3(-0.1, 0.17, -0.04), rot: new THREE.Euler(0.24, 0.92, 0.52), len: 0.62, r: 0.054, char: 0.58 },
      { pos: new THREE.Vector3(0.12, 0.19, 0.09), rot: new THREE.Euler(-0.2, -0.42, -0.5), len: 0.58, r: 0.05, char: 0.64 },
      { pos: new THREE.Vector3(0.0, 0.27, 0.015), rot: new THREE.Euler(0.14, 0.22, 0.2), len: 0.48, r: 0.042, char: 0.74 },
      { pos: new THREE.Vector3(0.24, 0.13, -0.14), rot: new THREE.Euler(0.38, 1.12, 0.72), len: 0.44, r: 0.038, char: 0.5 },
    ];

    for (const spec of specs) {
      const map = this.barkMaps.map.clone();
      map.repeat.set(2.2, 1);
      map.needsUpdate = true;
      const shade = 0.55 + spec.char * 0.2;
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setRGB(0.38 * shade, 0.2 * shade, 0.1 * shade),
        map,
        roughnessMap: this.barkMaps.roughness,
        roughness: 0.8,
        metalness: 0.04,
        emissive: new THREE.Color(0x4a1408),
        emissiveIntensity: 0.12 + spec.char * 0.22,
      });
      this.logMats.push(mat);
      const log = new THREE.Mesh(new THREE.CylinderGeometry(spec.r * 0.9, spec.r, spec.len, 12, 3), mat);
      log.position.copy(spec.pos);
      log.rotation.copy(spec.rot);
      this.runtime.scene.add(log);
    }
  }

  private buildCoals(): THREE.InstancedMesh {
    const geom = new THREE.SphereGeometry(1, 8, 6);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x160a06,
      emissive: new THREE.Color(0xff4a12),
      emissiveIntensity: 0.85,
      roughness: 0.68,
      metalness: 0.08,
    });
    const mesh = new THREE.InstancedMesh(geom, mat, MAX_COALS);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_COALS; i++) {
      const a = (i / MAX_COALS) * Math.PI * 2 + i * 0.41;
      const r = 0.05 + (i % 6) * 0.038;
      this.coalSeeds.push({
        pos: new THREE.Vector3(Math.cos(a) * r, 0.055 + (i % 4) * 0.018, Math.sin(a) * r),
        radius: 0.026 + (i % 5) * 0.009,
        phase: i * 1.17,
      });
    }
    this.runtime.scene.add(mesh);
    return mesh;
  }

  private buildSparks(): {
    geometry: THREE.BufferGeometry;
    material: THREE.ShaderMaterial;
    positions: Float32Array;
    sizes: Float32Array;
    colors: Float32Array;
  } {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_SPARKS * 3);
    const sizes = new Float32Array(MAX_SPARKS);
    const colors = new Float32Array(MAX_SPARKS * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.ShaderMaterial({
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
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

    for (let i = 0; i < MAX_SPARKS; i++) {
      this.sparks.push({
        pos: new THREE.Vector3(0, -10, 0),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 0.02,
      });
    }
    return { geometry, material, positions, sizes, colors };
  }

  private palette(settings: AppSettingsV1): { hue: number; sat: number; light: THREE.Color } {
    if (settings.colorMode === 'mood') {
      return {
        hue: 0.96 + this.energy.bass * 0.04,
        sat: 0.55,
        light: new THREE.Color().setHSL(0.04, 0.85, 0.52),
      };
    }
    if (settings.colorMode === 'spectrum') {
      return {
        hue: (0.03 + this.energy.mid * 0.08) % 1,
        sat: 0.42,
        light: new THREE.Color().setHSL(0.045, 0.9, 0.5),
      };
    }
    return {
      hue: 0.035,
      sat: 0.15,
      light: new THREE.Color(0xff6a28),
    };
  }

  private applyQualityTier(): void {
    const steps = [22, 32, 42][this.qualityTier];
    this.fireMaterial.uniforms.uSteps.value = steps;
    this.sparkCount = [22, 48, MAX_SPARKS][this.qualityTier];
    this.coalCount = [10, 16, MAX_COALS][this.qualityTier];
  }

  private updateCoals(): void {
    const mid = this.energy.mid;
    const pulse = this.energy.heatPulse;
    for (let i = 0; i < MAX_COALS; i++) {
      const seed = this.coalSeeds[i];
      if (!seed || i >= this.coalCount) {
        this.coalDummy.scale.setScalar(0);
        this.coalDummy.position.set(0, -4, 0);
        this.coalDummy.updateMatrix();
        this.coalMesh.setMatrixAt(i, this.coalDummy.matrix);
        continue;
      }
      const breathe = 1 + Math.sin(this.simTime * 2.2 + seed.phase) * 0.09 + mid * 0.2 + pulse * 0.14;
      this.coalDummy.position.copy(seed.pos);
      this.coalDummy.scale.setScalar(seed.radius * breathe);
      this.coalDummy.updateMatrix();
      this.coalMesh.setMatrixAt(i, this.coalDummy.matrix);
    }
    this.coalMesh.instanceMatrix.needsUpdate = true;
    const mat = this.coalMesh.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 0.58 + mid * 1.2 + pulse * 0.7;
  }

  private spawnSpark(): void {
    const spark = this.sparks.find((item) => item.life <= 0);
    if (!spark) return;
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.random() * 0.24;
    spark.pos.set(Math.cos(ang) * rad, 0.16 + Math.random() * 0.28, Math.sin(ang) * rad);
    const burst = 0.55 + this.energy.bass * 0.85 + this.energy.heatPulse * 1.15;
    const spray = 0.55 + this.energy.treble * 0.7;
    spark.vel.set(
      Math.cos(ang) * (0.08 + Math.random() * 0.42) * spray,
      burst * (0.42 + Math.random() * 0.95),
      Math.sin(ang) * (0.08 + Math.random() * 0.42) * spray
    );
    spark.maxLife = 0.65 + Math.random() * 1.35;
    spark.life = spark.maxLife;
    spark.size = 0.012 + Math.random() * 0.028;
  }

  private updateSparks(dt: number, reduced: boolean): void {
    if (!reduced) {
      this.spawnAcc += dt * (0.55 + this.energy.treble * 8.8 + this.energy.heatPulse * 4.2 + this.energy.energy * 2.2);
      while (this.spawnAcc > 1) {
        this.spawnAcc -= 1;
        const live = this.sparks.filter((s) => s.life > 0).length;
        if (live < this.sparkCount) this.spawnSpark();
      }
    }

    for (let i = 0; i < MAX_SPARKS; i++) {
      const spark = this.sparks[i];
      if (spark.life > 0 && !reduced) {
        spark.life -= dt;
        spark.vel.y += 0.18 * dt;
        spark.vel.x += Math.sin(this.simTime * 6.2 + i) * this.energy.treble * 0.22 * dt;
        spark.vel.z += Math.cos(this.simTime * 5.4 + i) * this.energy.treble * 0.18 * dt;
        spark.vel.multiplyScalar(Math.exp(-0.48 * dt));
        spark.pos.addScaledVector(spark.vel, dt);
      }
      const alive = spark.life > 0;
      const fade = alive ? Math.min(1, spark.life / 0.18) * Math.min(1, (spark.maxLife - spark.life) / 0.12) : 0;
      this.sparkPositions[i * 3] = alive ? spark.pos.x : 0;
      this.sparkPositions[i * 3 + 1] = alive ? spark.pos.y : -10;
      this.sparkPositions[i * 3 + 2] = alive ? spark.pos.z : 0;
      this.sparkSizes[i] = alive ? spark.size * (0.65 + fade * 1.15) : 0;
      this.sparkColors[i * 3] = 1.0;
      this.sparkColors[i * 3 + 1] = 0.42 + fade * 0.4;
      this.sparkColors[i * 3 + 2] = 0.1 + fade * 0.12;
    }
    this.sparkGeom.getAttribute('position').needsUpdate = true;
    this.sparkGeom.getAttribute('aSize').needsUpdate = true;
    this.sparkGeom.getAttribute('color').needsUpdate = true;
    this.sparkMat.uniforms.uPixelRatio.value = this.runtime.currentPixelRatio;
  }

  private updateFire(settings: AppSettingsV1): void {
    const u = this.fireMaterial.uniforms;
    u.uCamPos.value.copy(this.runtime.camera.position);
    u.uTime.value = this.simTime;
    u.uBass.value = this.energy.bass;
    u.uMid.value = this.energy.mid;
    u.uTreble.value = this.energy.treble;
    u.uEnergy.value = this.energy.energy;
    u.uPulse.value = this.energy.heatPulse;
    u.uHeight.value = 0.5 + this.energy.bass * 0.44 + this.energy.heatPulse * 0.28;

    const pal = this.palette(settings);
    u.uHue.value = pal.hue;
    u.uSat.value = pal.sat;

    const flicker = 0.1 * Math.sin(this.simTime * 7.2) + 0.06 * Math.sin(this.simTime * 13.1);
    this.fireLight.color.copy(pal.light);
    this.fireLight.intensity = 5.8 + this.energy.bass * 8.4 + this.energy.heatPulse * 4.2 + flicker;
    this.fireLight.position.set(
      Math.sin(this.simTime * 1.6) * 0.05,
      0.46 + this.energy.bass * 0.18 + this.energy.heatPulse * 0.12,
      Math.cos(this.simTime * 1.25) * 0.05
    );
    this.groundLight.intensity = 1.5 + this.energy.energy * 2.6 + this.energy.heatPulse * 0.8;
    this.groundLight.color.copy(pal.light);
    this.groundGlow.opacity = 0.28 + this.energy.bass * 0.38 + this.energy.heatPulse * 0.18;

    const logGlow = 0.14 + this.energy.mid * 0.62 + this.energy.heatPulse * 0.22;
    for (const mat of this.logMats) {
      mat.emissiveIntensity = logGlow;
      mat.emissive.copy(pal.light).multiplyScalar(0.38);
    }
  }

  private frameHearth(): void {
    this.runtime.controls.target.set(0, 0.5, 0);
    const vFov = THREE.MathUtils.degToRad(this.runtime.camera.fov);
    const aspect = Math.max(this.runtime.camera.aspect, 0.2);
    const fitH = 1.72;
    const fitW = 1.55;
    const distH = fitH / 2 / Math.tan(vFov / 2);
    const distW = fitW / 2 / (Math.tan(vFov / 2) * aspect);
    const dist = Math.max(distH, distW) * 1.12;

    const offset = this.runtime.camera.position.clone().sub(this.runtime.controls.target);
    if (offset.lengthSq() < 1e-6) offset.set(0.55, 0.28, 1);
    offset.normalize().multiplyScalar(dist);
    this.runtime.camera.position.copy(this.runtime.controls.target).add(offset);
    this.runtime.controls.minDistance = dist * 0.48;
    this.runtime.controls.maxDistance = dist * 2.15;
  }

  public degradeQuality(): boolean {
    if (this.runtime.degradeQuality()) return true;
    if (this.qualityTier > 0) {
      this.qualityTier -= 1;
      this.applyQualityTier();
      return true;
    }
    return false;
  }

  public render(bands: Float32Array, settings: AppSettingsV1): void {
    if (!this.runtime.alive) return;

    const { now, rawDt } = this.runtime.beginFrame();
    const reduced = this.runtime.applyControls(settings, 0.72);
    const dt = reduced ? 0 : rawDt * atmosphereSpeed(settings);
    if (!reduced) {
      this.simTime += dt;
      this.energy.update(bands, dt);
    }

    this.updateFire(settings);
    this.updateCoals();
    this.updateSparks(dt, reduced);
    this.runtime.renderScene(now);
  }

  public destroy(): void {
    if (this.runtime.isDestroyed) return;
    this.barkMaps.map.dispose();
    this.barkMaps.roughness.dispose();
    this.earthMap.dispose();
    this.runtime.disposeSceneGraph();
    this.runtime.destroy();
  }
}
