const TARGET_SAMPLE_RATE = 24000;

function writeAsciiString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/**
 * Decodes any browser-recorded audio Blob (WebM/Opus, MP4/AAC, OGG, WAV)
 * and resamples it to 24 kHz, mono, 16-bit signed little-endian PCM WAV.
 */
export async function encodeBlobTo24kMonoWavBase64(blob: Blob): Promise<{
  wavBase64: string;
  durationSeconds: number;
}> {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  if (!AudioCtx) {
    throw new Error("Tu navegador no soporta procesamiento de audio Web Audio API.");
  }

  const decodeCtx = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    const rawBuffer = await blob.arrayBuffer();
    decoded = await decodeCtx.decodeAudioData(rawBuffer);
  } finally {
    await decodeCtx.close().catch(() => {});
  }

  if (!decoded || decoded.duration <= 0 || decoded.length <= 0) {
    throw new Error("La grabación está vacía. Intenta grabar nuevamente.");
  }

  const targetFrames = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offlineCtx = new OfflineAudioContext(1, targetFrames, TARGET_SAMPLE_RATE);

  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start(0);

  const rendered = await offlineCtx.startRendering();
  const channelData = rendered.getChannelData(0);

  // Measure peak to apply gentle gain only if the microphone input is very quiet
  let peak = 0;
  for (let i = 0; i < channelData.length; i++) {
    const abs = Math.abs(channelData[i]);
    if (abs > peak) peak = abs;
  }

  const gain = peak > 0.015 && peak < 0.5 ? Math.min(3.5, 0.75 / peak) : 1;

  const dataByteLength = channelData.length * 2;
  const wavBuffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(wavBuffer);

  writeAsciiString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataByteLength, true);
  writeAsciiString(view, 8, "WAVE");
  writeAsciiString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM subchunk size
  view.setUint16(20, 1, true); // Linear PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true); // ByteRate = 24000 * 1 * 2
  view.setUint16(32, 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  writeAsciiString(view, 36, "data");
  view.setUint32(40, dataByteLength, true);

  let offset = 44;
  for (let i = 0; i < channelData.length; i++) {
    const scaled = Math.max(-1, Math.min(1, channelData[i] * gain));
    const int16 = scaled < 0 ? Math.round(scaled * 32768) : Math.round(scaled * 32767);
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return {
    wavBase64: uint8ArrayToBase64(new Uint8Array(wavBuffer)),
    durationSeconds: Number((channelData.length / TARGET_SAMPLE_RATE).toFixed(2)),
  };
}
