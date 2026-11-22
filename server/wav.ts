export function isValidWavBase64(base64: string, minBytes: number, maxBytes: number): boolean {
  if (typeof base64 !== "string" || base64.length === 0) return false;
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(base64)) return false;
  try {
    const buf = Buffer.from(base64, "base64");
    if (buf.length < minBytes || buf.length > maxBytes) return false;
    const riff = buf.subarray(0, 4).toString("ascii");
    const wave = buf.subarray(8, 12).toString("ascii");
    return riff === "RIFF" && wave === "WAVE";
  } catch {
    return false;
  }
}

export function calculateWavDurationSeconds(base64Audio: string): number {
  const buffer = Buffer.from(base64Audio, "base64");
  if (buffer.length <= 44) return 0;
  const byteRate = buffer.readUInt32LE(28) || 48000;
  const dataSize = Math.max(0, buffer.length - 44);
  return Number((dataSize / byteRate).toFixed(2));
}

export function extractWavPcm(buf: Buffer): {
  pcm: Buffer;
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
} {
  const sampleRate = buf.length >= 28 ? buf.readUInt32LE(24) || 24000 : 24000;
  const numChannels = buf.length >= 24 ? buf.readUInt16LE(22) || 1 : 1;
  const bitsPerSample = buf.length >= 36 ? buf.readUInt16LE(34) || 16 : 16;

  let offset = 12;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === "data") {
      const start = offset + 8;
      const end = Math.min(buf.length, start + chunkSize);
      return { pcm: buf.subarray(start, end), sampleRate, numChannels, bitsPerSample };
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  return {
    pcm: buf.length > 44 ? buf.subarray(44) : buf,
    sampleRate,
    numChannels,
    bitsPerSample,
  };
}

export function concatenateWavBuffers(wavBuffers: Buffer[], pauseMs = 160): Buffer {
  if (wavBuffers.length === 0) return Buffer.alloc(0);
  if (wavBuffers.length === 1) return wavBuffers[0];

  const first = extractWavPcm(wavBuffers[0]);
  const { sampleRate, numChannels, bitsPerSample } = first;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const silenceBytes = Math.max(0, Math.round((sampleRate * pauseMs) / 1000)) * blockAlign;
  const silenceBuf = silenceBytes > 0 ? Buffer.alloc(silenceBytes) : null;

  const chunks: Buffer[] = [];
  wavBuffers.forEach((wav, index) => {
    const { pcm } = extractWavPcm(wav);
    if (index > 0 && silenceBuf) {
      chunks.push(silenceBuf);
    }
    chunks.push(pcm);
  });

  const pcmData = Buffer.concat(chunks);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcmData.length, 40);

  return Buffer.concat([header, pcmData]);
}

// Gemini may return raw PCM (audio/L16;rate=24000) instead of WAV; wrap it so every consumer gets WAV.
export function ensureWav(base64: string, mimeType?: string): { base64: string; mimeType: string } {
  const buf = Buffer.from(base64, "base64");
  if (buf.subarray(0, 4).toString("ascii") === "RIFF") {
    return { base64, mimeType: "audio/wav" };
  }
  if (!/^audio\/(l16|pcm)/i.test(mimeType || "")) {
    return { base64, mimeType: mimeType || "audio/wav" };
  }
  const rate = Number(/rate=(\d+)/i.exec(mimeType || "")?.[1]) || 24000;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + buf.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(buf.length, 40);
  return { base64: Buffer.concat([header, buf]).toString("base64"), mimeType: "audio/wav" };
}
