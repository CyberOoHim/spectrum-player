import * as THREE from 'three';
import { AppSettingsV1 } from '../../storage/settings';
import { AudioEnergySmoother } from '../audio-energy';
import { atmosphereSpeed, SceneVisualizerOptions } from '../scene';
import { SceneRuntime } from '../scene-runtime';

const MAX_OUTDOOR_RAIN = 140;
const MAX_STEAM_MOTES = 45;
const MAX_ROOM_MOTES = 35;

interface OutdoorRainDrop {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  length: number;
  speed: number;
}

interface SteamMote {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  type: 'steam' | 'mote';
}

const GLASS_VERT = /* glsl */ `
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

const GLASS_FRAG = /* glsl */ `
precision highp float;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormal;

uniform vec3 uCamPos;
uniform vec3 uCandlePos;
uniform vec3 uDistantLightPos;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uEnergy;
uniform float uPulse;
uniform float uThunder;
uniform float uHue;
uniform float uSat;
uniform int uSteps;
uniform sampler2D uForestTexture;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
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

// Computes height of water droplets and running streaks on the glass
float getWaterHeight(vec2 uv, float t, out float outWashed) {
  float speed = 0.42 + uMid * 0.55 + uPulse * 0.3;
  float totalHeight = 0.0;
  float washed = 0.0;

  // Grid layer 1: Active running rivulets / drips
  vec2 gridUv1 = uv * vec2(16.0, 6.0);
  vec2 id1 = floor(gridUv1);
  vec2 gv1 = fract(gridUv1) - 0.5;
  
  float colRand1 = hash11(id1.x * 23.45 + 1.2);
  float dropTime1 = t * (0.65 + colRand1 * 0.75) * speed + colRand1 * 10.0;
  float dropProg1 = fract(dropTime1);
  float dropY1 = 0.5 - dropProg1;
  
  // Wiggle path of running drip
  float wiggle1 = sin(uv.y * 14.0 + colRand1 * 6.28) * 0.18 * (0.8 + uMid * 0.4);
  vec2 dropPos1 = vec2(wiggle1, dropY1);
  float distDrop1 = length(gv1 - dropPos1);
  
  // Main drip droplet head
  float dropHead1 = smoothstep(0.16 + colRand1 * 0.08, 0.02, distDrop1);
  
  // Tail trail left behind the drop
  float isAbove1 = step(dropPos1.y, gv1.y);
  float trailWidth1 = (0.05 + colRand1 * 0.04) * (1.0 - smoothstep(dropPos1.y, dropPos1.y + 0.8, gv1.y));
  float trail1 = smoothstep(trailWidth1, 0.0, abs(gv1.x - wiggle1)) * isAbove1 * (0.45 + colRand1 * 0.35);
  
  // Grid layer 2: Secondary offset beads and smaller drips
  vec2 gridUv2 = uv * vec2(28.0, 12.0) + vec2(5.3, 2.7);
  vec2 id2 = floor(gridUv2);
  vec2 gv2 = fract(gridUv2) - 0.5;
  float colRand2 = hash11(id2.x * 37.19 + id2.y * 12.5);
  float dropTime2 = t * (0.4 + colRand2 * 0.6) * speed + colRand2 * 8.0;
  float dropProg2 = fract(dropTime2);
  float dropY2 = 0.5 - dropProg2;
  vec2 dropPos2 = vec2((colRand2 - 0.5) * 0.4, dropY2);
  float distDrop2 = length(gv2 - dropPos2);
  float dropHead2 = smoothstep(0.12 + colRand2 * 0.06, 0.02, distDrop2);

  // Grid layer 3: Static condensation beads
  vec2 gridUv3 = uv * vec2(52.0, 32.0) + vec2(11.2, 7.8);
  vec2 id3 = floor(gridUv3);
  vec2 gv3 = fract(gridUv3) - 0.5;
  float staticRand = hash21(id3);
  vec2 staticPos = (vec2(hash11(staticRand * 19.3), hash11(staticRand * 41.7)) - 0.5) * 0.55;
  float distStatic = length(gv3 - staticPos);
  float staticBead = smoothstep(0.14 * staticRand, 0.01, distStatic) * step(0.38, staticRand);

  totalHeight = max(totalHeight, dropHead1 * 1.2);
  totalHeight = max(totalHeight, trail1 * 0.7);
  totalHeight = max(totalHeight, dropHead2 * 0.9);
  totalHeight = max(totalHeight, staticBead * 0.5);

  washed = clamp(dropHead1 * 1.5 + trail1 * 1.2 + dropHead2 * 0.8, 0.0, 1.0);
  outWashed = washed;
  return totalHeight;
}

vec3 paletteTint(vec3 baseColor, float hue, float sat) {
  float angle = hue * 6.28318;
  vec3 shift = vec3(
    0.15 * sin(angle),
    0.06 * sin(angle + 2.1),
    0.18 * cos(angle)
  );
  return mix(baseColor, clamp(baseColor + shift, 0.0, 1.0), sat * 0.6);
}

