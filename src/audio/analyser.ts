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

  // Use logarithmic indexing to group bins
  // Human pitch hearing is logarithmic (20 Hz to 20 kHz)
  const minLog = Math.log(1);
  const maxLog = Math.log(totalBins);

  for (let i = 0; i < barCount; i++) {
    const startLog = minLog + (i / barCount) * (maxLog - minLog);
    const endLog = minLog + ((i + 1) / barCount) * (maxLog - minLog);

    let startBin = Math.floor(Math.exp(startLog)) - 1;
    let endBin = Math.floor(Math.exp(endLog)) - 1;

    startBin = Math.max(0, Math.min(startBin, totalBins - 1));
    endBin = Math.max(startBin, Math.min(endBin, totalBins - 1));

    let sum = 0;
    let count = 0;

    for (let bin = startBin; bin <= endBin; bin++) {
      sum += frequencyData[bin];
      count++;
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
