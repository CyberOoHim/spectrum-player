export interface BandEnergy {
  bass: number;
  mid: number;
  treble: number;
  energy: number;
}

export interface AudioEnergyRates {
  bass: number;
  mid: number;
  treble: number;
  energy: number;
  pulseDecay: number;
  onsetWeight: number;
}

const DEFAULT_RATES: AudioEnergyRates = {
  bass: 0.2,
  mid: 0.16,
  treble: 0.22,
  energy: 0.14,
  pulseDecay: 3.2,
  onsetWeight: 0.35,
};

export function sampleBandEnergy(bands: Float32Array): BandEnergy {
  const third = Math.max(1, Math.floor(bands.length / 3));
  let bass = 0;
  let mid = 0;
  let treble = 0;

  for (let i = 0; i < bands.length; i++) {
    if (i < third) bass += bands[i];
    else if (i < third * 2) mid += bands[i];
    else treble += bands[i];
  }

  bass /= third;
  mid /= third;
  treble /= Math.max(1, bands.length - third * 2);

  return {
    bass,
    mid,
    treble,
    energy: bands.length ? bass * 0.5 + mid * 0.3 + treble * 0.2 : 0,
  };
}

export function bandAt(bands: Float32Array, t: number): number {
  if (bands.length === 0) return 0;
  const idx = Math.min(bands.length - 1, Math.floor(t * bands.length));
  return bands[idx] ?? 0;
}

/** Matches the lava-lamp smoother so atmosphere scenes share one feel. */
export class AudioEnergySmoother {
  bass = 0;
  mid = 0;
  treble = 0;
  energy = 0;
  heatPulse = 0;

  private readonly rates: AudioEnergyRates;

  constructor(rates: Partial<AudioEnergyRates> = {}) {
    this.rates = { ...DEFAULT_RATES, ...rates };
  }

  update(bands: Float32Array, dt: number): BandEnergy {
    const raw = sampleBandEnergy(bands);
    this.bass += (raw.bass - this.bass) * this.rates.bass;
    this.mid += (raw.mid - this.mid) * this.rates.mid;
    this.treble += (raw.treble - this.treble) * this.rates.treble;
    this.energy += (raw.energy - this.energy) * this.rates.energy;

    const onset = Math.max(0, raw.bass - this.heatPulse * this.rates.onsetWeight);
    this.heatPulse = Math.max(this.heatPulse * Math.exp(-dt * this.rates.pulseDecay), onset);

    return {
      bass: this.bass,
      mid: this.mid,
      treble: this.treble,
      energy: this.energy,
    };
  }
}