void main() {
  vec3 viewDir = normalize(uCamPos - vWorldPos);
  
  // Sample water height and normal
  float washed = 0.0;
  float h = getWaterHeight(vUv, uTime, washed);
  
  // Normal estimation via finite differences
  float eps = 0.0035;
  float wTrash = 0.0;
  float hR = getWaterHeight(vUv + vec2(eps, 0.0), uTime, wTrash);
  float hU = getWaterHeight(vUv + vec2(0.0, eps), uTime, wTrash);
  vec2 grad = vec2(hR - h, hU - h) / eps;
  
  // Base glass normal with water refraction distortion
  vec3 waterNorm = normalize(vec3(-grad * (0.45 + uBass * 0.15), 1.0));
  
  // Condensation mist on glass (washed away where water flowed)
  float mistNoise = fbm(vUv * 12.0 + vec2(uTime * 0.01, 0.0));
  float condensation = (0.55 + mistNoise * 0.35) * (1.0 - washed * 0.88);
  condensation = clamp(condensation + uBass * 0.18, 0.0, 0.95);
  
  // Refracted UV for looking outside through the glass
  vec2 refrUv = vUv + grad * 0.038 * (1.0 + uBass * 0.22);
  refrUv = clamp(refrUv, vec2(0.01), vec2(0.99));
  
  // Sample forest & night backdrop
  vec4 bgTex = texture2D(uForestTexture, refrUv);
  vec3 outsideColor = bgTex.rgb;
  
  // Distant porch/cabin light glow bloom
  vec2 distLightUv = vec2(0.68, 0.42);
  float distToLight = length(refrUv - distLightUv);
  float lightGlow = exp(-distToLight * (3.8 - uBass * 1.2)) * (0.65 + uBass * 0.85 + uPulse * 0.45);
  vec3 distantGlowColor = vec3(1.0, 0.68, 0.28) * lightGlow;
  outsideColor += distantGlowColor;
  
  // Distant lightning / sky bloom (healing, soft indigo/amber)
  vec3 thunderColor = vec3(0.38, 0.42, 0.68) * uThunder * 0.75;
  outsideColor += thunderColor * (1.0 - refrUv.y * 0.6);
  
  // Condensation scatters light and softens the view
  vec3 mistColor = vec3(0.12, 0.16, 0.24) * (0.8 + lightGlow * 0.5);
  vec3 sceneBehindGlass = mix(outsideColor, mistColor, condensation * 0.68);

  // Interior candle reflection & specular highlights on water
  vec3 candleDir = normalize(uCandlePos - vWorldPos);
  vec3 halfVecCandle = normalize(viewDir + candleDir);
  float specCandle = pow(max(dot(waterNorm, halfVecCandle), 0.0), 48.0);
  float candleDist = length(uCandlePos - vWorldPos);
  float candleAtten = 1.0 / (1.0 + candleDist * 2.2);
  vec3 candleSpecCol = vec3(1.0, 0.82, 0.48) * specCandle * candleAtten * (2.8 + uTreble * 3.5);
  
  // Exterior distant light specular glint on water droplets
  vec3 extLightDir = normalize(uDistantLightPos - vWorldPos);
  vec3 halfVecExt = normalize(viewDir + extLightDir);
  float specExt = pow(max(dot(waterNorm, halfVecExt), 0.0), 32.0);
  vec3 extSpecCol = vec3(0.9, 0.7, 0.4) * specExt * (0.9 + uTreble * 1.5);
  
  // Water edge glints & sparkle (Treble sparkle)
  float edgeSparkle = pow(clamp(length(grad) * 0.8, 0.0, 1.0), 2.5) * (0.2 + uTreble * 0.85 + uPulse * 0.35);
  vec3 sparkleCol = vec3(0.85, 0.92, 1.0) * edgeSparkle;

  // Fresnel glass reflection
  float fresnel = pow(1.0 - max(dot(viewDir, vec3(0.0, 0.0, 1.0)), 0.0), 3.0);
  vec3 interiorReflect = vec3(0.08, 0.05, 0.03) * (1.0 + uBass * 0.5);
  
  // Composite final glass color
  vec3 finalColor = sceneBehindGlass;
  finalColor += candleSpecCol;
  finalColor += extSpecCol;
  finalColor += sparkleCol;
  finalColor = mix(finalColor, interiorReflect, fresnel * 0.25);
  
  // Apply palette theme
  finalColor = paletteTint(finalColor, uHue, uSat);

  gl_FragColor = vec4(finalColor, 0.94);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const RAIN_VERT = /* glsl */ `
attribute float aLength;
attribute float aSpeed;
uniform float uPixelRatio;
uniform float uTime;
varying float vAlpha;

void main() {
  vec3 p = position;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = max(1.2, aLength * (140.0 / max(-mv.z, 0.1)) * uPixelRatio);
  gl_Position = projectionMatrix * mv;
  vAlpha = clamp(0.25 + 0.75 * (1.0 - abs(p.z) / 4.0), 0.0, 1.0);
}
`;

const RAIN_FRAG = /* glsl */ `
precision highp float;
varying float vAlpha;
uniform vec3 uColor;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  // Elongated rain streak
  float d = length(vec2(p.x * 2.8, p.y * 0.65));
  if (d > 1.0) discard;
  float glow = pow(1.0 - d, 1.8);
  gl_FragColor = vec4(uColor, glow * vAlpha * 0.65);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const STEAM_VERT = /* glsl */ `
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
  gl_PointSize = max(1.0, aSize * (180.0 / max(-mv.z, 0.1)) * uPixelRatio);
  gl_Position = projectionMatrix * mv;
}
`;

const STEAM_FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.0) discard;
  float glow = pow(1.0 - d, 2.2);
  gl_FragColor = vec4(vColor, glow * vAlpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const FLAME_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vPos;
void main() {
  vUv = uv;
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FLAME_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vPos;
uniform float uTime;
uniform float uBass;
uniform float uPulse;

void main() {
  vec2 uv = vUv;
  float flicker = sin(uTime * 14.0) * 0.08 + sin(uTime * 23.0) * 0.04;
  uv.x += sin(uv.y * 6.0 + uTime * 8.0) * (0.05 + flicker);
  
  float d = length(vec2((uv.x - 0.5) * 2.4, (uv.y - 0.2) * 1.3));
  if (d > 1.0) discard;
  
  float core = pow(max(0.0, 1.0 - d * 2.2), 2.5);
  float outer = pow(1.0 - d, 1.6);
  
  vec3 col = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.88, 0.5), outer);
  col = mix(col, vec3(1.0, 0.98, 0.92), core);
  
  float alpha = clamp(outer * (1.2 + uPulse * 0.4), 0.0, 1.0);
  gl_FragColor = vec4(col * (1.4 + uBass * 0.5), alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function canvasTexture(
  sizeW: number,
  sizeH: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  colorSpace: typeof THREE.SRGBColorSpace | typeof THREE.NoColorSpace = THREE.SRGBColorSpace
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = sizeW;
  canvas.height = sizeH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to create canvas texture');
  draw(ctx, sizeW, sizeH);
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = colorSpace;
  map.anisotropy = 8;
  map.needsUpdate = true;
  return map;
}

function makeWoodPlankMaps(): { map: THREE.CanvasTexture; roughness: THREE.CanvasTexture } {
  const map = canvasTexture(512, 512, (ctx, w, h) => {
    // Base warm cedar tone
    ctx.fillStyle = '#261810';
    ctx.fillRect(0, 0, w, h);

    const plankCount = 6;
    const plankH = h / plankCount;

    for (let p = 0; p < plankCount; p++) {
      const y0 = p * plankH;
      const tone = 0.85 + Math.random() * 0.3;
      const r = Math.floor(46 * tone);
      const g = Math.floor(28 * tone);
      const b = Math.floor(18 * tone);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, y0, w, plankH - 2);

      // Fine wood grain lines
      for (let i = 0; i < 48; i++) {
        ctx.strokeStyle = `rgba(18, 10, 6, ${0.15 + Math.random() * 0.35})`;
        ctx.lineWidth = 0.8 + Math.random() * 2.2;
        const y = y0 + Math.random() * (plankH - 2);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(w * 0.35, y + (Math.random() - 0.5) * 6, w * 0.7, y + (Math.random() - 0.5) * 6, w, y);
        ctx.stroke();
      }

      // Warm amber streaks
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = `rgba(140, 75, 35, ${0.08 + Math.random() * 0.12})`;
        ctx.fillRect(Math.random() * w, y0 + Math.random() * plankH, 30 + Math.random() * 90, 2 + Math.random() * 4);
      }

      // Plank seam shadow
      ctx.fillStyle = 'rgba(10, 5, 3, 0.85)';
      ctx.fillRect(0, y0 + plankH - 2, w, 2);
    }
  });

  const roughness = canvasTexture(
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = '#6a6a6a';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 60; i++) {
        ctx.strokeStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.1})`;
        ctx.lineWidth = 1.5;
        const y = Math.random() * h;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y + (Math.random() - 0.5) * 4);
        ctx.stroke();
      }
    },
    THREE.NoColorSpace
  );

  return { map, roughness };
}

