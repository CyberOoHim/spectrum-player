import * as THREE from 'three';
import { AppSettingsV1 } from '../storage/settings';
import { AudioEnergySmoother, bandAt } from './audio-energy';
import { atmosphereSpeed, SceneVisualizerOptions } from './scene';
import { SceneRuntime } from './scene-runtime';

export type LavaLampOptions = SceneVisualizerOptions;

const MAX_BLOBS = 12;

const LUMINA_PALETTE = ['#f472b6', '#c084fc', '#818cf8', '#fb7185', '#e879f9', '#6366f1', '#f9a8d4', '#a78bfa'];
const CLASSIC_PALETTE = ['#ff4d1a', '#ff7a18', '#ff2d55', '#ffb020', '#ff6b3d', '#ff3b1f', '#ff8a4c', '#ffd166'];

interface WaxBlob {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  radius: number;
  baseRadius: number;
  heat: number;
  phase: number;
  bandT: number;
  colorIndex: number;
}

function makeBrassMaps(): { map: THREE.CanvasTexture; roughness: THREE.CanvasTexture } {
  const size = 256;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const ctx = colorCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create brass texture');
  }

  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#f0d78a');
  gradient.addColorStop(0.35, '#d4a84b');
  gradient.addColorStop(0.62, '#8d691c');
  gradient.addColorStop(1, '#e6c36a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 90; i++) {
    ctx.strokeStyle = `rgba(255, 236, 180, ${0.03 + Math.random() * 0.07})`;
    ctx.lineWidth = 0.6 + Math.random();
    const y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y + (Math.random() - 0.5) * 5);
    ctx.stroke();
  }

  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = `rgba(60, 36, 8, ${0.04 + Math.random() * 0.06})`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * size, Math.random() * size, 8 + Math.random() * 20, 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rctx = roughCanvas.getContext('2d');
  if (!rctx) {
    throw new Error('Failed to create brass roughness');
  }
  rctx.fillStyle = '#6a6a6a';
  rctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 120; i++) {
    rctx.strokeStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.08})`;
    rctx.lineWidth = 1;
    const y = Math.random() * size;
    rctx.beginPath();
    rctx.moveTo(0, y);
    rctx.lineTo(size, y);
    rctx.stroke();
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const roughness = new THREE.CanvasTexture(roughCanvas);
  roughness.wrapS = THREE.RepeatWrapping;
  roughness.wrapT = THREE.RepeatWrapping;
  roughness.anisotropy = 4;

  return { map, roughness };
}

const WAX_VERT = /* glsl */ `
varying vec3 vPos;

