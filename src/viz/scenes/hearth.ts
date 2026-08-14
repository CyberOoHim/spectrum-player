import * as THREE from 'three';
import { AppSettingsV1 } from '../../storage/settings';
import { AudioEnergySmoother } from '../audio-energy';
import { atmosphereSpeed, SceneVisualizerOptions } from '../scene';
import { SceneRuntime } from '../scene-runtime';

const MAX_COALS = 36;
const MAX_SPARKS = 90;
const MAX_SMOKE = 25;

interface Spark {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  hueOffset: number;
}

interface SmokeParticle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
}

const FIRE_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vLocalPos;

void main() {
  vLocalPos = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FIRE_FRAG = /* glsl */ `
precision highp float;

varying vec3 vWorldPos;
varying vec3 vLocalPos;

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
    p = p * 2.08 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
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

// Realistic Blackbody-inspired fire palette with glowing coals, tongues, and blue base
vec3 campfirePalette(float heat, float yNorm, float hue, float sat) {
  vec3 blueBase = vec3(0.08, 0.22, 0.85);
  vec3 deepEmber = vec3(0.24, 0.025, 0.005);
  vec3 richOrange = vec3(0.98, 0.32, 0.02);
  vec3 goldYellow = vec3(1.0, 0.78, 0.18);
  vec3 whiteHot = vec3(1.0, 0.97, 0.88);

  vec3 col = mix(deepEmber, richOrange, smoothstep(0.0, 0.35, heat));
  col = mix(col, goldYellow, smoothstep(0.32, 0.72, heat));
  col = mix(col, whiteHot, smoothstep(0.68, 1.0, heat));

  // Subtle blue base at very root of the fire
  float blueFactor = (1.0 - smoothstep(0.0, 0.12, yNorm)) * smoothstep(0.4, 0.9, heat) * 0.45;
  col = mix(col, blueBase, blueFactor);

  // Hue and saturation shifts for color modes
  float angle = hue * 6.28318;
  vec3 shift = vec3(
    0.14 * sin(angle),
    0.05 * sin(angle + 2.1),
    0.12 * cos(angle)
  );
  col = mix(col, clamp(col + shift, 0.0, 2.0), sat * 0.55);
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
  float height = mix(0.45, 1.15, clamp(uHeight, 0.0, 1.0));

  vec3 acc = vec3(0.0);
  float trans = 1.0;
  int steps = clamp(uSteps, 18, 52);
  float dt = (t1 - t0) / float(steps);
  
  // Jumping fire tongue dynamics
  float flameSpeed = uTime * (1.35 + uEnergy * 0.95 + uPulse * 0.6);
  
  for (int i = 0; i < 52; i++) {
    if (i >= steps || trans < 0.01) break;
    float t = t0 + (float(i) + 0.5) * dt;
    vec3 p = ro + rd * t;

    // Relative height in fire box
    float y = (p.y - uBoxMin.y) / max(boxSize.y * height, 0.001);
    if (y < -0.02 || y > 1.15) continue;

    // Upward flame advection with turbulent jumping tongues
    vec3 adv = p;
    adv.y -= flameSpeed * (1.25 + uBass * 0.95 + uPulse * 0.7);
    
    // Whirling spiral sway around the logs
    float swirlAngle = p.y * 3.8 - flameSpeed * 1.6;
    adv.x += sin(swirlAngle) * (0.08 + uBass * 0.07);
    adv.z += cos(swirlAngle) * (0.08 + uBass * 0.07);

    // Multi-octave turbulence
    float n1 = fbm(adv * vec3(2.8, 1.35, 2.8));
    float n2 = fbm(adv * 5.4 + vec3(0.0, -flameSpeed * 2.2, 0.0));

    // Flame tongue lobes leaping outward and upward
    float swayX = sin(flameSpeed * 2.1 + p.y * 3.2 + n1 * 2.8) * (0.06 + uBass * 0.09 + uPulse * 0.08);
    float swayZ = cos(flameSpeed * 1.75 + p.y * 2.7 + n2 * 2.4) * (0.06 + uBass * 0.08 + uPulse * 0.07);
    vec2 xz = p.xz - vec2(swayX, swayZ);
    xz += vec2(n1 - 0.5, n2 - 0.5) * (0.16 + uMid * 0.12);

    float r = length(xz);
    float ang = atan(xz.y, xz.x);

    // Dynamic dancing tongues (3-5 licking lobes that leap)
    float tongue1 = pow(0.5 + 0.5 * sin(ang * 4.0 + flameSpeed * 3.2 + n1 * 5.6 + uPulse * 2.5), 2.4);
    float tongue2 = pow(0.5 + 0.5 * sin(ang * 3.0 - flameSpeed * 2.1 + n2 * 4.8 + uMid * 1.8), 2.0);
    float tongue3 = pow(0.5 + 0.5 * sin(ang * 5.0 + flameSpeed * 4.4 + p.y * 4.0), 2.8);
    float tongues = 0.44 * tongue1 + 0.38 * tongue2 + 0.18 * tongue3;

    // Tapering flame cone radius from log base to leaping tips
    float baseRadius = mix(0.42 + uBass * 0.16 + uPulse * 0.12, 0.025, pow(clamp(y, 0.0, 1.0), 0.72));
    float radius = baseRadius * mix(0.65, 1.42, tongues);
    
    // Core and outer flame boundary
    float shape = smoothstep(radius + 0.12, radius - 0.04, r);
    shape *= smoothstep(-0.02, 0.08, y) * (1.0 - smoothstep(0.72, 1.08, y));

    // Hot incandescent core near the coals
    float coreR = mix(0.18 + uBass * 0.05, 0.02, clamp(y, 0.0, 1.0));
    float core = smoothstep(coreR, coreR * 0.12, r) * (1.0 - smoothstep(0.48, 0.95, y));
    shape = max(shape, core * 0.95);

    // Density and heat accumulation
    float density = shape * (0.28 + n1 * 1.1) * (0.52 + uEnergy * 1.05 + uPulse * 0.55);
    density *= 1.0 - smoothstep(0.45, 1.05, y);
    density += shape * n2 * (0.12 + uTreble * 0.45);
    density = max(density, 0.0);

    float heat = clamp(shape * (1.28 - y * 0.88) * (0.42 + n1 * 0.75 + uMid * 0.32 + core * 0.4), 0.0, 1.0);
    vec3 col = campfirePalette(heat, y, uHue, uSat);
    col += vec3(1.0, 0.9, 0.5) * pow(heat, 4.0) * (0.22 + uTreble * 0.45 + uPulse * 0.18);

    float absorb = 1.0 - exp(-density * dt * 7.2);
    acc += trans * col * absorb;
    trans *= 1.0 - absorb;
  }

  if (acc.r + acc.g + acc.b < 0.008 && trans > 0.98) discard;
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
  gl_PointSize = max(1.2, aSize * (230.0 / max(-mv.z, 0.08)) * uPixelRatio);
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
  float glow = pow(1.0 - d, 1.75);
  float core = pow(max(0.0, 1.0 - d * 2.2), 2.4);
  vec3 col = vColor * glow + vec3(1.0, 0.95, 0.75) * core;
  gl_FragColor = vec4(col, glow);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const SMOKE_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
uniform float uPixelRatio;
varying float vAlpha;

void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, aSize * (160.0 / max(-mv.z, 0.1)) * uPixelRatio);
  gl_Position = projectionMatrix * mv;
}
`;

const SMOKE_FRAG = /* glsl */ `
precision highp float;
varying float vAlpha;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.0) discard;
  float glow = pow(1.0 - d, 2.2);
  vec3 smokeCol = vec3(0.18, 0.15, 0.16);
  gl_FragColor = vec4(smokeCol, glow * vAlpha * 0.45);

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

function makeCharredWoodMaps(): {
  map: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
} {
  // Realistic charred firewood with glowing fissures and alligator bark
  const map = canvasTexture(512, (ctx, size) => {
    // Dark charred wood base
    ctx.fillStyle = '#140c08';
    ctx.fillRect(0, 0, size, size);

    // Deep char scales / alligator pattern
    for (let y = 0; y < size; y += 24) {
      for (let x = 0; x < size; x += 28) {
        const tone = 0.7 + Math.random() * 0.5;
        ctx.fillStyle = `rgb(${Math.floor(22 * tone)}, ${Math.floor(14 * tone)}, ${Math.floor(10 * tone)})`;
        ctx.fillRect(x + 2, y + 2, 24 + Math.random() * 6, 20 + Math.random() * 6);

        // Crack outlines
        ctx.strokeStyle = '#050302';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(x + 2, y + 2, 24, 20);
      }
    }

    // Split wood grain on some sides
    for (let i = 0; i < 60; i++) {
      ctx.strokeStyle = `rgba(50, 26, 14, ${0.15 + Math.random() * 0.35})`;
      ctx.lineWidth = 1 + Math.random() * 2.8;
      const x = Math.random() * size;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 6, size * 0.35, x - 8, size * 0.65, x + (Math.random() - 0.5) * 12, size);
      ctx.stroke();
    }

    // Ash patches on bark
    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = `rgba(160, 150, 145, ${0.08 + Math.random() * 0.12})`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * size, Math.random() * size, 8 + Math.random() * 18, 4 + Math.random() * 8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  const roughness = canvasTexture(
    256,
    (ctx, size) => {
      ctx.fillStyle = '#555555';
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 70; i++) {
        ctx.strokeStyle = `rgba(255,255,255,${0.06 + Math.random() * 0.14})`;
        ctx.lineWidth = 2;
        const x = Math.random() * size;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (Math.random() - 0.5) * 8, size);
        ctx.stroke();
      }
    },
    THREE.NoColorSpace
  );

  // Emissive glowing cracks inside the charcoal wood
  const emissive = canvasTexture(256, (ctx, size) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);

    // Glowing fissures inside wood
    for (let i = 0; i < 18; i++) {
      const grad = ctx.createRadialGradient(
        Math.random() * size,
        Math.random() * size,
        2,
        Math.random() * size,
        Math.random() * size,
        24 + Math.random() * 32
      );
      grad.addColorStop(0, 'rgba(255, 140, 20, 0.95)');
      grad.addColorStop(0.35, 'rgba(230, 60, 10, 0.55)');
      grad.addColorStop(0.7, 'rgba(120, 15, 2, 0.25)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    }
  });

  return { map, roughness, emissive };
}

function makeRockMaps(): { map: THREE.CanvasTexture; roughness: THREE.CanvasTexture } {
  const map = canvasTexture(256, (ctx, size) => {
    ctx.fillStyle = '#2c2926';
    ctx.fillRect(0, 0, size, size);

    for (let i = 0; i < 120; i++) {
      const tone = 30 + Math.random() * 40;
      ctx.fillStyle = `rgba(${tone}, ${tone - 2}, ${tone - 6}, ${0.1 + Math.random() * 0.2})`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * size, Math.random() * size, 3 + Math.random() * 12, 2 + Math.random() * 8, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // Soot streaks on stones
    for (let i = 0; i < 25; i++) {
      ctx.fillStyle = `rgba(10, 8, 6, ${0.15 + Math.random() * 0.3})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 4 + Math.random() * 20, 3 + Math.random() * 10);
    }
  });

  const roughness = canvasTexture(
    256,
    (ctx, size) => {
      ctx.fillStyle = '#888888';
      ctx.fillRect(0, 0, size, size);
    },
    THREE.NoColorSpace
  );

  return { map, roughness };
}

