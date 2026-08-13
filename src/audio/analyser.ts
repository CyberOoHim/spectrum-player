/**
 * Groups frequency domain data (0..255) into logarithmically spaced bands (0..1).
 */
export function getBandsFromData(
  frequencyData: Uint8Array,
  barCount: number,
  sensitivity: number = 1.0
): Float32Array {
  const output = new Float32Array(barCount);
  const totalBins = frequencyData.length;

  if (totalBins === 0 || barCount <= 0) {
    return output;
  }

  // Use continuous logarithmic indexing with smooth interpolation
  // Human pitch hearing is logarithmic (20 Hz to 20 kHz)
  const minFreq = 0.5;
  const maxFreq = totalBins;
  const ratio = maxFreq / minFreq;

  for (let i = 0; i < barCount; i++) {
    const startPos = minFreq * Math.pow(ratio, i / barCount) - minFreq;
    const endPos = minFreq * Math.pow(ratio, (i + 1) / barCount) - minFreq;

    const startBin = Math.max(0, Math.min(Math.floor(startPos), totalBins - 1));
    const endBin = Math.max(startBin, Math.min(Math.floor(endPos), totalBins - 1));

    let sum = 0;
    let count = 0;

    if (startBin === endBin) {
      const frac = startPos - Math.floor(startPos);
      const nextBin = Math.min(totalBins - 1, startBin + 1);
      const v0 = frequencyData[startBin];
      const v1 = frequencyData[nextBin];
      sum = v0 * (1 - frac) + v1 * frac;
      count = 1;
    } else {
      for (let bin = startBin; bin <= endBin; bin++) {
        sum += frequencyData[bin];
        count++;
      }
    }

    const average = count > 0 ? sum / count : 0;
    const normalized = average / 255.0;
    const scaled = normalized * sensitivity;

    output[i] = Math.min(1.0, Math.max(0.0, scaled));
  }

  return output;
}

/**
 * Gets logarithmically grouped frequency bands directly from an AnalyserNode.
 */
export function getBands(
  analyser: AnalyserNode | null,
  frequencyBuffer: Uint8Array,
  barCount: number,
  sensitivity: number = 1.0
): Float32Array {
  if (!analyser) {
    return new Float32Array(barCount);
  }

  analyser.getByteFrequencyData(frequencyBuffer);
  return getBandsFromData(frequencyBuffer, barCount, sensitivity);
}