void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const WAX_FRAG = /* glsl */ `
precision highp float;

varying vec3 vPos;

uniform vec3 uCamPos;
uniform vec4 uBlobs[12];
uniform vec3 uBlobColors[12];
uniform float uTime;
uniform float uEnergy;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform vec3 uLiquid;
uniform vec3 uHeaterPos;
uniform vec3 uHeaterColor;
uniform float uGoo;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float smin(float a, float b, float k, float invK) {
  float h = clamp(0.5 + 0.5 * (b - a) * invK, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float waxSdf(vec3 p) {
  float d = 1e5;
  float k = 0.20 + uGoo * 0.18;
  float invK = 1.0 / k;
  float invStretch = 1.0 / (1.0 + uBass * 0.12);

  for (int i = 0; i < 12; i++) {
    float r = uBlobs[i].w;
    if (r < 0.001) continue;
    vec3 q = p - uBlobs[i].xyz;
    q.y *= invStretch;
    d = smin(d, length(q) - r, k, invK);
  }
  float pool = length(vec3(p.x * 0.72, (p.y + 4.35) * 1.7, p.z * 0.72)) - (1.05 + uBass * 0.28);
  d = smin(d, pool, 0.28, 3.5714);
  return d;
}

vec3 calcNormal(vec3 p) {
  const vec2 e = vec2(1.0, -1.0) * 0.010;
  return normalize(
    e.xyy * waxSdf(p + e.xyy) +
    e.yyx * waxSdf(p + e.yyx) +
    e.yxy * waxSdf(p + e.yxy) +
    e.xxx * waxSdf(p + e.xxx)
  );
}

vec3 blobColor(vec3 p) {
  vec3 col = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 12; i++) {
    float r = uBlobs[i].w;
    if (r < 0.001) continue;
    vec3 d = p - uBlobs[i].xyz;
    float w = (r * r) / (dot(d, d) + 0.018);
    col += uBlobColors[i] * w;
    wsum += w;
  }
  if (wsum < 1e-4) {
    return vec3(0.85, 0.28, 0.55);
  }
  return col / wsum;
}

float rayBottle(vec3 ro, vec3 rd, out float tEnter, out float tExit) {
  float a = rd.x * rd.x + rd.z * rd.z;
  float b = 2.0 * (ro.x * rd.x + ro.z * rd.z);
  float c = ro.x * ro.x + ro.z * ro.z - 1.78 * 1.78;
  float disc = b * b - 4.0 * a * c;
  tEnter = 0.0;
  tExit = 0.0;
  if (a < 1e-6) {
    if (c > 0.0) return 0.0;
    tEnter = (-4.55 - ro.y) / rd.y;
    tExit = (4.55 - ro.y) / rd.y;
    if (tEnter > tExit) {
      float tmp = tEnter;
      tEnter = tExit;
      tExit = tmp;
    }
    return tExit > tEnter ? 1.0 : 0.0;
  }
  if (disc < 0.0) return 0.0;
  float s = sqrt(disc);
  float t1 = (-b - s) / (2.0 * a);
  float t2 = (-b + s) / (2.0 * a);
  if (t1 > t2) {
    float tmp = t1;
    t1 = t2;
    t2 = tmp;
  }

  float y1 = ro.y + rd.y * t1;
  float y2 = ro.y + rd.y * t2;
  float ymin = -4.55;
  float ymax = 4.55;

  float tNear = -1e5;
  float tFar = 1e5;
  if (abs(rd.y) > 1e-5) {
    float ty1 = (ymin - ro.y) / rd.y;
    float ty2 = (ymax - ro.y) / rd.y;
    tNear = min(ty1, ty2);
    tFar = max(ty1, ty2);
  } else if (ro.y < ymin || ro.y > ymax) {
    return 0.0;
  }

  tEnter = max(t1, tNear);
  tExit = min(t2, tFar);
  if (tExit < tEnter) return 0.0;

  if (y1 < ymin && y2 < ymin) return 0.0;
  if (y1 > ymax && y2 > ymax) return 0.0;
  return 1.0;
}

void main() {
  vec3 ro = uCamPos;
  vec3 rd = normalize(vPos - uCamPos);

  float tEnter;
  float tExit;
  if (rayBottle(ro, rd, tEnter, tExit) < 0.5) {
    discard;
  }

  tEnter = max(tEnter, 0.0);
  if (tExit < tEnter) discard;

  vec3 p = ro + rd * tEnter;
  float t = tEnter;
  float hit = 0.0;
  float glow = 0.0;

  for (int i = 0; i < 38; i++) {
    if (t > tExit) break;
    float d = waxSdf(p);
    float prox = max(0.0, 1.0 - max(d, 0.0) * 2.2);
    glow += prox * prox * 0.022;
    if (d < 0.012) {
      hit = 1.0;
      break;
    }
    t += clamp(d * 0.85, 0.018, 0.75);
    p = ro + rd * t;
  }

  vec3 liquid = uLiquid;
  float depth = clamp((tExit - tEnter) * 0.11, 0.0, 1.0);
  liquid += uHeaterColor * 0.18 * (1.0 - clamp((p.y + 4.5) / 6.0, 0.0, 1.0));
  liquid += vec3(0.18, 0.05, 0.14) * glow * (0.7 + uEnergy);
  liquid += vec3(0.12, 0.04, 0.18) * depth;

  float specks = hash(floor(p * 18.0 + uTime * 0.15));
  if (specks > 0.965) {
    liquid += vec3(0.35, 0.18, 0.4) * (0.15 + uTreble * 0.35);
  }

  float meniscus = smoothstep(0.18, 0.0, abs(p.y - 4.42)) * smoothstep(1.55, 1.78, length(p.xz));
  liquid += vec3(0.25, 0.1, 0.22) * meniscus * 0.45;

  vec3 col = liquid;

  if (hit > 0.5) {
    vec3 n = calcNormal(p);
    vec3 wax = blobColor(p);
    vec3 view = normalize(uCamPos - p);
    vec3 heaterDir = normalize(uHeaterPos - p);
    vec3 keyDir = normalize(vec3(0.45, 0.85, 0.65));

    float wrap = pow(clamp(dot(n, heaterDir) * 0.55 + 0.45, 0.0, 1.0), 1.15);
    float key = pow(max(dot(n, keyDir), 0.0), 1.2);
    float rim = pow(1.0 - max(dot(n, view), 0.0), 2.6);
    vec3 halfH = normalize(heaterDir + view);
    float spec = pow(max(dot(n, halfH), 0.0), 64.0);
    float specKey = pow(max(dot(n, normalize(keyDir + view)), 0.0), 90.0);

    float thickness = clamp(0.35 + uEnergy * 0.25, 0.0, 1.0);
    vec3 subsurface = wax * wax * (0.45 + wrap * 0.9) + uHeaterColor * wrap * 0.35;
    vec3 irid = 0.5 + 0.5 * cos(vec3(0.2, 1.8, 3.6) + dot(n, view) * 5.0 + uTime * 0.25);
    wax += irid * wax * 0.10;

    col = wax * (0.18 + key * 0.35) + subsurface * (0.75 + thickness);
    col += wax * rim * (0.55 + uMid * 0.35);
    col += vec3(1.0, 0.92, 0.85) * spec * 0.55;
    col += vec3(1.0, 0.95, 0.88) * specKey * 0.28;
    col += uHeaterColor * wrap * 0.2;
    col += glow * wax * 0.35;
  }

  col = max(col, vec3(0.0));

  gl_FragColor = vec4(col, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class LavaLamp {
  private readonly runtime: SceneRuntime;
  private readonly energy = new AudioEnergySmoother();

  private lampGroup: THREE.Group;
  private waxMesh: THREE.Mesh;
  private waxMaterial: THREE.ShaderMaterial;
  private heaterLight: THREE.PointLight;
  private waxLight: THREE.PointLight;
  private brassMaps: { map: THREE.CanvasTexture; roughness: THREE.CanvasTexture };

  private blobs: WaxBlob[] = [];
  private simTime = 0;

  private get scene(): THREE.Scene {
    return this.runtime.scene;
  }

  private get camera(): THREE.PerspectiveCamera {
    return this.runtime.camera;
  }

  private get controls() {
    return this.runtime.controls;
  }

  constructor(container: HTMLElement, options: LavaLampOptions = {}) {
    this.runtime = new SceneRuntime(container, {
      onContextLost: options.onContextLost,
      fov: 36,
      near: 0.1,
      far: 120,
      cameraPosition: [0.22, 6.85, 24.5],
      target: [0, 6.85, 0],
      enablePan: false,
      minDistance: 16,
      maxDistance: 42,
      minPolarAngle: Math.PI * 0.32,
      maxPolarAngle: Math.PI * 0.62,
      dampingFactor: 0.06,
      background: 0x0c0709,
      fogDensity: 0.018,
      toneMappingExposure: 1.05,
      useEnvironment: true,
      environmentIntensity: 0.28,
      environmentBlur: 0.04,
      autoRotateSpeedScale: 1.5,
      onResize: () => this.frameLamp(),
    });

    this.brassMaps = makeBrassMaps();
    this.lampGroup = new THREE.Group();
    this.scene.add(this.lampGroup);

    this.buildStage();
    this.buildLamp();

    this.waxMaterial = new THREE.ShaderMaterial({
      vertexShader: WAX_VERT,
      fragmentShader: WAX_FRAG,
      uniforms: {
        uCamPos: { value: new THREE.Vector3() },
        uBlobs: { value: Array.from({ length: MAX_BLOBS }, () => new THREE.Vector4()) },
        uBlobColors: { value: Array.from({ length: MAX_BLOBS }, () => new THREE.Color()) },
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTreble: { value: 0 },
        uLiquid: { value: new THREE.Color(0x1a0c1c) },
        uHeaterPos: { value: new THREE.Vector3(0, -4.2, 0) },
        uHeaterColor: { value: new THREE.Color(0xff6a33) },
        uGoo: { value: 0.55 },
      },
      transparent: false,
      depthWrite: true,
      side: THREE.FrontSide,
    });

    const waxGeom = new THREE.CylinderGeometry(1.86, 1.86, 9.3, 32, 1, true);
    this.waxMesh = new THREE.Mesh(waxGeom, this.waxMaterial);
    this.waxMesh.position.y = 6.0;
    this.waxMesh.renderOrder = 1;
    this.lampGroup.add(this.waxMesh);

    this.heaterLight = new THREE.PointLight(0xff6a33, 6.5, 14, 1.6);
    this.heaterLight.position.set(0, 1.25, 0);
    this.scene.add(this.heaterLight);

    this.waxLight = new THREE.PointLight(0xff66aa, 2.4, 12, 1.8);
    this.waxLight.position.set(0, 6.0, 0);
    this.scene.add(this.waxLight);

    this.spawnBlobs();
    this.runtime.resize();
  }

  private brassMaterial(repeatX = 1, repeatY = 1, darker = false): THREE.MeshStandardMaterial {
    const map = this.brassMaps.map.clone();
    map.repeat.set(repeatX, repeatY);
    map.needsUpdate = true;
    const roughnessMap = this.brassMaps.roughness.clone();
    roughnessMap.repeat.set(repeatX, repeatY);
    roughnessMap.needsUpdate = true;
    return new THREE.MeshStandardMaterial({
      color: darker ? 0xb8892a : 0xe6c56a,
      map,
      roughnessMap,
      metalness: 0.92,
      roughness: darker ? 0.38 : 0.26,
      envMapIntensity: 1.15,
    });
  }

  private buildStage(): void {
    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(7.4, 7.6, 0.18, 36),
      new THREE.MeshStandardMaterial({
        color: 0x140c0a,
        roughness: 0.72,
        metalness: 0.18,
      })
    );
    table.position.y = -0.09;
    this.scene.add(table);

    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 32),
      new THREE.MeshBasicMaterial({
        color: 0x3a160c,
        transparent: true,
        opacity: 0.55,
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.01;
    this.scene.add(glow);

    const ambient = new THREE.AmbientLight(0x2a1816, 0.45);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xffe2c4, 0x1a0808, 0.38);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff3d6, 1.35);
    key.position.set(6.5, 14, 10);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x6b3a88, 0.35);
    rim.position.set(-8, 6, -6);
    this.scene.add(rim);

    const backdrop = new THREE.Mesh(
      new THREE.SphereGeometry(36, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshBasicMaterial({ color: 0x0a0608, side: THREE.BackSide })
    );
    backdrop.position.y = 4;
    this.scene.add(backdrop);
  }

  private buildLamp(): void {
    const brass = this.brassMaterial(2, 1);
    const brassDark = this.brassMaterial(1.4, 1, true);

    const footPts = [
      new THREE.Vector2(1.85, 0.0),
      new THREE.Vector2(1.88, 0.06),
      new THREE.Vector2(1.76, 0.16),
      new THREE.Vector2(1.38, 0.45),
      new THREE.Vector2(1.28, 0.75),
      new THREE.Vector2(1.42, 0.95),
      new THREE.Vector2(1.58, 1.08),
      new THREE.Vector2(1.52, 1.14),
    ];
    const foot = new THREE.Mesh(new THREE.LatheGeometry(footPts, 44), brass);
    this.lampGroup.add(foot);

    const collar = new THREE.Mesh(new THREE.CylinderGeometry(1.52, 1.62, 0.1, 36), brassDark);
    collar.position.y = 1.16;
    this.lampGroup.add(collar);

    const port = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.04, 0.14, 6, 10),
      new THREE.MeshStandardMaterial({
        color: 0x1a1208,
        emissive: 0x2a1808,
        roughness: 0.35,
        metalness: 0.55,
      })
    );
    port.rotation.z = Math.PI / 2;
    port.position.set(0, 0.28, 1.82);
    this.lampGroup.add(port);

    const glassPts = [
      new THREE.Vector2(0.02, 1.2),
      new THREE.Vector2(1.68, 1.22),
      new THREE.Vector2(1.90, 1.4),
      new THREE.Vector2(2.04, 1.95),
      new THREE.Vector2(2.08, 3.6),
      new THREE.Vector2(2.08, 7.4),
      new THREE.Vector2(2.04, 9.15),
      new THREE.Vector2(1.90, 10.05),
      new THREE.Vector2(1.56, 10.58),
      new THREE.Vector2(1.04, 10.88),
      new THREE.Vector2(0.02, 10.96),
    ];

    const glass = new THREE.Mesh(
      new THREE.LatheGeometry(glassPts, 48),
      new THREE.ShaderMaterial({
        uniforms: {},
        vertexShader: /* glsl */ `
          varying vec3 vWorldPos;
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            vec4 world = modelMatrix * vec4(position, 1.0);
            vWorldPos = world.xyz;
            gl_Position = projectionMatrix * viewMatrix * world;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vWorldPos;
          varying vec3 vNormal;
          void main() {
            vec3 n = normalize(vNormal);
            vec3 view = normalize(cameraPosition - vWorldPos);
            float fresnel = pow(1.0 - abs(dot(n, view)), 3.2);
            vec3 tint = vec3(0.78, 0.86, 0.94);
            gl_FragColor = vec4(tint, 0.03 + fresnel * 0.22);
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
      })
    );
    glass.renderOrder = 2;
    this.lampGroup.add(glass);

    const capPts = [
      new THREE.Vector2(0.06, 11.0),
      new THREE.Vector2(1.36, 11.02),
      new THREE.Vector2(1.45, 11.12),
      new THREE.Vector2(1.22, 11.22),
      new THREE.Vector2(0.72, 11.28),
      new THREE.Vector2(0.28, 11.32),
      new THREE.Vector2(0.06, 11.34),
    ];
    const cap = new THREE.Mesh(new THREE.LatheGeometry(capPts, 36), brass);
    this.lampGroup.add(cap);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.08, 16), brassDark);
    neck.position.y = 11.38;
    this.lampGroup.add(neck);

    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), brass);
    knob.position.y = 11.48;
    this.lampGroup.add(knob);

    const heater = new THREE.Mesh(
      new THREE.CircleGeometry(1.55, 32),
      new THREE.MeshStandardMaterial({
        color: 0x2a1008,
        emissive: 0xff5a24,
        emissiveIntensity: 1.4,
        roughness: 0.5,
        metalness: 0.1,
      })
    );
    heater.rotation.x = -Math.PI / 2;
    heater.position.y = 1.25;
    this.lampGroup.add(heater);
  }

  private spawnBlobs(): void {
    this.blobs = [];
    const seeds = [
      { y: -3.6, r: 0.95, t: 0.08 },
      { y: -2.4, r: 0.72, t: 0.18 },
      { y: -0.6, r: 0.62, t: 0.32 },
      { y: 0.9, r: 0.48, t: 0.45 },
      { y: 2.1, r: 0.55, t: 0.55 },
      { y: 3.2, r: 0.4, t: 0.68 },
      { y: 1.4, r: 0.34, t: 0.78 },
      { y: -1.3, r: 0.38, t: 0.88 },
      { y: 3.8, r: 0.28, t: 0.22 },
      { y: -3.1, r: 0.3, t: 0.92 },
      { y: 0.2, r: 0.26, t: 0.6 },
      { y: 2.7, r: 0.22, t: 0.97 },
    ];

    for (let i = 0; i < MAX_BLOBS; i++) {
      const seed = seeds[i];
      const angle = (i / MAX_BLOBS) * Math.PI * 2 + i * 0.4;
      const radial = 0.15 + (i % 3) * 0.18;
      this.blobs.push({
        pos: new THREE.Vector3(Math.cos(angle) * radial, seed.y, Math.sin(angle) * radial),
        vel: new THREE.Vector3(0, 0.04 * ((i % 2) * 2 - 1), 0),
        radius: seed.r,
        baseRadius: seed.r,
        heat: seed.y < -1.5 ? 0.72 : 0.35 + (i % 5) * 0.08,
        phase: i * 1.17,
        bandT: seed.t,
        colorIndex: i,
      });
    }
  }

  private colorForBlob(blob: WaxBlob, settings: AppSettingsV1, energy: number): THREE.Color {
    if (settings.colorMode === 'mood') {
      const hue = (0.88 + energy * 0.16 + blob.bandT * 0.12 + blob.heat * 0.05) % 1;
      return new THREE.Color().setHSL(hue, 0.78, 0.58);
    }
    if (settings.colorMode === 'mono') {
      const palette = CLASSIC_PALETTE;
      return new THREE.Color(palette[blob.colorIndex % palette.length]);
    }
    const palette = LUMINA_PALETTE;
    return new THREE.Color(palette[blob.colorIndex % palette.length]);
  }

  private updatePhysics(dt: number, bands: Float32Array, reduced: boolean): void {
    this.energy.update(bands, dt);

    if (reduced) return;

    const time = this.simTime;
    const innerR = 1.55;

    for (const blob of this.blobs) {
      const local = bandAt(bands, blob.bandT);

      if (blob.pos.y < -2.6) {
        const idle = 0.12 * Math.sin(time * 0.35 + blob.phase);
        blob.heat += (0.52 + idle + this.energy.bass * 1.35 + this.energy.heatPulse * 1.8) * dt;
      } else if (blob.pos.y > 3.3) {
        blob.heat -= (0.55 + (1 - this.energy.bass) * 0.25) * dt;
      }
      blob.heat -= 0.07 * dt;
      blob.heat = THREE.MathUtils.clamp(blob.heat, 0.05, 1);

      const buoyancy = (blob.heat - 0.42) * (5.4 + this.energy.bass * 4.2);
      blob.vel.y += buoyancy * dt;
      blob.vel.y -= 0.35 * dt;

      const swirl = 0.22 + this.energy.mid * 0.55;
      blob.vel.x += Math.sin(time * 0.7 + blob.phase) * swirl * dt;
      blob.vel.z += Math.cos(time * 0.55 + blob.phase * 1.3) * swirl * dt;

      blob.vel.y += this.energy.heatPulse * local * 2.4 * dt;
      blob.vel.x += (Math.sin(time * 7.0 + blob.phase) * this.energy.treble * 0.9) * dt;
      blob.vel.z += (Math.cos(time * 6.2 + blob.phase) * this.energy.treble * 0.9) * dt;

      blob.vel.multiplyScalar(Math.exp(-1.65 * dt));
      blob.pos.addScaledVector(blob.vel, dt);

      const targetR = blob.baseRadius * (1 + local * 0.38 + this.energy.mid * 0.12 + (blob.heat - 0.4) * 0.1);
      blob.radius += (targetR - blob.radius) * 0.12;

      const maxY = 4.15 - blob.radius * 0.55;
      const minY = -4.25 + blob.radius * 0.45;
      if (blob.pos.y > maxY) {
        blob.pos.y = maxY;
        blob.vel.y *= -0.18;
        blob.heat *= 0.86;
      }
      if (blob.pos.y < minY) {
        blob.pos.y = minY;
        blob.vel.y *= -0.12;
      }

      const radial = Math.hypot(blob.pos.x, blob.pos.z);
      const maxR = Math.max(0.12, innerR - blob.radius * 0.55);
      if (radial > maxR && radial > 1e-4) {
        const s = maxR / radial;
        blob.pos.x *= s;
        blob.pos.z *= s;
        blob.vel.x *= -0.2;
        blob.vel.z *= -0.2;
      }
    }

    for (let i = 0; i < this.blobs.length; i++) {
      for (let j = i + 1; j < this.blobs.length; j++) {
        const a = this.blobs[i];
        const b = this.blobs[j];
        const dx = a.pos.x - b.pos.x;
        const dy = a.pos.y - b.pos.y;
        const dz = a.pos.z - b.pos.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        const minDist = (a.radius + b.radius) * 0.42;
        const minDistSq = minDist * minDist;
        if (distSq > 1e-6 && distSq < minDistSq) {
          const dist = Math.sqrt(distSq);
          const factor = ((minDist - dist) * 0.08) / dist;
          const shiftX = dx * factor;
          const shiftY = dy * factor;
          const shiftZ = dz * factor;
          a.pos.x += shiftX;
          a.pos.y += shiftY;
          a.pos.z += shiftZ;
          b.pos.x -= shiftX;
          b.pos.y -= shiftY;
          b.pos.z -= shiftZ;
        }
      }
    }
  }

  private updateUniforms(settings: AppSettingsV1): void {
    const u = this.waxMaterial.uniforms;
    u.uCamPos.value.copy(this.camera.position);
    this.waxMesh.updateWorldMatrix(true, false);
    this.waxMesh.worldToLocal(u.uCamPos.value);
    u.uTime.value = this.simTime;
    u.uEnergy.value = this.energy.energy;
    u.uBass.value = this.energy.bass;
    u.uMid.value = this.energy.mid;
    u.uTreble.value = this.energy.treble;
    u.uGoo.value = 0.45 + this.energy.energy * 0.7;

    if (settings.colorMode === 'mono') {
      u.uLiquid.value.setHex(0x2a120c);
      u.uHeaterColor.value.setHex(0xff5a1f);
    } else if (settings.colorMode === 'mood') {
      const mood = new THREE.Color().setHSL(0.88 + this.energy.bass * 0.1, 0.55, 0.28);
      u.uLiquid.value.copy(mood).multiplyScalar(0.7);
      u.uHeaterColor.value.setHSL(0.95 + this.energy.bass * 0.08, 0.85, 0.55);
    } else {
      u.uLiquid.value.setHex(0x241028);
      u.uHeaterColor.value.setHex(0xff6a33);
    }

    const blobs = u.uBlobs.value as THREE.Vector4[];
    const colors = u.uBlobColors.value as THREE.Color[];
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let cw = 0;

    for (let i = 0; i < MAX_BLOBS; i++) {
      const blob = this.blobs[i];
      if (!blob) {
        blobs[i].set(0, 0, 0, 0);
        continue;
      }
      blobs[i].set(blob.pos.x, blob.pos.y, blob.pos.z, blob.radius);
      const color = this.colorForBlob(blob, settings, this.energy.energy);
      color.convertSRGBToLinear();
      colors[i].copy(color);
      const w = blob.radius;
      cx += blob.pos.x * w;
      cy += blob.pos.y * w;
      cz += blob.pos.z * w;
      cw += w;
    }

    if (cw > 0) {
      this.waxLight.position.set(cx / cw, 7.2 + cy / cw * 0.15, cz / cw);
    }
    this.waxLight.color.copy(colors[0] ?? new THREE.Color(0xff66aa));
    this.waxLight.intensity = 1.6 + this.energy.energy * 3.4;
    this.heaterLight.intensity = 4.8 + this.energy.bass * 5.5 + this.energy.heatPulse * 3.0;
  }

  public degradeQuality(): boolean {
    return this.runtime.degradeQuality();
  }

  public render(bands: Float32Array, settings: AppSettingsV1): void {
    if (!this.runtime.alive) return;

    const { now, rawDt } = this.runtime.beginFrame();
    const dt = rawDt * atmosphereSpeed(settings);
    this.simTime += dt;

    const reduced = this.runtime.applyControls(settings, 1.5);
    this.updatePhysics(dt, bands, reduced);
    this.updateUniforms(settings);
    this.runtime.renderScene(now);
  }

  private frameLamp(): void {
    const lampMinY = 0;
    const lampMaxY = 11.6;
    const lampRadius = 1.9;
    const fitH = lampMaxY - lampMinY;
    const fitW = lampRadius * 2;
    const centerY = (lampMinY + lampMaxY) / 2;

    this.controls.target.set(0, centerY, 0);

    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = Math.max(this.camera.aspect, 0.2);
    const distH = fitH / 2 / Math.tan(vFov / 2);
    const distW = fitW / 2 / (Math.tan(vFov / 2) * aspect);
    const dist = Math.max(distH, distW) * 0.72;

    const offset = this.camera.position.clone().sub(this.controls.target);
    if (offset.lengthSq() < 1e-6) {
      offset.set(0.18, 0.12, 1);
    }
    offset.normalize().multiplyScalar(dist);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.minDistance = dist * 0.4;
    this.controls.maxDistance = dist * 2.5;
  }

  public destroy(): void {
    if (this.runtime.isDestroyed) return;
    this.brassMaps.map.dispose();
    this.brassMaps.roughness.dispose();
    this.runtime.disposeSceneGraph();
    this.runtime.destroy();
  }
}