function makeEarthAndAshMap(): THREE.CanvasTexture {
  return canvasTexture(512, (ctx, size) => {
    // Dark forest earth outer ring
    const g = ctx.createRadialGradient(size * 0.5, size * 0.5, size * 0.05, size * 0.5, size * 0.5, size * 0.5);
    g.addColorStop(0, '#100a08'); // Center charcoal pit
    g.addColorStop(0.18, '#1e120c');
    g.addColorStop(0.38, '#2a1a12');
    g.addColorStop(0.7, '#1b1410');
    g.addColorStop(1, '#0e0b08');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    // Fine ash and soot speckles
    for (let i = 0; i < 300; i++) {
      const isAsh = Math.random() > 0.65;
      const r = isAsh ? 140 + Math.random() * 40 : 50 + Math.random() * 40;
      const gg = isAsh ? 130 + Math.random() * 35 : 35 + Math.random() * 25;
      const b = isAsh ? 120 + Math.random() * 30 : 20 + Math.random() * 15;
      ctx.fillStyle = `rgba(${r},${gg},${b},${0.08 + Math.random() * 0.18})`;
      ctx.beginPath();
      ctx.ellipse(
        Math.random() * size,
        Math.random() * size,
        3 + Math.random() * 14,
        2 + Math.random() * 6,
        Math.random() * Math.PI,
        0,
        Math.PI * 2
      );
      ctx.fill();
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

  private readonly woodMaps: {
    map: THREE.CanvasTexture;
    roughness: THREE.CanvasTexture;
    emissive: THREE.CanvasTexture;
  };
  private readonly rockMaps: { map: THREE.CanvasTexture; roughness: THREE.CanvasTexture };
  private readonly earthMap: THREE.CanvasTexture;

  private readonly fireMaterial: THREE.ShaderMaterial;
  private readonly fireMesh: THREE.Mesh;
  private readonly fireBox = new THREE.Box3(
    new THREE.Vector3(-0.75, 0.02, -0.75),
    new THREE.Vector3(0.75, 1.95, 0.75)
  );

  private readonly fireLight: THREE.PointLight;
  private readonly groundLight: THREE.PointLight;
  private readonly fillLight: THREE.PointLight;
  private readonly logMaterials: THREE.MeshStandardMaterial[] = [];
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

  private readonly smokeGeom: THREE.BufferGeometry;
  private readonly smokeMat: THREE.ShaderMaterial;
  private readonly smokePositions: Float32Array;
  private readonly smokeSizes: Float32Array;
  private readonly smokeAlphas: Float32Array;
  private readonly smokeParticles: SmokeParticle[] = [];

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
      far: 45,
      cameraPosition: [2.05, 1.08, 2.3],
      target: [0, 0.46, 0],
      enablePan: false,
      minDistance: 1.35,
      maxDistance: 5.8,
      minPolarAngle: Math.PI * 0.16,
      maxPolarAngle: Math.PI * 0.78,
      dampingFactor: 0.07,
      background: 0x05070e,
      fogDensity: 0.042,
      toneMappingExposure: 1.02,
      useEnvironment: true,
      environmentIntensity: 0.12,
      environmentBlur: 0.1,
      autoRotateSpeedScale: 0.7,
      onResize: () => this.frameHearth(),
    });

    this.woodMaps = makeCharredWoodMaps();
    this.rockMaps = makeRockMaps();
    this.earthMap = makeEarthAndAshMap();

    this.buildCampground();
    this.buildCampfireStoneRing();
    this.buildCharredLogPile();

    // Raymarched Jumping Flame Volume
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
        uHeight: { value: 0.75 },
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

    // Campfire Dynamic Point Lights
    this.fireLight = new THREE.PointLight(0xff6822, 9.8, 8.8, 1.45);
    this.fireLight.position.set(0, 0.48, 0);
    this.runtime.scene.add(this.fireLight);

    this.groundLight = new THREE.PointLight(0xff7a32, 3.2, 4.5, 1.6);
    this.groundLight.position.set(0, 0.08, 0);
    this.runtime.scene.add(this.groundLight);

    this.fillLight = new THREE.PointLight(0xff4a10, 1.6, 6.0, 1.8);
    this.fillLight.position.set(0, 0.9, 0);
    this.runtime.scene.add(this.fillLight);

    // Warm Ground Ember Glow Plane
    this.groundGlow = new THREE.MeshBasicMaterial({
      color: 0x8a2408,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glowMesh = new THREE.Mesh(new THREE.CircleGeometry(1.65, 40), this.groundGlow);
    glowMesh.rotation.x = -Math.PI / 2;
    glowMesh.position.y = 0.012;
    glowMesh.renderOrder = 1;
    this.runtime.scene.add(glowMesh);

    // Coals, Sparks, and Smoke
    this.coalMesh = this.buildCoals();
    
    const spark = this.buildSparks();
    this.sparkGeom = spark.geometry;
    this.sparkMat = spark.material;
    this.sparkPositions = spark.positions;
    this.sparkSizes = spark.sizes;
    this.sparkColors = spark.colors;

    const smoke = this.buildSmoke();
    this.smokeGeom = smoke.geometry;
    this.smokeMat = smoke.material;
    this.smokePositions = smoke.positions;
    this.smokeSizes = smoke.sizes;
    this.smokeAlphas = smoke.alphas;

    this.runtime.resize();
  }

  private buildCampground(): void {
    const scene = this.runtime.scene;

    // Ground Disc
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(5.6, 48),
      new THREE.MeshStandardMaterial({
        color: 0x241812,
        map: this.earthMap,
        roughness: 0.95,
        metalness: 0.02,
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    scene.add(ground);

    // Deep ash bed center
    const ashBed = new THREE.Mesh(
      new THREE.CircleGeometry(0.72, 32),
      new THREE.MeshStandardMaterial({
        color: 0x140c08,
        roughness: 0.92,
        metalness: 0.03,
        emissive: new THREE.Color(0x4a1206),
        emissiveIntensity: 0.35,
      })
    );
    ashBed.rotation.x = -Math.PI / 2;
    ashBed.position.y = 0.003;
    scene.add(ashBed);

    // Night Sky Dome with Stars
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(9.6, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.58),
      new THREE.MeshBasicMaterial({ color: 0x050710, side: THREE.BackSide, fog: false })
    );
    sky.position.y = 0.35;
    scene.add(sky);
    this.buildStars();

    scene.add(new THREE.AmbientLight(0x121622, 0.18));
    const hemi = new THREE.HemisphereLight(0xffb888, 0x060810, 0.24);
    scene.add(hemi);
  }

  private buildCampfireStoneRing(): void {
    const scene = this.runtime.scene;
    const stoneCount = 14;
    const stoneRadius = 0.78;

    const rockMat = new THREE.MeshStandardMaterial({
      map: this.rockMaps.map,
      roughnessMap: this.rockMaps.roughness,
      roughness: 0.88,
      metalness: 0.05,
      color: 0x3a3632,
    });

    for (let i = 0; i < stoneCount; i++) {
      const angle = (i / stoneCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.12;
      const dist = stoneRadius + (Math.random() - 0.5) * 0.06;
      const sx = 0.08 + Math.random() * 0.05;
      const sy = 0.06 + Math.random() * 0.04;
      const sz = 0.09 + Math.random() * 0.06;

      const rockGeom = new THREE.DodecahedronGeometry(1, 1);
      const rock = new THREE.Mesh(rockGeom, rockMat);
      rock.scale.set(sx, sy, sz);
      rock.position.set(Math.cos(angle) * dist, sy * 0.7, Math.sin(angle) * dist);
      rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      scene.add(rock);
    }
  }

  private buildStars(): void {
    const count = 110;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.44;
      const radius = 8.2;
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi) * 0.65 + 1.2;
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
      const warm = Math.random() > 0.8;
      colors[i * 3] = warm ? 1.0 : 0.78 + Math.random() * 0.2;
      colors[i * 3 + 1] = warm ? 0.88 : 0.85 + Math.random() * 0.12;
      colors[i * 3 + 2] = warm ? 0.65 : 1.0;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const stars = new THREE.Points(
      geom,
      new THREE.PointsMaterial({
        size: 0.038,
        vertexColors: true,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    stars.frustumCulled = false;
    this.runtime.scene.add(stars);
  }

  private buildCharredLogPile(): void {
    // Realistic split oak logs arranged in an open, glowing campfire nest
    const logSpecs = [
      // Base foundation logs
      { pos: new THREE.Vector3(-0.22, 0.082, 0.14), rot: new THREE.Euler(0.12, 0.65, 1.28), len: 0.88, r: 0.082, char: 0.4 },
      { pos: new THREE.Vector3(0.24, 0.078, 0.09), rot: new THREE.Euler(0.08, -0.88, -1.22), len: 0.84, r: 0.078, char: 0.48 },
      { pos: new THREE.Vector3(0.04, 0.075, -0.24), rot: new THREE.Euler(-0.1, 0.16, 0.2), len: 0.9, r: 0.08, char: 0.35 },
      // Mid-tier cross logs leaning into the center
      { pos: new THREE.Vector3(-0.14, 0.18, -0.06), rot: new THREE.Euler(0.28, 0.98, 0.58), len: 0.72, r: 0.064, char: 0.65 },
      { pos: new THREE.Vector3(0.15, 0.21, 0.11), rot: new THREE.Euler(-0.24, -0.48, -0.56), len: 0.68, r: 0.058, char: 0.72 },
      { pos: new THREE.Vector3(-0.02, 0.28, 0.16), rot: new THREE.Euler(0.35, -0.32, 1.15), len: 0.62, r: 0.052, char: 0.8 },
      // Top leaning branches
      { pos: new THREE.Vector3(0.01, 0.32, 0.02), rot: new THREE.Euler(0.16, 0.28, 0.25), len: 0.54, r: 0.046, char: 0.88 },
      { pos: new THREE.Vector3(0.26, 0.15, -0.16), rot: new THREE.Euler(0.42, 1.18, 0.78), len: 0.5, r: 0.042, char: 0.6 },
    ];

    for (const spec of logSpecs) {
      const map = this.woodMaps.map.clone();
      map.repeat.set(2.4, 1.2);
      map.needsUpdate = true;

      const mat = new THREE.MeshStandardMaterial({
        map,
        roughnessMap: this.woodMaps.roughness,
        roughness: 0.82,
        metalness: 0.04,
        emissiveMap: this.woodMaps.emissive,
        emissive: new THREE.Color(0xff4a12),
        emissiveIntensity: 0.35 + spec.char * 0.45,
        color: new THREE.Color(0x281810),
      });
      this.logMaterials.push(mat);

      // Split firewood geometry with faceted sides
      const log = new THREE.Mesh(new THREE.CylinderGeometry(spec.r * 0.88, spec.r, spec.len, 10, 3), mat);
      log.position.copy(spec.pos);
      log.rotation.copy(spec.rot);
      this.runtime.scene.add(log);
    }
  }

  private buildCoals(): THREE.InstancedMesh {
    // Glowing charcoal pieces and incandescent embers in the campfire bed
    const geom = new THREE.DodecahedronGeometry(1, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x180a04,
      emissive: new THREE.Color(0xff5516),
      emissiveIntensity: 0.95,
      roughness: 0.65,
      metalness: 0.08,
    });

    const mesh = new THREE.InstancedMesh(geom, mat, MAX_COALS);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    for (let i = 0; i < MAX_COALS; i++) {
      const a = (i / MAX_COALS) * Math.PI * 2 + i * 0.45;
      const r = 0.04 + (i % 7) * 0.042;
      this.coalSeeds.push({
        pos: new THREE.Vector3(Math.cos(a) * r, 0.045 + (i % 5) * 0.022, Math.sin(a) * r),
        radius: 0.024 + (i % 6) * 0.01,
        phase: i * 1.25,
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
        hueOffset: Math.random() * 0.1,
      });
    }
    return { geometry, material, positions, sizes, colors };
  }

  private buildSmoke(): {
    geometry: THREE.BufferGeometry;
    material: THREE.ShaderMaterial;
    positions: Float32Array;
    sizes: Float32Array;
    alphas: Float32Array;
  } {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_SMOKE * 3);
    const sizes = new Float32Array(MAX_SMOKE);
    const alphas = new Float32Array(MAX_SMOKE);

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

    const material = new THREE.ShaderMaterial({
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      uniforms: {
        uPixelRatio: { value: this.runtime.currentPixelRatio },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 2;
    this.runtime.scene.add(points);

    for (let i = 0; i < MAX_SMOKE; i++) {
      this.smokeParticles.push({
        pos: new THREE.Vector3(0, 0.4 + Math.random() * 1.5, 0),
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.04, 0.18 + Math.random() * 0.22, (Math.random() - 0.5) * 0.04),
        life: Math.random() * 2.5,
        maxLife: 2.2 + Math.random() * 1.5,
        size: 0.08 + Math.random() * 0.14,
      });
    }
    return { geometry, material, positions, sizes, alphas };
  }

  private palette(settings: AppSettingsV1): { hue: number; sat: number; light: THREE.Color } {
    if (settings.colorMode === 'mood') {
      return {
        hue: 0.95 + this.energy.bass * 0.05,
        sat: 0.55,
        light: new THREE.Color().setHSL(0.042, 0.88, 0.54),
      };
    }
    if (settings.colorMode === 'spectrum') {
      return {
        hue: (0.035 + this.energy.mid * 0.09) % 1,
        sat: 0.45,
        light: new THREE.Color().setHSL(0.048, 0.92, 0.52),
      };
    }
    return {
      hue: 0.038,
      sat: 0.15,
      light: new THREE.Color(0xff6a28),
    };
  }

  private applyQualityTier(): void {
    const steps = [22, 32, 42][this.qualityTier];
    this.fireMaterial.uniforms.uSteps.value = steps;
    this.sparkCount = [24, 52, MAX_SPARKS][this.qualityTier];
    this.coalCount = [12, 22, MAX_COALS][this.qualityTier];
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
      const breathe = 1 + Math.sin(this.simTime * 2.5 + seed.phase) * 0.1 + mid * 0.25 + pulse * 0.18;
      this.coalDummy.position.copy(seed.pos);
      this.coalDummy.scale.setScalar(seed.radius * breathe);
      this.coalDummy.updateMatrix();
      this.coalMesh.setMatrixAt(i, this.coalDummy.matrix);
    }
    this.coalMesh.instanceMatrix.needsUpdate = true;
    const mat = this.coalMesh.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 0.65 + mid * 1.35 + pulse * 0.85;
  }

  private spawnSpark(): void {
    const spark = this.sparks.find((item) => item.life <= 0);
    if (!spark) return;
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.random() * 0.28;
    spark.pos.set(Math.cos(ang) * rad, 0.14 + Math.random() * 0.32, Math.sin(ang) * rad);
    const burst = 0.65 + this.energy.bass * 0.95 + this.energy.heatPulse * 1.3;
    const spray = 0.6 + this.energy.treble * 0.85;
    spark.vel.set(
      Math.cos(ang) * (0.09 + Math.random() * 0.45) * spray,
      burst * (0.45 + Math.random() * 1.1),
      Math.sin(ang) * (0.09 + Math.random() * 0.45) * spray
    );
    spark.maxLife = 0.7 + Math.random() * 1.4;
    spark.life = spark.maxLife;
    spark.size = 0.014 + Math.random() * 0.03;
  }

  private updateSparks(dt: number, reduced: boolean): void {
    if (!reduced) {
      this.spawnAcc += dt * (0.65 + this.energy.treble * 9.5 + this.energy.heatPulse * 5.0 + this.energy.energy * 2.5);
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
        spark.vel.y += 0.22 * dt; // Upward thermal draft
        spark.vel.x += Math.sin(this.simTime * 6.8 + i) * (0.08 + this.energy.treble * 0.25) * dt;
        spark.vel.z += Math.cos(this.simTime * 5.8 + i) * (0.08 + this.energy.treble * 0.2) * dt;
        spark.vel.multiplyScalar(Math.exp(-0.45 * dt));
        spark.pos.addScaledVector(spark.vel, dt);
      }
      const alive = spark.life > 0;
      const fade = alive ? Math.min(1, spark.life / 0.18) * Math.min(1, (spark.maxLife - spark.life) / 0.12) : 0;
      this.sparkPositions[i * 3] = alive ? spark.pos.x : 0;
      this.sparkPositions[i * 3 + 1] = alive ? spark.pos.y : -10;
      this.sparkPositions[i * 3 + 2] = alive ? spark.pos.z : 0;
      this.sparkSizes[i] = alive ? spark.size * (0.7 + fade * 1.25) : 0;
      this.sparkColors[i * 3] = 1.0;
      this.sparkColors[i * 3 + 1] = 0.45 + fade * 0.42;
      this.sparkColors[i * 3 + 2] = 0.12 + fade * 0.15;
    }
    this.sparkGeom.getAttribute('position').needsUpdate = true;
    this.sparkGeom.getAttribute('aSize').needsUpdate = true;
    this.sparkGeom.getAttribute('color').needsUpdate = true;
    this.sparkMat.uniforms.uPixelRatio.value = this.runtime.currentPixelRatio;
  }

  private updateSmoke(dt: number, reduced: boolean): void {
    for (let i = 0; i < MAX_SMOKE; i++) {
      const p = this.smokeParticles[i];
      if (!reduced) {
        p.life += dt;
        if (p.life >= p.maxLife) {
          p.life = 0;
          p.pos.set((Math.random() - 0.5) * 0.15, 0.45 + Math.random() * 0.15, (Math.random() - 0.5) * 0.15);
          p.vel.set(
            (Math.random() - 0.5) * 0.05,
            0.2 + Math.random() * 0.25 + this.energy.bass * 0.15,
            (Math.random() - 0.5) * 0.05
          );
        } else {
          p.pos.addScaledVector(p.vel, dt);
          p.vel.x += Math.sin(this.simTime * 1.8 + i) * 0.012 * dt;
          p.vel.z += Math.cos(this.simTime * 1.5 + i) * 0.012 * dt;
        }
      }

      const progress = p.life / p.maxLife;
      const alpha = Math.sin(progress * Math.PI) * 0.35;
      this.smokePositions[i * 3] = p.pos.x;
      this.smokePositions[i * 3 + 1] = p.pos.y;
      this.smokePositions[i * 3 + 2] = p.pos.z;
      this.smokeSizes[i] = p.size * (1.0 + progress * 2.2);
      this.smokeAlphas[i] = alpha;
    }
    this.smokeGeom.getAttribute('position').needsUpdate = true;
    this.smokeGeom.getAttribute('aSize').needsUpdate = true;
    this.smokeGeom.getAttribute('aAlpha').needsUpdate = true;
    this.smokeMat.uniforms.uPixelRatio.value = this.runtime.currentPixelRatio;
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
    u.uHeight.value = 0.52 + this.energy.bass * 0.52 + this.energy.heatPulse * 0.32;

    const pal = this.palette(settings);
    u.uHue.value = pal.hue;
    u.uSat.value = pal.sat;

    const flicker = 0.12 * Math.sin(this.simTime * 8.5) + 0.07 * Math.sin(this.simTime * 15.2);
    this.fireLight.color.copy(pal.light);
    this.fireLight.intensity = 6.4 + this.energy.bass * 9.5 + this.energy.heatPulse * 4.8 + flicker;
    this.fireLight.position.set(
      Math.sin(this.simTime * 1.8) * 0.06,
      0.45 + this.energy.bass * 0.22 + this.energy.heatPulse * 0.15,
      Math.cos(this.simTime * 1.4) * 0.06
    );

    this.groundLight.intensity = 1.8 + this.energy.energy * 2.8 + this.energy.heatPulse * 1.0;
    this.groundLight.color.copy(pal.light);
    this.fillLight.intensity = 1.2 + this.energy.bass * 1.8;
    this.fillLight.color.copy(pal.light);

    this.groundGlow.opacity = 0.32 + this.energy.bass * 0.42 + this.energy.heatPulse * 0.22;

    // Glowing charcoal cracks in logs breathe with audio mid frequencies
    const logGlow = 0.25 + this.energy.mid * 0.85 + this.energy.heatPulse * 0.35;
    for (const mat of this.logMaterials) {
      mat.emissiveIntensity = logGlow;
      mat.emissive.copy(pal.light).multiplyScalar(0.42);
    }
  }

  private frameHearth(): void {
    this.runtime.controls.target.set(0, 0.46, 0);
    const vFov = THREE.MathUtils.degToRad(this.runtime.camera.fov);
    const aspect = Math.max(this.runtime.camera.aspect, 0.2);
    const fitH = 1.75;
    const fitW = 1.6;
    const distH = fitH / 2 / Math.tan(vFov / 2);
    const distW = fitW / 2 / (Math.tan(vFov / 2) * aspect);
    const dist = Math.max(distH, distW) * 1.1;

    const offset = this.runtime.camera.position.clone().sub(this.runtime.controls.target);
    if (offset.lengthSq() < 1e-6) offset.set(0.55, 0.26, 1);
    offset.normalize().multiplyScalar(dist);
    this.runtime.camera.position.copy(this.runtime.controls.target).add(offset);
    this.runtime.controls.minDistance = dist * 0.46;
    this.runtime.controls.maxDistance = dist * 2.2;
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
    const reduced = this.runtime.applyControls(settings, 0.7);
    const dt = reduced ? 0 : rawDt * atmosphereSpeed(settings);
    if (!reduced) {
      this.simTime += dt;
      this.energy.update(bands, dt);
    }

    this.updateFire(settings);
    this.updateCoals();
    this.updateSparks(dt, reduced);
    this.updateSmoke(dt, reduced);

    this.runtime.renderScene(now);
  }

  public destroy(): void {
    if (this.runtime.isDestroyed) return;
    this.woodMaps.map.dispose();
    this.woodMaps.roughness.dispose();
    this.woodMaps.emissive.dispose();
    this.rockMaps.map.dispose();
    this.rockMaps.roughness.dispose();
    this.earthMap.dispose();
    this.runtime.disposeSceneGraph();
    this.runtime.destroy();
  }
}
