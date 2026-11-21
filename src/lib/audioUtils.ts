import JSZip from "jszip";
import { IntensityLevel, PaceLevel, PhraseItem } from "../types/voice";

export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function base64ToAudioBlob(base64: string, mimeType = "audio/wav"): Blob {
  const bytes = base64ToUint8Array(base64);
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  return new Blob([arrayBuffer], { type: mimeType });
}

export function extractWavPeaks(base64: string, barCount = 96): number[] {
  try {
    const bytes = base64ToUint8Array(base64);
    const isRiffWav =
      bytes.length > 44 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46;

    if (!isRiffWav) {
      // Visual envelope fallback for MP3/FLAC/OGG outputs from external endpoints
      if (bytes.length < barCount) {
        return Array.from({ length: barCount }, () => 0.25);
      }
      const stride = Math.max(1, Math.floor(bytes.length / barCount));
      return Array.from({ length: barCount }, (_, i) => {
        const b = bytes[Math.min(bytes.length - 1, i * stride)] || 128;
        const normalized = Math.abs(b - 128) / 128;
        return Math.max(0.14, Math.min(0.95, 0.18 + normalized * 0.72));
      });
    }

    const headerOffset = 44;
    const dataLength = bytes.length - headerOffset;
    if (dataLength < 4) {
      return Array.from({ length: barCount }, () => 0.15);
    }

    const sampleCount = Math.floor(dataLength / 2);
    const view = new DataView(bytes.buffer, bytes.byteOffset + headerOffset, sampleCount * 2);
    const samplesPerBar = Math.max(1, Math.floor(sampleCount / barCount));
    const peaks: number[] = [];

    for (let i = 0; i < barCount; i++) {
      const start = i * samplesPerBar;
      const end = Math.min(sampleCount, start + samplesPerBar);
      let maxVal = 0;
      const step = Math.max(1, Math.floor((end - start) / 40));
      for (let j = start; j < end; j += step) {
        const sample = Math.abs(view.getInt16(j * 2, true)) / 32768;
        if (sample > maxVal) maxVal = sample;
      }
      peaks.push(maxVal);
    }

    const globalMax = Math.max(...peaks, 0.01);
    return peaks.map((p) => Math.max(0.08, Math.min(1, p / globalMax)));
  } catch {
    return Array.from({ length: barCount }, () => 0.25);
  }
}

export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function estimateSpeechSeconds(text: string): number {
  const clean = text.replace(/<[^>]+>|\|[^|]+\|/g, "").trim();
  if (!clean) return 0;
  return Math.max(1, Math.round(clean.length / 13.5));
}

export function composeStyleDirection(
  customStyle: string,
  intensity: IntensityLevel,
  pace: PaceLevel
): string {
  const parts: string[] = [];

  if (customStyle.trim()) {
    parts.push(customStyle.trim());
  }

  if (intensity === "subtle") {
    parts.push("with subtle, understated emotional restraint");
  } else if (intensity === "intense") {
    parts.push("with deep, vivid emotional intensity and expressive emphasis");
  }

  if (pace === "slow") {
    parts.push("at an unhurried, reflective pace with thoughtful pauses");
  } else if (pace === "dynamic") {
    parts.push("with lively, natural conversational momentum");
  }

  return parts.join(", ");
}

export function getAudioExtensionFromMime(mimeType = "audio/wav"): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes("mpeg") || lower.includes("mp3")) return "mp3";
  if (lower.includes("flac")) return "flac";
  if (lower.includes("ogg") || lower.includes("opus")) return "ogg";
  return "wav";
}

export function downloadWavBase64(base64: string, filename: string, mimeType = "audio/wav"): void {
  const blob = base64ToAudioBlob(base64, mimeType);
  const url = URL.createObjectURL(blob);
  const ext = getAudioExtensionFromMime(mimeType);
  const baseName = filename.replace(/\.(wav|mp3|flac|ogg)$/i, "");
  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseName}.${ext}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeFilenameSlug(text: string): string {
  const cleaned = text
    .replace(/<[^>]+>|\|[^|]+\|/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join("_");
  return cleaned || "audio";
}

export async function downloadPhrasesZip(
  phrases: PhraseItem[],
  zipFilename = "resonancia-audios-numerados.zip"
): Promise<number> {
  const readyPhrases = phrases
    .map((item, idx) => ({ item, index: idx + 1 }))
    .filter(({ item }) => item.status === "ready" && Boolean(item.audioBase64));

  if (readyPhrases.length === 0) return 0;

  const zip = new JSZip();
  const padWidth = Math.max(2, String(phrases.length).length);

  for (const { item, index } of readyPhrases) {
    if (!item.audioBase64) continue;
    const prefix = String(index).padStart(padWidth, "0");
    const slug = sanitizeFilenameSlug(item.text);
    const ext = getAudioExtensionFromMime(item.mimeType);
    const filename = `${prefix}_${slug}.${ext}`;
    zip.file(filename, base64ToUint8Array(item.audioBase64));
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(zipBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = zipFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return readyPhrases.length;
}