function makeSillMaps(): { map: THREE.CanvasTexture; roughness: THREE.CanvasTexture } {
  const map = canvasTexture(512, 128, (ctx, w, h) => {
    // Rich varnished wood sill
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#2d1b12');
    grad.addColorStop(0.5, '#42281a');
    grad.addColorStop(1, '#2a1810');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Subtle grain
    for (let i = 0; i < 70; i++) {
      ctx.strokeStyle = `rgba(20, 10, 6, ${0.12 + Math.random() * 0.28})`;
      ctx.lineWidth = 1 + Math.random() * 2.0;
      const y = Math.random() * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + (Math.random() - 0.5) * 3);
      ctx.stroke();
    }
    // Wet varnish sheen streaks
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = `rgba(255, 200, 140, ${0.04 + Math.random() * 0.08})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 40 + Math.random() * 80, 2);
    }
  });

  const roughness = canvasTexture(
    256,
    128,
    (ctx, w, h) => {
      // Smoother satin/semi-gloss for windowsill
      ctx.fillStyle = '#444444';
      ctx.fillRect(0, 0, w, h);
    },
    THREE.NoColorSpace
  );

  return { map, roughness };
}

function makeForestBackdrop(): THREE.CanvasTexture {
  return canvasTexture(1024, 512, (ctx, w, h) => {
    // Rainy night sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#060a14');
    sky.addColorStop(0.45, '#0b1424');
    sky.addColorStop(0.75, '#121e30');
    sky.addColorStop(1, '#0e1724');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Distant warm cabin / porch light glow in the fog
    const porchX = w * 0.68;
    const porchY = h * 0.56;
    const porchGlow = ctx.createRadialGradient(porchX, porchY, 2, porchX, porchY, 190);
    porchGlow.addColorStop(0, 'rgba(255, 195, 100, 0.95)');
    porchGlow.addColorStop(0.18, 'rgba(230, 140, 50, 0.45)');
    porchGlow.addColorStop(0.45, 'rgba(160, 80, 30, 0.15)');
    porchGlow.addColorStop(1, 'rgba(10, 20, 35, 0)');
    ctx.fillStyle = porchGlow;
    ctx.fillRect(0, 0, w, h);

    // Distant small cabin silhouette under porch light
    ctx.fillStyle = '#080d16';
    ctx.beginPath();
    ctx.moveTo(porchX - 45, porchY + 35);
    ctx.lineTo(porchX - 25, porchY + 12);
    ctx.lineTo(porchX + 25, porchY + 12);
    ctx.lineTo(porchX + 45, porchY + 35);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(porchX - 40, porchY + 35, 80, 60);

    // Warm tiny window in distant cabin
    ctx.fillStyle = '#ffb347';
    ctx.fillRect(porchX - 18, porchY + 44, 14, 14);

    // Layer 1: Distant misty pine trees
    ctx.fillStyle = 'rgba(8, 14, 24, 0.65)';
    drawPineLine(ctx, w, h * 0.52, 28, 65, 110);

    // Layer 2: Mid-distance pines
    ctx.fillStyle = 'rgba(6, 10, 18, 0.88)';
    drawPineLine(ctx, w, h * 0.62, 20, 90, 160);

    // Layer 3: Close dark pine silhouettes
    ctx.fillStyle = '#04070c';
    drawPineLine(ctx, w, h * 0.72, 14, 120, 230);

    // Soft fog layer across bottom
    const fog = ctx.createLinearGradient(0, h * 0.5, 0, h);
    fog.addColorStop(0, 'rgba(14, 22, 34, 0)');
    fog.addColorStop(0.65, 'rgba(16, 26, 40, 0.45)');
    fog.addColorStop(1, 'rgba(12, 18, 28, 0.85)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, h * 0.5, w, h * 0.5);
  });
}

function drawPineLine(
  ctx: CanvasRenderingContext2D,
  w: number,
  groundY: number,
  count: number,
  minH: number,
  maxH: number
): void {
  for (let i = 0; i < count; i++) {
    const x = (i / count) * w + (Math.random() - 0.5) * (w / count);
    const treeH = minH + Math.random() * (maxH - minH);
    const treeW = treeH * (0.28 + Math.random() * 0.14);
    const topY = groundY - treeH;

    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x + treeW * 0.5, groundY);
    ctx.lineTo(x - treeW * 0.5, groundY);
    ctx.closePath();
    ctx.fill();

    // Ruffled branches
    for (let b = 1; b <= 4; b++) {
      const by = topY + (treeH * b) / 5;
      const bw = (treeW * b) / 4.5;
      ctx.beginPath();
      ctx.moveTo(x, by - 8);
      ctx.lineTo(x + bw * 0.6, by + 12);
      ctx.lineTo(x - bw * 0.6, by + 12);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function makeBookTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#4a1e1b';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d4af37';
    ctx.fillRect(w * 0.15, 0, 4, h);
    ctx.fillRect(w * 0.85, 0, 4, h);
    ctx.fillStyle = '#2d1311';
    ctx.fillRect(w * 0.3, 0, w * 0.4, h);
  });
}

export class RainlightWindow {
  private readonly runtime: SceneRuntime;
  private readonly energy = new AudioEnergySmoother({
    bass: 0.16,
    mid: 0.14,
    treble: 0.2,
    energy: 0.12,
    pulseDecay: 2.0,
  });

  private readonly woodMaps: { map: THREE.CanvasTexture; roughness: THREE.CanvasTexture };
  private readonly sillMaps: { map: THREE.CanvasTexture; roughness: THREE.CanvasTexture };
  private readonly forestMap: THREE.CanvasTexture;
  private readonly bookMap: THREE.CanvasTexture;

  private readonly glassMaterial: THREE.ShaderMaterial;
  private readonly glassMesh: THREE.Mesh;

  private readonly candleLight: THREE.PointLight;
  private readonly wallSconceLight: THREE.PointLight;
  private readonly exteriorLight: THREE.PointLight;
  private readonly flameMesh: THREE.Mesh;
  private readonly flameMaterial: THREE.ShaderMaterial;

  private readonly outdoorRainGeom: THREE.BufferGeometry;
  private readonly outdoorRainMat: THREE.ShaderMaterial;
  private readonly outdoorRainPositions: Float32Array;
  private readonly outdoorDrops: OutdoorRainDrop[] = [];

  private readonly steamGeom: THREE.BufferGeometry;
  private readonly steamMat: THREE.ShaderMaterial;
  private readonly steamPositions: Float32Array;
  private readonly steamSizes: Float32Array;
  private readonly steamAlphas: Float32Array;
  private readonly steamColors: Float32Array;
  private readonly steamMotes: SteamMote[] = [];

  private qualityTier = 2;
  private simTime = 0;
  private thunderTimer = 0;
  private thunderIntensity = 0;
  private outdoorRainCount = MAX_OUTDOOR_RAIN;

  constructor(container: HTMLElement, options: SceneVisualizerOptions = {}) {
    this.runtime = new SceneRuntime(container, {
      onContextLost: options.onContextLost,
      fov: 42,
      near: 0.08,
      far: 50,
      cameraPosition: [0.18, 1.15, 1.75],
      target: [0, 1.02, 0],
      enablePan: false,
      minDistance: 0.75,
      maxDistance: 3.6,
      minPolarAngle: Math.PI * 0.16,
      maxPolarAngle: Math.PI * 0.78,
      dampingFactor: 0.07,
      background: 0x080c14,
      fogDensity: 0.038,
      toneMappingExposure: 1.02,
      useEnvironment: true,
      environmentIntensity: 0.18,
      environmentBlur: 0.12,
      autoRotateSpeedScale: 0.65,
      onResize: () => this.frameWindow(),
    });

    this.woodMaps = makeWoodPlankMaps();
    this.sillMaps = makeSillMaps();
    this.forestMap = makeForestBackdrop();
    this.bookMap = makeBookTexture();

    this.buildCabinRoom();
    this.buildWindowStructure();

    // Window Glass Shader
    this.glassMaterial = new THREE.ShaderMaterial({
      vertexShader: GLASS_VERT,
      fragmentShader: GLASS_FRAG,
      uniforms: {
        uCamPos: { value: new THREE.Vector3() },
        uCandlePos: { value: new THREE.Vector3(0.36, 1.15, 0.12) },
        uDistantLightPos: { value: new THREE.Vector3(1.2, 1.5, -3.2) },
        uTime: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTreble: { value: 0 },
        uEnergy: { value: 0 },
        uPulse: { value: 0 },
        uThunder: { value: 0 },
        uHue: { value: 0.0 },
        uSat: { value: 0.3 },
        uSteps: { value: 36 },
        uForestTexture: { value: this.forestMap },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.glassMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.68, 1.28), this.glassMaterial);
    this.glassMesh.position.set(0, 1.44, -0.02);
    this.glassMesh.renderOrder = 3;
    this.runtime.scene.add(this.glassMesh);

    // Candle and lights
    this.candleLight = new THREE.PointLight(0xff8a38, 4.2, 4.2, 1.6);
    this.candleLight.position.set(0.36, 1.15, 0.12);
    this.runtime.scene.add(this.candleLight);

    this.wallSconceLight = new THREE.PointLight(0xffa458, 2.2, 4.8, 1.5);
    this.wallSconceLight.position.set(1.95, 1.48, 0.6);
    this.runtime.scene.add(this.wallSconceLight);

    this.exteriorLight = new THREE.PointLight(0x487498, 1.8, 8.5, 1.2);
    this.exteriorLight.position.set(0, 1.8, -2.6);
    this.runtime.scene.add(this.exteriorLight);

    // Candle flame teardrop
    this.flameMaterial = new THREE.ShaderMaterial({
      vertexShader: FLAME_VERT,
      fragmentShader: FLAME_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uPulse: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.flameMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.045, 0.08), this.flameMaterial);
    this.flameMesh.position.set(0.36, 1.09, 0.08);
    this.flameMesh.renderOrder = 4;
    this.runtime.scene.add(this.flameMesh);

    // Props on windowsill
    this.buildSillProps();

    // Outdoor rain
    const rain = this.buildOutdoorRain();
    this.outdoorRainGeom = rain.geometry;
    this.outdoorRainMat = rain.material;
    this.outdoorRainPositions = rain.positions;

    // Steam & motes
    const steam = this.buildSteamAndMotes();
    this.steamGeom = steam.geometry;
    this.steamMat = steam.material;
    this.steamPositions = steam.positions;
    this.steamSizes = steam.sizes;
    this.steamAlphas = steam.alphas;
    this.steamColors = steam.colors;

    this.runtime.resize();
  }

  private buildCabinRoom(): void {
    const scene = this.runtime.scene;
    const woodMat = new THREE.MeshStandardMaterial({
      map: this.woodMaps.map,
      roughnessMap: this.woodMaps.roughness,
      roughness: 0.82,
      metalness: 0.03,
      color: 0x3a251b,
    });

    // Floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.4), woodMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.0, 1.0);
    scene.add(floor);

    // Ceiling with wood beams
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.4), woodMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 2.38, 1.0);
    scene.add(ceiling);

    const beamGeom = new THREE.BoxGeometry(4.4, 0.08, 0.09);
    for (let b = 0; b < 4; b++) {
      const beam = new THREE.Mesh(beamGeom, woodMat);
      beam.position.set(0, 2.33, -0.2 + b * 0.75);
      scene.add(beam);
    }

    // Left Wall
    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.4), woodMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-2.2, 1.2, 1.0);
    scene.add(leftWall);

    // Right Wall
    const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.4), woodMat);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(2.2, 1.2, 1.0);
    scene.add(rightWall);

    // Back Wall (Interior)
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.4), woodMat);
    backWall.rotation.y = Math.PI;
    backWall.position.set(0, 1.2, 2.7);
    scene.add(backWall);

    // Front Wall (with opening for window)
    const frontWallLeft = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.4), woodMat);
    frontWallLeft.position.set(-1.55, 1.2, 0);
    scene.add(frontWallLeft);

    const frontWallRight = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.4), woodMat);
    frontWallRight.position.set(1.55, 1.2, 0);
    scene.add(frontWallRight);

    const frontWallTop = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.32), woodMat);
    frontWallTop.position.set(0, 2.22, 0);
    scene.add(frontWallTop);

    const frontWallBottom = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.78), woodMat);
    frontWallBottom.position.set(0, 0.39, 0);
    scene.add(frontWallBottom);

    // Ambient Lighting
    scene.add(new THREE.AmbientLight(0x162030, 0.32));
    const hemi = new THREE.HemisphereLight(0x32445c, 0x18100c, 0.28);
    scene.add(hemi);

    // Back Wall Bookshelf & Details
    this.buildInteriorDecor();
  }

  private buildInteriorDecor(): void {
    const scene = this.runtime.scene;
    const darkWoodMat = new THREE.MeshStandardMaterial({
      color: 0x22140e,
      roughness: 0.85,
    });

    // Bookshelf on back wall
    const shelfGeom = new THREE.BoxGeometry(1.8, 0.04, 0.24);
    const shelf1 = new THREE.Mesh(shelfGeom, darkWoodMat);
    shelf1.position.set(-0.2, 1.35, 2.58);
    scene.add(shelf1);

    const shelf2 = new THREE.Mesh(shelfGeom, darkWoodMat);
    shelf2.position.set(-0.2, 0.95, 2.58);
    scene.add(shelf2);

    // Books on shelves
    const bookColors = [0x5c2420, 0x2b3d30, 0x1f2e48, 0x705228, 0x482b40];
    for (let i = 0; i < 10; i++) {
      const bookH = 0.16 + (i % 3) * 0.03;
      const bookW = 0.035 + (i % 2) * 0.015;
      const bGeom = new THREE.BoxGeometry(bookW, bookH, 0.18);
      const bMat = new THREE.MeshStandardMaterial({
        color: bookColors[i % bookColors.length],
        roughness: 0.7,
      });
      const book = new THREE.Mesh(bGeom, bMat);
      book.position.set(-0.9 + i * 0.075, 1.35 + bookH * 0.5 + 0.02, 2.58);
      scene.add(book);
    }

    // Right wall sconce fixture
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xc89848,
      metalness: 0.82,
      roughness: 0.35,
    });
    const sconceBase = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.18, 12), brassMat);
    sconceBase.position.set(2.16, 1.48, 0.6);
    scene.add(sconceBase);

    const sconceGlass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.05, 0.14, 12),
      new THREE.MeshStandardMaterial({
        color: 0xffe8c0,
        emissive: new THREE.Color(0xff9840),
        emissiveIntensity: 0.9,
        transparent: true,
        opacity: 0.85,
      })
    );
    sconceGlass.position.set(2.14, 1.54, 0.6);
    scene.add(sconceGlass);
  }

  private buildWindowStructure(): void {
    const scene = this.runtime.scene;
    const sillMat = new THREE.MeshStandardMaterial({
      map: this.sillMaps.map,
      roughnessMap: this.sillMaps.roughness,
      roughness: 0.65,
      metalness: 0.02,
      color: 0x3e281c,
    });

    const frameWoodMat = new THREE.MeshStandardMaterial({
      map: this.woodMaps.map,
      roughnessMap: this.woodMaps.roughness,
      roughness: 0.8,
      color: 0x2e1a12,
    });

    // Deep Windowsill
    const sill = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.06, 0.34), sillMat);
    sill.position.set(0, 0.78, 0.08);
    scene.add(sill);

    // Outer Window Frame
    const topFrame = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.07, 0.12), frameWoodMat);
    topFrame.position.set(0, 2.08, 0.01);
    scene.add(topFrame);

    const leftFrame = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.34, 0.12), frameWoodMat);
    leftFrame.position.set(-0.87, 1.44, 0.01);
    scene.add(leftFrame);

    const rightFrame = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.34, 0.12), frameWoodMat);
    rightFrame.position.set(0.87, 1.44, 0.01);
    scene.add(rightFrame);

    // Inner Mullions (Dividers for 6 cozy panes)
    const midVertical = new THREE.Mesh(new THREE.BoxGeometry(0.038, 1.28, 0.04), frameWoodMat);
    midVertical.position.set(0, 1.44, 0.0);
    scene.add(midVertical);

    const midHorizontal1 = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.034, 0.04), frameWoodMat);
    midHorizontal1.position.set(0, 1.22, 0.0);
    scene.add(midHorizontal1);

    const midHorizontal2 = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.034, 0.04), frameWoodMat);
    midHorizontal2.position.set(0, 1.66, 0.0);
    scene.add(midHorizontal2);

    // Exterior Forest & Night Backdrop Plane
    const forestPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(7.2, 4.2),
      new THREE.MeshBasicMaterial({
        map: this.forestMap,
        fog: false,
      })
    );
    forestPlane.position.set(0, 1.5, -3.8);
    scene.add(forestPlane);
  }

  private buildSillProps(): void {
    const scene = this.runtime.scene;

    // Ceramic Coffee / Tea Mug
    const ceramicMat = new THREE.MeshStandardMaterial({
      color: 0xdedede,
      roughness: 0.32,
      metalness: 0.05,
    });
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.04, 0.09, 16), ceramicMat);
    mug.position.set(-0.4, 0.855, 0.09);
    scene.add(mug);

    // Mug handle
    const handleGeom = new THREE.TorusGeometry(0.024, 0.007, 8, 16, Math.PI);
    const handle = new THREE.Mesh(handleGeom, ceramicMat);
    handle.rotation.z = -Math.PI / 2;
    handle.position.set(-0.45, 0.855, 0.09);
    scene.add(handle);

    // Coffee liquid inside mug
    const coffee = new THREE.Mesh(
      new THREE.CircleGeometry(0.042, 16),
      new THREE.MeshStandardMaterial({
        color: 0x1f1008,
        roughness: 0.1,
      })
    );
    coffee.rotation.x = -Math.PI / 2;
    coffee.position.set(-0.4, 0.89, 0.09);
    scene.add(coffee);

    // Candle assembly
    const brassDish = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.065, 0.015, 16),
      new THREE.MeshStandardMaterial({
        color: 0xb58838,
        metalness: 0.85,
        roughness: 0.3,
      })
    );
    brassDish.position.set(0.36, 0.817, 0.08);
    scene.add(brassDish);

    const waxMat = new THREE.MeshStandardMaterial({
      color: 0xf5ebd6,
      roughness: 0.55,
      metalness: 0.02,
      emissive: new THREE.Color(0xff7722),
      emissiveIntensity: 0.32,
    });
    const candleWax = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.13, 16), waxMat);
    candleWax.position.set(0.36, 0.88, 0.08);
    scene.add(candleWax);

    const wick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.003, 0.003, 0.02, 6),
      new THREE.MeshBasicMaterial({ color: 0x111111 })
    );
    wick.position.set(0.36, 0.955, 0.08);
    scene.add(wick);

    // Small book stack
    const book1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.028, 0.13),
      new THREE.MeshStandardMaterial({
        map: this.bookMap,
        roughness: 0.72,
        color: 0x3d1f1a,
      })
    );
    book1.position.set(-0.66, 0.824, 0.08);
    book1.rotation.y = 0.12;
    scene.add(book1);

    const book2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.024, 0.12),
      new THREE.MeshStandardMaterial({
        map: this.bookMap,
        roughness: 0.75,
        color: 0x1f2e24,
      })
    );
    book2.position.set(-0.65, 0.85, 0.08);
    book2.rotation.y = -0.08;
    scene.add(book2);
  }

  private buildOutdoorRain(): {
    geometry: THREE.BufferGeometry;
    material: THREE.ShaderMaterial;
    positions: Float32Array;
  } {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_OUTDOOR_RAIN * 3);
    const lengths = new Float32Array(MAX_OUTDOOR_RAIN);
    const speeds = new Float32Array(MAX_OUTDOOR_RAIN);

    for (let i = 0; i < MAX_OUTDOOR_RAIN; i++) {
      const drop: OutdoorRainDrop = {
        pos: new THREE.Vector3(
          (Math.random() - 0.5) * 3.8,
          0.5 + Math.random() * 2.8,
          -0.15 - Math.random() * 3.2
        ),
        vel: new THREE.Vector3(-0.15 - Math.random() * 0.1, -2.8 - Math.random() * 2.2, 0),
        length: 0.04 + Math.random() * 0.07,
        speed: 1.0 + Math.random() * 0.6,
      };
      this.outdoorDrops.push(drop);

      positions[i * 3] = drop.pos.x;
      positions[i * 3 + 1] = drop.pos.y;
      positions[i * 3 + 2] = drop.pos.z;
      lengths[i] = drop.length;
      speeds[i] = drop.speed;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aLength', new THREE.BufferAttribute(lengths, 1));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

    const material = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      uniforms: {
        uPixelRatio: { value: this.runtime.currentPixelRatio },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x88aacc) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 2;
    this.runtime.scene.add(points);

    return { geometry, material, positions };
  }

  private buildSteamAndMotes(): {
    geometry: THREE.BufferGeometry;
    material: THREE.ShaderMaterial;
    positions: Float32Array;
    sizes: Float32Array;
    alphas: Float32Array;
    colors: Float32Array;
  } {
    const totalCount = MAX_STEAM_MOTES + MAX_ROOM_MOTES;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(totalCount * 3);
    const sizes = new Float32Array(totalCount);
    const alphas = new Float32Array(totalCount);
    const colors = new Float32Array(totalCount * 3);

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.ShaderMaterial({
      vertexShader: STEAM_VERT,
      fragmentShader: STEAM_FRAG,
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

    // Initialize Steam from Mug
    for (let i = 0; i < MAX_STEAM_MOTES; i++) {
      this.steamMotes.push({
        pos: new THREE.Vector3(-0.4, 0.9 + Math.random() * 0.4, 0.09),
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.02, 0.05 + Math.random() * 0.06, (Math.random() - 0.5) * 0.02),
        life: Math.random(),
        maxLife: 1.8 + Math.random() * 1.4,
        size: 0.035 + Math.random() * 0.05,
        type: 'steam',
      });
    }

    // Initialize Warm Ambient Room Motes
    for (let i = 0; i < MAX_ROOM_MOTES; i++) {
      this.steamMotes.push({
        pos: new THREE.Vector3(
          (Math.random() - 0.5) * 2.2,
          0.8 + Math.random() * 1.2,
          0.1 + Math.random() * 1.5
        ),
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.015, (Math.random() - 0.5) * 0.015, (Math.random() - 0.5) * 0.015),
        life: Math.random() * 4.0,
        maxLife: 3.5 + Math.random() * 3.0,
        size: 0.015 + Math.random() * 0.025,
        type: 'mote',
      });
    }

    return { geometry, material, positions, sizes, alphas, colors };
  }

  private updateOutdoorRain(dt: number, reduced: boolean): void {
    if (reduced) return;
    const speedMult = 1.0 + this.energy.mid * 0.85 + this.energy.heatPulse * 0.4;
    for (let i = 0; i < MAX_OUTDOOR_RAIN; i++) {
      const drop = this.outdoorDrops[i];
      if (i >= this.outdoorRainCount) {
        this.outdoorRainPositions[i * 3 + 1] = -10;
        continue;
      }
      drop.pos.y += drop.vel.y * drop.speed * speedMult * dt;
      drop.pos.x += drop.vel.x * dt;

      // Wrap around when falling past bottom
      if (drop.pos.y < 0.2) {
        drop.pos.y = 3.2 + Math.random() * 0.4;
        drop.pos.x = (Math.random() - 0.5) * 3.8;
      }

      this.outdoorRainPositions[i * 3] = drop.pos.x;
      this.outdoorRainPositions[i * 3 + 1] = drop.pos.y;
      this.outdoorRainPositions[i * 3 + 2] = drop.pos.z;
    }
    this.outdoorRainGeom.getAttribute('position').needsUpdate = true;
    this.outdoorRainMat.uniforms.uPixelRatio.value = this.runtime.currentPixelRatio;
    this.outdoorRainMat.uniforms.uTime.value = this.simTime;
  }

  private updateSteamAndMotes(dt: number, reduced: boolean): void {
    const totalCount = this.steamMotes.length;
    for (let i = 0; i < totalCount; i++) {
      const p = this.steamMotes[i];
      if (!reduced) {
        p.life += dt;
        if (p.type === 'steam') {
          if (p.life >= p.maxLife) {
            p.life = 0;
            p.pos.set(-0.4 + (Math.random() - 0.5) * 0.03, 0.9, 0.09 + (Math.random() - 0.5) * 0.03);
            p.vel.set(
              (Math.random() - 0.5) * 0.025 + Math.sin(this.simTime * 2.0) * 0.015,
              0.06 + Math.random() * 0.07 + this.energy.mid * 0.05,
              (Math.random() - 0.5) * 0.025
            );
          } else {
            p.pos.addScaledVector(p.vel, dt);
            p.vel.x += Math.sin(this.simTime * 3.2 + i) * 0.008 * dt;
          }
        } else {
          // Room mote drift
          if (p.life >= p.maxLife) {
            p.life = 0;
            p.pos.set(
              (Math.random() - 0.5) * 2.2,
              0.8 + Math.random() * 1.2,
              0.1 + Math.random() * 1.5
            );
          } else {
            p.pos.addScaledVector(p.vel, dt);
          }
        }
      }

      const progress = p.life / p.maxLife;
      const fade = Math.sin(progress * Math.PI);
      const alpha = p.type === 'steam' ? fade * 0.28 : fade * (0.35 + this.energy.treble * 0.45);

      this.steamPositions[i * 3] = p.pos.x;
      this.steamPositions[i * 3 + 1] = p.pos.y;
      this.steamPositions[i * 3 + 2] = p.pos.z;
      this.steamSizes[i] = p.size * (1.0 + progress * 0.8);
      this.steamAlphas[i] = alpha;

      if (p.type === 'steam') {
        this.steamColors[i * 3] = 0.95;
        this.steamColors[i * 3 + 1] = 0.88;
        this.steamColors[i * 3 + 2] = 0.76;
      } else {
        // Golden room dust motes catching candle light
        this.steamColors[i * 3] = 1.0;
        this.steamColors[i * 3 + 1] = 0.82;
        this.steamColors[i * 3 + 2] = 0.52;
      }
    }

    this.steamGeom.getAttribute('position').needsUpdate = true;
    this.steamGeom.getAttribute('aSize').needsUpdate = true;
    this.steamGeom.getAttribute('aAlpha').needsUpdate = true;
    this.steamGeom.getAttribute('color').needsUpdate = true;
    this.steamMat.uniforms.uPixelRatio.value = this.runtime.currentPixelRatio;
  }

  private updateLighting(settings: AppSettingsV1, dt: number): void {
    // Distant rare thunder logic
    if (this.energy.treble > 0.65 && Math.random() < 0.08 * dt && this.thunderTimer <= 0) {
      this.thunderTimer = 1.2;
      this.thunderIntensity = 0.75 + this.energy.heatPulse * 0.25;
    }
    if (this.thunderTimer > 0) {
      this.thunderTimer -= dt;
      this.thunderIntensity = Math.max(0, this.thunderIntensity - dt * 0.9);
    }

    // Candle flame flicker & audio pulse
    const flicker = 0.08 * Math.sin(this.simTime * 12.0) + 0.04 * Math.sin(this.simTime * 23.5);
    const candleGlow = 3.2 + this.energy.bass * 3.5 + this.energy.heatPulse * 2.2 + flicker;

    let candleCol = new THREE.Color(0xff8a38);
    let fogCol = new THREE.Color(0x487498);

    if (settings.colorMode === 'mood') {
      candleCol = new THREE.Color().setHSL(0.06 + this.energy.bass * 0.03, 0.92, 0.56);
      fogCol = new THREE.Color().setHSL(0.62, 0.45, 0.28);
    } else if (settings.colorMode === 'spectrum') {
      candleCol = new THREE.Color().setHSL((0.07 + this.energy.mid * 0.08) % 1, 0.88, 0.54);
      fogCol = new THREE.Color().setHSL((0.58 + this.energy.bass * 0.1) % 1, 0.5, 0.32);
    }

    this.candleLight.intensity = candleGlow;
    this.candleLight.color.copy(candleCol);

    this.wallSconceLight.intensity = 1.8 + this.energy.energy * 1.5;
    this.wallSconceLight.color.copy(candleCol);

    this.exteriorLight.intensity = 1.4 + this.energy.bass * 1.6 + this.thunderIntensity * 2.5;
    this.exteriorLight.color.copy(fogCol);

    // Update glass shader uniforms
    const gu = this.glassMaterial.uniforms;
    gu.uCamPos.value.copy(this.runtime.camera.position);
    gu.uTime.value = this.simTime;
    gu.uBass.value = this.energy.bass;
    gu.uMid.value = this.energy.mid;
    gu.uTreble.value = this.energy.treble;
    gu.uEnergy.value = this.energy.energy;
    gu.uPulse.value = this.energy.heatPulse;
    gu.uThunder.value = this.thunderIntensity;
    gu.uHue.value = settings.colorMode === 'spectrum' ? (this.energy.mid * 0.15) % 1 : 0.0;
    gu.uSat.value = settings.colorMode === 'mono' ? 0.05 : 0.35;

    // Update flame shader uniforms
    this.flameMaterial.uniforms.uTime.value = this.simTime;
    this.flameMaterial.uniforms.uBass.value = this.energy.bass;
    this.flameMaterial.uniforms.uPulse.value = this.energy.heatPulse;
  }

  private frameWindow(): void {
    this.runtime.controls.target.set(0, 1.05, 0);
    const vFov = THREE.MathUtils.degToRad(this.runtime.camera.fov);
    const aspect = Math.max(this.runtime.camera.aspect, 0.2);
    const fitH = 1.55;
    const fitW = 1.7;
    const distH = fitH / 2 / Math.tan(vFov / 2);
    const distW = fitW / 2 / (Math.tan(vFov / 2) * aspect);
    const dist = Math.max(distH, distW) * 1.08;

    const offset = this.runtime.camera.position.clone().sub(this.runtime.controls.target);
    if (offset.lengthSq() < 1e-6) offset.set(0.15, 0.12, 1.6);
    offset.normalize().multiplyScalar(dist);
    this.runtime.camera.position.copy(this.runtime.controls.target).add(offset);
    this.runtime.controls.minDistance = dist * 0.45;
    this.runtime.controls.maxDistance = dist * 2.2;
  }

  public degradeQuality(): boolean {
    if (this.runtime.degradeQuality()) return true;
    if (this.qualityTier > 0) {
      this.qualityTier -= 1;
      this.outdoorRainCount = [40, 80, MAX_OUTDOOR_RAIN][this.qualityTier];
      this.glassMaterial.uniforms.uSteps.value = [18, 28, 36][this.qualityTier];
      return true;
    }
    return false;
  }

  public render(bands: Float32Array, settings: AppSettingsV1): void {
    if (!this.runtime.alive) return;

    const { now, rawDt } = this.runtime.beginFrame();
    const reduced = this.runtime.applyControls(settings, 0.65);
    const dt = reduced ? 0 : rawDt * atmosphereSpeed(settings);
    if (!reduced) {
      this.simTime += dt;
      this.energy.update(bands, dt);
    }

    this.updateLighting(settings, dt);
    this.updateOutdoorRain(dt, reduced);
    this.updateSteamAndMotes(dt, reduced);

    this.runtime.renderScene(now);
  }

  public destroy(): void {
    if (this.runtime.isDestroyed) return;
    this.woodMaps.map.dispose();
    this.woodMaps.roughness.dispose();
    this.sillMaps.map.dispose();
    this.sillMaps.roughness.dispose();
    this.forestMap.dispose();
    this.bookMap.dispose();
    this.runtime.disposeSceneGraph();
    this.runtime.destroy();
  }
}
