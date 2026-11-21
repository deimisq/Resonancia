import "dotenv/config";
import dns from "dns/promises";
import net from "net";
import express, { NextFunction, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { App as FirebaseAdminApp, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { Client, handle_file } from "@gradio/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const ALLOW_SERVER_FALLBACK_KEY = process.env.ALLOW_SERVER_FALLBACK_KEY === "true";

interface AuthenticatedRequest extends Request {
  authUser?: {
    uid: string;
    email: string;
  };
}

function loadFirebaseProjectId(): string {
  const fromEnv =
    process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || "";
  if (fromEnv.trim()) {
    return fromEnv.trim();
  }
  try {
    const configPath = path.resolve(__dirname, "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
        projectId?: string;
      };
      if (parsed.projectId) {
        return parsed.projectId.trim();
      }
    }
  } catch {
    // Ignore config read errors and rely on env if present
  }
  return "";
}

function getFirebaseAdminApp(): FirebaseAdminApp {
  if (getApps().length > 0) {
    return getApp();
  }
  const projectId = loadFirebaseProjectId();
  if (!projectId) {
    throw new Error("MISSING_FIREBASE_PROJECT_ID");
  }
  return initializeApp({ projectId });
}

// Per-user sliding window rate limiter (in-memory)
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 45;
const userRequestTimestamps = new Map<string, number[]>();

function userRateLimiter(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const uid = req.authUser?.uid;
  if (!uid) {
    res.status(401).json({ error: "Autenticación requerida." });
    return;
  }

  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const recent = (userRequestTimestamps.get(uid) || []).filter((ts) => ts > windowStart);

  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    res.status(429).json({
      error: "Has enviado demasiadas solicitudes en un minuto. Espera unos segundos.",
      retryAfterSeconds: 15,
    });
    return;
  }

  recent.push(now);
  userRequestTimestamps.set(uid, recent);

  // Bound memory if map grows large
  if (userRequestTimestamps.size > 5000) {
    for (const [key, timestamps] of userRequestTimestamps.entries()) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= windowStart) {
        userRequestTimestamps.delete(key);
      }
    }
  }

  next();
}

async function requireVerifiedAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const customToken = (req.header("x-firebase-auth") || "").trim();
  const authHeader = req.header("authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const idToken = customToken || bearerToken;

  if (!idToken) {
    res.status(401).json({ error: "Debes iniciar sesión con Google para usar el estudio." });
    return;
  }

  if (idToken.length > 8192) {
    res.status(401).json({ error: "Token de sesión inválido." });
    return;
  }

  try {
    const adminApp = getFirebaseAdminApp();
    const decoded = await getAuth(adminApp).verifyIdToken(idToken);
    if (!decoded.email_verified) {
      res.status(401).json({
        error: "Tu cuenta debe tener un correo verificado para acceder a la síntesis.",
      });
      return;
    }

    req.authUser = {
      uid: decoded.uid,
      email: decoded.email || "",
    };
    next();
  } catch (error) {
    if (error instanceof Error && error.message === "MISSING_FIREBASE_PROJECT_ID") {
      res.status(500).json({
        error: "Falta configurar FIREBASE_PROJECT_ID en el servidor.",
      });
      return;
    }
    res.status(401).json({
      error: "Tu sesión ha expirado o no es válida. Inicia sesión nuevamente.",
    });
  }
}

function sanitizeKeyValue(raw: string): string {
  let value = raw.trim();
  value = value.replace(/^(?:GEMINI_API_KEY|VITE_GEMINI_API_KEY)\s*=\s*/i, "").trim();
  value = value.replace(/^["'`]+|["'`]+$/g, "").trim();
  value = value.replace(/[\r\n\t\u200B-\u200D\uFEFF]/g, "");
  return value;
}

function resolveUserGeminiKey(req: Request): string {
  const rawHeaderKey = req.header("x-gemini-key") || "";
  if (rawHeaderKey.trim()) {
    const cleaned = sanitizeKeyValue(rawHeaderKey);
    if (
      cleaned.length < 20 ||
      cleaned.length > 256 ||
      /\s/.test(cleaned) ||
      !/^[\x21-\x7E]+$/.test(cleaned)
    ) {
      throw new Error("INVALID_USER_API_KEY_FORMAT");
    }
    return cleaned;
  }

  if (ALLOW_SERVER_FALLBACK_KEY && process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY.trim();
  }

  throw new Error("MISSING_USER_API_KEY");
}

function getAiClient(apiKey: string, apiVersion?: string): GoogleGenAI {
  if (!apiKey) {
    throw new Error("MISSING_USER_API_KEY");
  }
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        "User-Agent": "resonancia-studio",
      },
    },
  });
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const errObj = error as { status?: number; message?: string };
      const status = errObj?.status;
      const isTransient = status === 429 || status === 503 || status === 500;
      const effectiveMax = status === 429 ? 1 : maxRetries;
      if (!isTransient || attempt >= effectiveMax) {
        throw error;
      }
      const delayMs = status === 429 ? 2000 : 700 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function extractRetryAfterSeconds(rawMessage: string): number {
  const matchDelay = rawMessage.match(/retryDelay["']?\s*:\s*["']?(\d+(?:\.\d+)?)s/i);
  if (matchDelay) {
    return Math.max(5, Math.min(60, Math.ceil(Number(matchDelay[1]))));
  }
  const matchPlease = rawMessage.match(/retry in\s+(\d+(?:\.\d+)?)s/i);
  if (matchPlease) {
    return Math.max(5, Math.min(60, Math.ceil(Number(matchPlease[1]))));
  }
  return 20;
}

function parseErrorResponse(error: unknown): {
  status: number;
  message: string;
  retryAfterSeconds?: number;
} {
  if (error instanceof Error) {
    if (error.message === "MISSING_USER_API_KEY") {
      return {
        status: 400,
        message:
          "Falta configurar tu clave API personal de Gemini. Haz clic en 'Configurar clave API' para continuar.",
      };
    }
    if (error.message === "INVALID_USER_API_KEY_FORMAT") {
      return {
        status: 400,
        message:
          "La clave API debe tener al menos 20 caracteres sin espacios ni saltos de línea.",
      };
    }
  }

  const errObj = error as { status?: number; message?: string };
  const rawMessage = errObj?.message || "Error inesperado al comunicarse con el servicio de voz.";
  const status = typeof errObj?.status === "number" ? errObj.status : 500;

  // Log only safe status/summary (never raw headers or credentials)
  console.error(`[Resonancia API Error] status=${status}`);

  if (rawMessage.includes("API_KEY_INVALID") || rawMessage.includes("API key not valid")) {
    return {
      status: 400,
      message:
        "Tu clave API de Gemini no es válida o fue revocada. Verifícala en Google AI Studio.",
    };
  }
  if (status === 403 || rawMessage.includes("PERMISSION_DENIED")) {
    return {
      status: 400,
      message:
        "Tu clave API no tiene permiso para esta función de Gemini. Verifica que Generative Language API esté habilitada (y ten en cuenta que la clonación de voz requiere Nivel de Pago Tier 1+).",
    };
  }
  if (status === 400) {
    return {
      status: 400,
      message: "La solicitud al modelo de voz no es válida. Revisa el texto o la configuración.",
    };
  }
  if (status === 429 || rawMessage.includes("RESOURCE_EXHAUSTED")) {
    const retryAfterSeconds = extractRetryAfterSeconds(rawMessage);
    return {
      status: 429,
      retryAfterSeconds,
      message: `Se superó el límite de solicitudes por minuto de tu clave API. Espera unos ${retryAfterSeconds} segundos o cambia al motor Rápido (Lite).`,
    };
  }
  if (status === 404 || rawMessage.includes("NOT_FOUND")) {
    return {
      status: 404,
      message: "El modelo o recurso solicitado no está disponible para tu clave API.",
    };
  }

  return {
    status: status >= 400 && status < 600 && status !== 403 ? status : 500,
    message: "No se pudo completar la solicitud con Gemini. Inténtalo de nuevo.",
  };
}

const PREBUILT_VOICES = new Set(["Puck", "Charon", "Kore", "Fenrir", "Zephyr"]);

function isCustomVoiceToken(val: unknown): val is string {
  return (
    typeof val === "string" &&
    val.length >= 8 &&
    val.length <= 8192 &&
    /^(?:voice|voicekey)_[a-zA-Z0-9_\-+=/.]+$/.test(val.trim())
  );
}

function buildVoiceConfig(voiceName: unknown): {
  prebuiltVoiceConfig?: { voiceName: string };
  voice?: string;
} {
  const raw = typeof voiceName === "string" ? voiceName.trim() : "";
  if (PREBUILT_VOICES.has(raw)) {
    return { prebuiltVoiceConfig: { voiceName: raw } };
  }
  if (isCustomVoiceToken(raw)) {
    return { voice: raw };
  }
  return { prebuiltVoiceConfig: { voiceName: "Kore" } };
}

function isValidWavBase64(base64: string, minBytes: number, maxBytes: number): boolean {
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

function calculateWavDurationSeconds(base64Audio: string): number {
  const buffer = Buffer.from(base64Audio, "base64");
  if (buffer.length <= 44) return 0;
  const byteRate = buffer.readUInt32LE(28) || 48000;
  const dataSize = Math.max(0, buffer.length - 44);
  return Number((dataSize / byteRate).toFixed(2));
}

function extractWavPcm(buf: Buffer): {
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

function concatenateWavBuffers(wavBuffers: Buffer[], pauseMs = 160): Buffer {
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

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && parts[2] === 0) return true;
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateOrReservedIp(ip: string): boolean {
  const clean = ip.trim().toLowerCase();
  const ver = net.isIP(clean);
  if (ver === 4) {
    return isPrivateOrReservedIpv4(clean);
  }
  if (ver === 6) {
    if (clean === "::" || clean === "::1") return true;
    if (clean.startsWith("fc") || clean.startsWith("fd")) return true; // ULA
    if (clean.startsWith("fe8") || clean.startsWith("fe9") || clean.startsWith("fea") || clean.startsWith("feb")) {
      return true; // link-local
    }
    if (clean.startsWith("::ffff:")) {
      const mapped = clean.slice(7);
      if (net.isIP(mapped) === 4) {
        return isPrivateOrReservedIpv4(mapped);
      }
    }
    return false;
  }
  return true;
}

async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 500) {
    throw new Error("La URL del endpoint Open-Source no es válida o es demasiado larga.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Formato de URL inválido. Debe comenzar por https://");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Por seguridad, solo se permiten endpoints externos con HTTPS (https://...).");
  }

  if (parsed.username || parsed.password) {
    throw new Error("La URL del endpoint no debe incluir credenciales incrustadas.");
  }

  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
    throw new Error("No se permiten direcciones locales ni internas como endpoint.");
  }

  if (net.isIP(host) !== 0) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error("No se permiten direcciones IP privadas o locales.");
    }
    return parsed;
  }

  let records: Array<{ address: string }>;
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    throw new Error("No se pudo resolver el dominio del endpoint indicado. Verifica que la URL siga activa.");
  }

  if (!records || records.length === 0 || records.some((r) => isPrivateOrReservedIp(r.address))) {
    throw new Error("El dominio del endpoint resuelve a una dirección no permitida.");
  }

  return parsed;
}

async function safeFetchPublic(
  rawUrl: string,
  init: RequestInit & { signal?: AbortSignal } = {},
  maxRedirects = 2
): Promise<globalThis.Response> {
  let currentUrl = await assertSafePublicUrl(rawUrl);
  const initialOrigin = currentUrl.origin;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const nextHeaders = new Headers(init.headers);
    if (currentUrl.origin !== initialOrigin) {
      nextHeaders.delete("authorization");
    }

    const resp = await fetch(currentUrl.toString(), {
      ...init,
      headers: nextHeaders,
      redirect: "manual",
    });

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (!location || hop === maxRedirects) {
        throw new Error("El endpoint devolvió una redirección no permitida.");
      }
      const resolved = new URL(location, currentUrl).toString();
      currentUrl = await assertSafePublicUrl(resolved);
      continue;
    }

    return resp;
  }

  throw new Error("Demasiadas redirecciones en el endpoint externo.");
}

function parseHfSpaceId(raw: string): string {
  let value = raw.trim();
  if (!value) {
    throw new Error("Indica un Hugging Face Space (ej. ResembleAI/Chatterbox-Multilingual-TTS).");
  }
  const urlMatch = value.match(/^https?:\/\/huggingface\.co\/spaces\/([^/?#]+\/[^/?#]+)/i);
  if (urlMatch) {
    value = urlMatch[1];
  }
  value = value.replace(/^\/+|\/+$/g, "");
  if (!/^[a-zA-Z0-9._-]{1,80}\/[a-zA-Z0-9._-]{1,100}$/.test(value)) {
    throw new Error(
      "Formato de Space inválido. Usa 'usuario/nombre-del-space' (ej. ResembleAI/Chatterbox-Multilingual-TTS)."
    );
  }
  return value;
}

function sanitizeOptionalToken(raw: string | undefined): string {
  if (!raw) return "";
  const cleaned = raw.trim().replace(/[\r\n\t\u200B-\u200D\uFEFF]/g, "");
  if (cleaned.length > 512) return "";
  return cleaned;
}

async function verifyOptionalHfToken(hfToken: string): Promise<string | null> {
  if (!hfToken) return null;
  if (!hfToken.startsWith("hf_")) {
    throw new Error(
      "HF_TOKEN_INVALID_FORMAT: El HF Token debe comenzar por 'hf_'. Revisa que hayas copiado el token completo o déjalo vacío para Spaces públicos."
    );
  }
  const resp = await fetch("https://huggingface.co/api/whoami-v2", {
    method: "GET",
    headers: { Authorization: `Bearer ${hfToken}` },
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);

  if (!resp) {
    return null;
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new Error(
      "HF_TOKEN_REJECTED: Tu HF Token (hf_...) fue rechazado o revocado por Hugging Face. Crea un token de tipo Read en huggingface.co/settings/tokens o déjalo vacío en Spaces públicos."
    );
  }
  if (resp.ok) {
    const info = (await resp.json().catch(() => ({}))) as { name?: string };
    return typeof info.name === "string" && info.name.trim() ? info.name.trim() : null;
  }
  return null;
}

function detectAudioMimeFromBuffer(buf: Buffer, headerMime?: string | null): string {
  if (buf.length >= 12) {
    const head4 = buf.subarray(0, 4).toString("ascii");
    if (head4 === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WAVE") {
      return "audio/wav";
    }
    if (head4 === "fLaC") return "audio/flac";
    if (head4 === "OggS") return "audio/ogg";
    if (head4.startsWith("ID3") || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) {
      return "audio/mpeg";
    }
  }
  if (headerMime && headerMime.toLowerCase().startsWith("audio/")) {
    return headerMime.split(";")[0].trim().toLowerCase();
  }
  return "audio/wav";
}

function mapLanguageForGradio(
  lang: string,
  paramDesc: string
): string {
  const lower = lang.toLowerCase();
  if (/spanish|español/i.test(paramDesc) && !/\bes\b/i.test(paramDesc)) {
    if (lower === "es") return "Spanish";
    if (lower === "en") return "English";
    if (lower === "fr") return "French";
    if (lower === "pt") return "Portuguese";
  }
  return lower === "en" || lower === "fr" || lower === "pt" ? lower : "es";
}

interface GradioParamMeta {
  label?: string;
  parameter_name?: string;
  parameter_default?: unknown;
  parameter_has_default?: boolean;
  type?: string;
  description?: string;
  component?: string;
  python_type?: { type?: string; description?: string };
}

interface GradioEndpointMeta {
  parameters?: GradioParamMeta[];
  returns?: GradioParamMeta[];
}

function pickBestGradioTtsEndpoint(apiInfo: {
  named_endpoints?: Record<string, GradioEndpointMeta>;
  unnamed_endpoints?: Record<string, GradioEndpointMeta>;
}): { endpoint: string | number; info: GradioEndpointMeta } {
  const named = apiInfo?.named_endpoints || {};
  const preferredNames = [
    "/generate_tts_audio",
    "/generate_audio",
    "/synthesize",
    "/infer",
    "/tts",
    "/generate",
    "/predict",
    "/run",
  ];

  for (const name of preferredNames) {
    if (named[name] && Array.isArray(named[name].parameters) && named[name].parameters.length > 0) {
      return { endpoint: name, info: named[name] };
    }
  }

  for (const [name, info] of Object.entries(named)) {
    const params = info?.parameters || [];
    const hasText = params.some((p) => /text|textbox/i.test(`${p.component || ""} ${p.parameter_name || ""}`));
    const hasAudio = params.some((p) => /audio|file/i.test(`${p.component || ""} ${p.parameter_name || ""}`));
    if (hasText && hasAudio) {
      return { endpoint: name, info };
    }
  }

  const firstNamed = Object.entries(named).find(
    ([, info]) => Array.isArray(info?.parameters) && info.parameters.length > 0
  );
  if (firstNamed) {
    return { endpoint: firstNamed[0], info: firstNamed[1] };
  }

  const unnamed = apiInfo?.unnamed_endpoints || {};
  const firstUnnamed = Object.entries(unnamed).find(
    ([, info]) => Array.isArray(info?.parameters) && info.parameters.length > 0
  );
  if (firstUnnamed) {
    const idx = Number(firstUnnamed[0]);
    return { endpoint: Number.isNaN(idx) ? firstUnnamed[0] : idx, info: firstUnnamed[1] };
  }

  throw new Error("El Space o aplicación Gradio no expone ningún endpoint compatible de síntesis TTS.");
}

function buildGradioArgs(
  info: GradioEndpointMeta,
  input: {
    text: string;
    refAudioBlob: Blob;
    referenceText: string;
    language: string;
    modelFamily: string;
  }
): Record<string, unknown> | unknown[] {
  const params = info.parameters || [];
  let assignedGenText = false;
  let assignedRefAudio = false;
  let assignedRefText = false;

  const values = params.map((param) => {
    const key = `${param.parameter_name || ""} ${param.label || ""}`.toLowerCase();
    const comp = (param.component || "").toLowerCase();
    const desc = `${param.description || ""} ${param.python_type?.description || ""}`;

    // 1. Audio / Reference File input
    if (
      !assignedRefAudio &&
      (comp.includes("audio") ||
        comp.includes("file") ||
        /audio_prompt|ref_audio|speaker_wav|reference_audio|prompt_audio|voice_sample/.test(key))
    ) {
      assignedRefAudio = true;
      return handle_file(input.refAudioBlob);
    }

    // 2. Reference text transcript (F5-TTS)
    if (
      !assignedRefText &&
      /ref_text|reference_text|prompt_text|transcript/.test(key)
    ) {
      assignedRefText = true;
      return input.referenceText || "";
    }

    // 3. Language selector
    if (/language_id|language|lang_code|\blang\b/.test(key)) {
      return mapLanguageForGradio(input.language, desc);
    }

    // 4. Target text to synthesize
    if (
      !assignedGenText &&
      (/gen_text|text_input|tts_text|input_text|\btext\b|prompt_text|texto|guion/.test(key) ||
        comp.includes("textbox"))
    ) {
      assignedGenText = true;
      return input.text;
    }

    // 5. Fallback default or null for optional sliders/checkboxes
    if (param.parameter_has_default) {
      return param.parameter_default;
    }
    if (param.type === "boolean") return false;
    if (param.type === "number") return 0;
    return null;
  });

  // If a space has only textbox inputs and we didn't match genText by name, assign first string slot
  if (!assignedGenText) {
    const textIdx = params.findIndex(
      (p) => (p.component || "").toLowerCase().includes("textbox") || p.type === "string"
    );
    if (textIdx >= 0) {
      values[textIdx] = input.text;
    }
  }

  const allNamed = params.every((p) => typeof p.parameter_name === "string" && p.parameter_name.length > 0);
  if (allNamed) {
    const payloadObj: Record<string, unknown> = {};
    params.forEach((p, idx) => {
      if (p.parameter_name) {
        payloadObj[p.parameter_name] = values[idx];
      }
    });
    return payloadObj;
  }

  return values;
}

async function extractAudioBufferFromGradioOutput(
  data: unknown,
  authToken?: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const queue: unknown[] = Array.isArray(data) ? [...data] : [data];
  let foundUrl = "";
  let foundDataUri = "";

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) continue;
    if (typeof item === "string") {
      if (item.startsWith("data:audio/")) {
        foundDataUri = item;
        break;
      }
      if (item.startsWith("https://")) {
        foundUrl = item;
        break;
      }
      continue;
    }
    if (Array.isArray(item)) {
      queue.push(...item);
      continue;
    }
    if (typeof item === "object") {
      const rec = item as Record<string, unknown>;
      if (typeof rec.url === "string" && rec.url.startsWith("https://")) {
        foundUrl = rec.url;
        break;
      }
      if (typeof rec.data === "string" && rec.data.startsWith("data:audio/")) {
        foundDataUri = rec.data;
        break;
      }
    }
  }

  if (foundDataUri) {
    const match = foundDataUri.match(/^data:(audio\/[^;]+);base64,(.+)$/);
    if (match) {
      const buf = Buffer.from(match[2], "base64");
      return { buffer: buf, mimeType: detectAudioMimeFromBuffer(buf, match[1]) };
    }
  }

  if (!foundUrl) {
    throw new Error("El modelo Open-Source no devolvió ningún archivo de audio válido.");
  }

  const headers: Record<string, string> = {};
  let parsedFoundUrl: URL | null = null;
  try {
    parsedFoundUrl = new URL(foundUrl);
  } catch {
    parsedFoundUrl = null;
  }
  const isHfSignedFile = Boolean(
    parsedFoundUrl &&
      (parsedFoundUrl.hostname.endsWith(".hf.space") || parsedFoundUrl.searchParams.has("__sign"))
  );
  if (authToken && !isHfSignedFile) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const audioResp = await safeFetchPublic(foundUrl, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(45_000),
  });

  if (!audioResp.ok) {
    throw new Error(`No se pudo descargar el audio generado (HTTP ${audioResp.status}).`);
  }

  const arrayBuf = await audioResp.arrayBuffer();
  if (arrayBuf.byteLength > 25 * 1024 * 1024) {
    throw new Error("El audio devuelto por el servidor externo supera el límite de 25 MB.");
  }

  const buf = Buffer.from(arrayBuf);
  if (buf.length < 256) {
    throw new Error("El archivo de audio devuelto está vacío o corrupto.");
  }

  const mimeType = detectAudioMimeFromBuffer(buf, audioResp.headers.get("content-type"));
  return { buffer: buf, mimeType };
}

function estimateAudioDuration(buf: Buffer, mimeType: string): number {
  if (mimeType === "audio/wav" && buf.length > 44) {
    const byteRate = buf.readUInt32LE(28) || 48000;
    const dataSize = Math.max(0, buf.length - 44);
    return Number((dataSize / byteRate).toFixed(2));
  }
  return Math.max(1, Number((buf.length / 16000).toFixed(2)));
}

async function synthesizeWithGradio(opts: {
  target: string;
  hfToken?: string;
  bearerToken?: string;
  text: string;
  referenceAudioBase64: string;
  referenceText: string;
  language: string;
  modelFamily: string;
}): Promise<{
  audioBase64: string;
  mimeType: string;
  durationSeconds: number;
  endpointUsed: string;
}> {
  const clientOpts: {
    token?: `hf_${string}`;
    headers?: Record<string, string>;
  } = {};

  if (opts.hfToken && opts.hfToken.startsWith("hf_")) {
    clientOpts.token = opts.hfToken as `hf_${string}`;
  }
  if (opts.bearerToken) {
    clientOpts.headers = { Authorization: `Bearer ${opts.bearerToken}` };
  }

  const client = await Client.connect(opts.target, clientOpts);
  const apiInfo = (await client.view_api()) as {
    named_endpoints?: Record<string, GradioEndpointMeta>;
    unnamed_endpoints?: Record<string, GradioEndpointMeta>;
  };

  const selected = pickBestGradioTtsEndpoint(apiInfo);
  const wavBuf = Buffer.from(opts.referenceAudioBase64, "base64");
  const refAudioBlob = new Blob([wavBuf], { type: "audio/wav" });

  const args = buildGradioArgs(selected.info, {
    text: opts.text,
    refAudioBlob,
    referenceText: opts.referenceText,
    language: opts.language,
    modelFamily: opts.modelFamily,
  });

  const result = await client.predict(selected.endpoint, args);
  const { buffer, mimeType } = await extractAudioBufferFromGradioOutput(
    result.data,
    opts.bearerToken
  );

  return {
    audioBase64: buffer.toString("base64"),
    mimeType,
    durationSeconds: estimateAudioDuration(buffer, mimeType),
    endpointUsed: String(selected.endpoint),
  };
}

async function synthesizeWithRestEndpoint(opts: {
  endpointUrl: string;
  bearerToken?: string;
  text: string;
  referenceAudioBase64: string;
  referenceText: string;
  language: string;
  style: string;
  modelFamily: string;
}): Promise<{
  audioBase64: string;
  mimeType: string;
  durationSeconds: number;
}> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "audio/*, application/json",
  };
  if (opts.bearerToken) {
    headers["Authorization"] = `Bearer ${opts.bearerToken}`;
  }

  const resp = await safeFetchPublic(opts.endpointUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      text: opts.text,
      referenceAudioBase64: opts.referenceAudioBase64,
      referenceAudioMimeType: "audio/wav",
      referenceText: opts.referenceText,
      language: opts.language,
      style: opts.style,
      modelFamily: opts.modelFamily,
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(
      `El endpoint Open-Source respondió HTTP ${resp.status}${errText ? `: ${errText.slice(0, 140)}` : "."}`
    );
  }

  const contentType = (resp.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    const json = (await resp.json()) as {
      audioBase64?: string;
      audio_base64?: string;
      audio?: string;
      mimeType?: string;
      mime_type?: string;
      error?: string;
    };
    if (json.error) {
      throw new Error(String(json.error).slice(0, 220));
    }
    const rawB64 = json.audioBase64 || json.audio_base64 || json.audio || "";
    const cleanedB64 = rawB64.replace(/^data:audio\/[^;]+;base64,/, "").trim();
    if (!cleanedB64) {
      throw new Error("El endpoint JSON no devolvió audioBase64 válido.");
    }
    const buf = Buffer.from(cleanedB64, "base64");
    const mimeType = detectAudioMimeFromBuffer(buf, json.mimeType || json.mime_type);
    return {
      audioBase64: buf.toString("base64"),
      mimeType,
      durationSeconds: estimateAudioDuration(buf, mimeType),
    };
  }

  const arrayBuf = await resp.arrayBuffer();
  if (arrayBuf.byteLength > 25 * 1024 * 1024) {
    throw new Error("El audio devuelto supera el límite de 25 MB.");
  }
  const buf = Buffer.from(arrayBuf);
  if (buf.length < 256) {
    throw new Error("El endpoint no devolvió datos de audio válidos.");
  }
  const mimeType = detectAudioMimeFromBuffer(buf, contentType);
  return {
    audioBase64: buf.toString("base64"),
    mimeType,
    durationSeconds: estimateAudioDuration(buf, mimeType),
  };
}

function extractOpenSourceErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || "";
  }
  if (error && typeof error === "object") {
    const rec = error as Record<string, unknown>;
    const parts = [rec.message, rec.title, rec.original_msg, rec.detail, rec.error]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    if (parts.length > 0) {
      return parts.join(" — ");
    }
  }
  return String(error || "");
}

function parseOpenSourceError(error: unknown): { status: number; message: string } {
  const msg = extractOpenSourceErrorMessage(error);
  console.error("[Resonancia Open-Source TTS Error]", msg.slice(0, 260));

  if (msg.startsWith("HF_TOKEN_INVALID_FORMAT:") || msg.startsWith("HF_TOKEN_REJECTED:")) {
    return {
      status: 400,
      message: msg.replace(/^HF_TOKEN_(?:INVALID_FORMAT|REJECTED):\s*/, ""),
    };
  }

  // ZeroGPU quota errors often mention "Authenticate with a Hugging Face token" -> match BEFORE token/auth checks!
  if (/ZeroGPU|runs limit|GPU task aborted|quota.*exceeded|exceeded.*quota/i.test(msg)) {
    return {
      status: 429,
      message:
        "Se agotó la cuota temporal de ZeroGPU en Hugging Face. Ingresa tu HF Token (hf_...) en «Configurar», prueba otro Space (ej. Chatterbox V3) o usa Google Colab gratuito.",
    };
  }

  // @gradio/client returns 401/404 both for non-existent spaces (like SWivid/F5-TTS) and private spaces
  if (/could not be accessed \(received a (401|404)/i.test(msg)) {
    return {
      status: 400,
      message:
        "No se pudo acceder a ese Space en Hugging Face (no existe, cambió de nombre o es privado). Selecciona 'ResembleAI/Chatterbox-Multilingual-TTS' o verifica tu HF Token.",
    };
  }

  if (/401|403|unauthorized|gated|private|invalid credentials|not authorized/i.test(msg)) {
    return {
      status: 400,
      message:
        "El servidor o Space rechazó el acceso (401/403). Si el recurso es privado, verifica tu HF Token de tipo Read (hf_...) o el Token Bearer configurado.",
    };
  }

  if (/sleeping|building|paused|not found|404|503|app config/i.test(msg)) {
    return {
      status: 400,
      message:
        "El Space o servidor externo está dormido, en construcción o saturado (503). Ábrelo una vez en Hugging Face para despertarlo o prueba con otro preset.",
    };
  }

  if (/aborted|timeout|ETIMEDOUT/i.test(msg)) {
    return {
      status: 504,
      message:
        "El servidor Open-Source tardó demasiado en responder (cola saturada o arranque en frío). Inténtalo nuevamente en unos segundos.",
    };
  }

  return {
    status: 400,
    message: msg.slice(0, 260) || "No se pudo completar la síntesis con el motor Open-Source.",
  };
}

async function startServer() {
  const app = express();
  app.disable("x-powered-by");

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
    next();
  });

  // Voice replication uploads 24kHz WAV payloads (sample + consent) up to 8MB; keep 2MB everywhere else
  app.post(
    "/api/voices/replicate",
    requireVerifiedAuth,
    userRateLimiter,
    express.json({ limit: "8mb" }),
    async (req: AuthenticatedRequest, res) => {
      try {
        const {
          displayName = "Mi voz",
          sourceAudioBase64,
          consentAudioBase64,
          languageCode = "es-ES",
          storeInGeminiProject = true,
        } = req.body as {
          displayName?: string;
          sourceAudioBase64?: string;
          consentAudioBase64?: string;
          languageCode?: string;
          storeInGeminiProject?: boolean;
        };

        const safeName =
          (typeof displayName === "string" ? displayName : "")
            .trim()
            .replace(/[\r\n\t]/g, " ")
            .slice(0, 60) || "Mi voz personalizada";

        const safeLang = languageCode === "en-US" ? "en-US" : "es-ES";

        if (
          typeof sourceAudioBase64 !== "string" ||
          !isValidWavBase64(sourceAudioBase64, 24_000, 4_500_000)
        ) {
          res.status(400).json({
            error:
              "La muestra de voz debe ser un audio WAV válido de al menos 1 segundo (máximo ~60 s).",
          });
          return;
        }

        if (
          typeof consentAudioBase64 !== "string" ||
          !isValidWavBase64(consentAudioBase64, 16_000, 2_500_000)
        ) {
          res.status(400).json({
            error:
              "El audio de consentimiento debe ser una grabación WAV válida de al menos 1 segundo.",
          });
          return;
        }

        const apiKey = resolveUserGeminiKey(req);
        const ai = getAiClient(apiKey, "v1beta");

        const created = await ai.voices.create({
          api_version: "v1beta",
          store: Boolean(storeInGeminiProject),
          voice: {
            type: "replicated",
            display_name: safeName,
            language_code: safeLang,
            model: "gemini-3.8-flash-tts",
            replicated: {
              source_audio: {
                mime_type: "audio/wav",
                data: sourceAudioBase64,
              },
              consent_audio: {
                mime_type: "audio/wav",
                data: consentAudioBase64,
              },
            },
          },
        });

        const voiceToken = created.id || created.key || "";
        if (!voiceToken) {
          res.status(502).json({
            error: "Google Gemini no devolvió un identificador de voz válido.",
          });
          return;
        }

        res.json({
          voiceToken,
          storageMode: created.id ? "project" : "local_key",
          displayName: created.display_name || safeName,
          expireTime: created.expire_time || null,
          languageCode: created.language_code || safeLang,
        });
      } catch (error) {
        const errObj = error as { status?: number; message?: string };
        const rawMessage = errObj?.message || "";
        const status = typeof errObj?.status === "number" ? errObj.status : 500;
        console.error(`[Resonancia Voice Replication Error] status=${status}`);

        if (
          rawMessage === "MISSING_USER_API_KEY" ||
          rawMessage === "INVALID_USER_API_KEY_FORMAT"
        ) {
          const parsed = parseErrorResponse(error);
          res.status(parsed.status).json({ error: parsed.message });
          return;
        }

        if (
          status === 403 ||
          rawMessage.includes("PERMISSION_DENIED") ||
          /tier|billing|allowlist|entitlement|not enabled/i.test(rawMessage)
        ) {
          res.status(400).json({
            error:
              "Tu clave API de Gemini no tiene habilitada la replicación de voz (Google exige Nivel de Pago Tier 1+ con facturación activa en Google AI Studio para clonar voces).",
          });
          return;
        }

        if (
          status === 400 ||
          /consent|speaker|mismatch|watermark|synthid|verification|INVALID_ARGUMENT/i.test(
            rawMessage
          )
        ) {
          res.status(400).json({
            error:
              "Google no pudo verificar la grabación de consentimiento o la muestra vocal. Asegúrate de leer la frase de consentimiento exacta con tu misma voz, en un entorno sin ruido (puedes probar también el consentimiento en inglés si falla en tu región).",
          });
          return;
        }

        const parsed = parseErrorResponse(error);
        res.status(parsed.status).json({ error: parsed.message });
      }
    }
  );

  app.post(
    "/api/opensource/test",
    requireVerifiedAuth,
    userRateLimiter,
    express.json({ limit: "256kb" }),
    async (req: AuthenticatedRequest, res) => {
      try {
        const {
          engine = "opensource-hf",
          hfSpaceId = "",
          endpointUrl = "",
          endpointProtocol = "auto",
        } = req.body as {
          engine?: "opensource-hf" | "opensource-endpoint";
          hfSpaceId?: string;
          endpointUrl?: string;
          endpointProtocol?: "auto" | "gradio" | "rest";
        };

        const hfToken = sanitizeOptionalToken(req.header("x-hf-token"));
        const bearerToken = sanitizeOptionalToken(req.header("x-opensource-token"));

        if (engine === "opensource-hf") {
          const hfUsername = await verifyOptionalHfToken(hfToken);
          const spaceId = parseHfSpaceId(hfSpaceId);
          const client = await Client.connect(
            spaceId,
            hfToken ? { token: hfToken as `hf_${string}` } : undefined
          );
          const apiInfo = (await client.view_api()) as {
            named_endpoints?: Record<string, GradioEndpointMeta>;
            unnamed_endpoints?: Record<string, GradioEndpointMeta>;
          };
          const selected = pickBestGradioTtsEndpoint(apiInfo);
          res.json({
            connected: true,
            protocol: "gradio",
            target: spaceId,
            endpointDetected: String(selected.endpoint),
            message: hfUsername
              ? `Conectado a ${spaceId} con token HF (@${hfUsername}) · ruta ${selected.endpoint}.`
              : `Conectado a ${spaceId} (acceso público) · ruta ${selected.endpoint}.`,
          });
          return;
        }

        const hfPageMatch = endpointUrl
          .trim()
          .match(/^https?:\/\/huggingface\.co\/spaces\/([^/?#]+\/[^/?#]+)/i);
        if (hfPageMatch) {
          const spaceId = parseHfSpaceId(hfPageMatch[1]);
          const client = await Client.connect(
            spaceId,
            hfToken && hfToken.startsWith("hf_")
              ? { token: hfToken as `hf_${string}` }
              : undefined
          );
          const apiInfo = (await client.view_api()) as {
            named_endpoints?: Record<string, GradioEndpointMeta>;
            unnamed_endpoints?: Record<string, GradioEndpointMeta>;
          };
          const selected = pickBestGradioTtsEndpoint(apiInfo);
          res.json({
            connected: true,
            protocol: "gradio",
            target: spaceId,
            endpointDetected: String(selected.endpoint),
            message: `Conectado al Space ${spaceId} (ruta ${selected.endpoint}).`,
          });
          return;
        }

        const safeUrl = await assertSafePublicUrl(endpointUrl);
        const urlStr = safeUrl.toString().replace(/\/+$/, "");
        const isKnownGradioHost =
          safeUrl.hostname.toLowerCase().endsWith(".gradio.live") ||
          safeUrl.hostname.toLowerCase().endsWith(".hf.space");

        if (endpointProtocol !== "rest") {
          try {
            const client = await Client.connect(
              urlStr,
              bearerToken ? { headers: { Authorization: `Bearer ${bearerToken}` } } : undefined
            );
            const apiInfo = (await client.view_api()) as {
              named_endpoints?: Record<string, GradioEndpointMeta>;
              unnamed_endpoints?: Record<string, GradioEndpointMeta>;
            };
            const selected = pickBestGradioTtsEndpoint(apiInfo);
            res.json({
              connected: true,
              protocol: "gradio",
              target: urlStr,
              endpointDetected: String(selected.endpoint),
              message: `Endpoint Gradio activo (ruta ${selected.endpoint}).`,
            });
            return;
          } catch (gradioErr) {
            if (endpointProtocol === "gradio" || isKnownGradioHost) {
              throw gradioErr;
            }
          }
        }

        const probeResp = await safeFetchPublic(urlStr, {
          method: "OPTIONS",
          headers: bearerToken ? { Authorization: `Bearer ${bearerToken}` } : undefined,
          signal: AbortSignal.timeout(10_000),
        }).catch(() => null);

        if (!probeResp) {
          throw new Error("No se pudo establecer conexión HTTPS con el endpoint indicado.");
        }

        res.json({
          connected: true,
          protocol: "rest",
          target: urlStr,
          endpointDetected: "POST JSON",
          message: `Endpoint HTTPS accesible (estado ${probeResp.status}). Listo para recibir peticiones POST.`,
        });
      } catch (error) {
        const parsed = parseOpenSourceError(error);
        res.status(parsed.status).json({
          connected: false,
          error: parsed.message,
        });
      }
    }
  );

  // Allow up to 6MB on /api/tts/generate so open-source mode can carry a 24kHz WAV reference sample
  app.use("/api/tts/generate", express.json({ limit: "6mb" }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/voices", requireVerifiedAuth, userRateLimiter, async (req, res) => {
    try {
      const apiKey = resolveUserGeminiKey(req);
      const ai = getAiClient(apiKey, "v1beta");
      const result = await ai.voices.list({
        api_version: "v1beta",
        type: ["replicated"],
      });
      const voices = (result.voices || [])
        .filter((v) => typeof v.id === "string" && v.id.startsWith("voice_"))
        .map((v) => ({
          voiceToken: v.id as string,
          displayName: v.display_name || "Voz personalizada",
          languageCode: v.language_code === "en-US" ? "en-US" : "es-ES",
          expireTime: v.expire_time || undefined,
        }));
      res.json({ voices });
    } catch (error) {
      const parsed = parseErrorResponse(error);
      res.status(parsed.status).json({ voices: [], error: parsed.message });
    }
  });

  app.delete("/api/voices/:voiceId", requireVerifiedAuth, userRateLimiter, async (req, res) => {
    try {
      const voiceId = (req.params.voiceId || "").trim();
      if (!/^voice_[a-zA-Z0-9_\-]+$/.test(voiceId)) {
        res.status(400).json({ error: "Identificador de voz inválido." });
        return;
      }
      const apiKey = resolveUserGeminiKey(req);
      const ai = getAiClient(apiKey, "v1beta");
      await ai.voices.delete(voiceId, { api_version: "v1beta" });
      res.json({ deleted: true });
    } catch (error) {
      const parsed = parseErrorResponse(error);
      res.status(parsed.status).json({ error: parsed.message });
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      requiresUserKey: !(ALLOW_SERVER_FALLBACK_KEY && Boolean(process.env.GEMINI_API_KEY)),
    });
  });

  app.post(
    "/api/keys/validate",
    requireVerifiedAuth,
    userRateLimiter,
    async (req: AuthenticatedRequest, res) => {
      try {
        const apiKey = resolveUserGeminiKey(req);
        const checkResp = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
          {
            method: "GET",
            headers: {
              "x-goog-api-key": apiKey,
            },
          }
        );

        if (!checkResp.ok) {
          const errPayload = (await checkResp.json().catch(() => ({}))) as {
            error?: { status?: string; message?: string };
          };
          const upstreamMsg = errPayload?.error?.message || "";
          const upstreamStatus = errPayload?.error?.status || "";
          const err = new Error(
            `${upstreamStatus} ${upstreamMsg}`.trim() || "API_KEY_INVALID"
          ) as Error & { status?: number };
          err.status = checkResp.status;
          throw err;
        }

        res.json({ valid: true });
      } catch (error) {
        const parsed = parseErrorResponse(error);
        res.status(parsed.status).json({
          valid: false,
          error: parsed.message,
        });
      }
    }
  );

  app.post(
    "/api/tts/generate",
    requireVerifiedAuth,
    userRateLimiter,
    async (req: AuthenticatedRequest, res) => {
      try {
        const {
          mode = "single",
          model = "gemini-3.8-flash-tts",
          text,
          voiceName = "Kore",
          style = "",
          speakers,
          lines,
          referenceAudioBase64,
          referenceText = "",
          openSourceConfig,
        } = req.body as {
          mode?: "single" | "dialogue";
          model?:
            | "gemini-3.8-flash-tts"
            | "gemini-3.8-flash-lite-tts"
            | "opensource-hf"
            | "opensource-endpoint";
          text?: string;
          voiceName?: string;
          style?: string;
          speakers?: Array<{ speaker: string; voiceName: string; style: string }>;
          lines?: Array<{ speaker: string; text: string }>;
          referenceAudioBase64?: string;
          referenceText?: string;
          openSourceConfig?: {
            hfSpaceId?: string;
            hfModelFamily?: string;
            endpointUrl?: string;
            endpointProtocol?: "auto" | "gradio" | "rest";
            endpointModelFamily?: string;
            language?: string;
          };
        };

        if (model === "opensource-hf" || model === "opensource-endpoint") {
          try {
            if (typeof text !== "string" || text.trim().length === 0) {
              res.status(400).json({ error: "Escribe un texto antes de generar el audio." });
              return;
            }
            if (text.length > 3500) {
              res.status(400).json({
                error:
                  "Los motores Open-Source recomiendan guiones de máximo 3,500 caracteres por toma (usa el modo «Por frases» para textos largos).",
              });
              return;
            }
            if (
              typeof referenceAudioBase64 !== "string" ||
              !isValidWavBase64(referenceAudioBase64, 12_000, 4_500_000)
            ) {
              res.status(400).json({
                error:
                  "Para usar el motor Open-Source debes seleccionar o grabar una muestra local de tu voz (WAV válido de al menos 1 s).",
              });
              return;
            }

            const hfToken = sanitizeOptionalToken(req.header("x-hf-token"));
            const bearerToken = sanitizeOptionalToken(req.header("x-opensource-token"));
            const safeLang = (openSourceConfig?.language || "es").slice(0, 10);
            const cleanText = text.replace(/<breath>|<laugh>|<gasp>/gi, "").trim();
            const safeRefText = typeof referenceText === "string" ? referenceText.trim().slice(0, 1200) : "";

            if (model === "opensource-hf") {
              await verifyOptionalHfToken(hfToken);
              const spaceId = parseHfSpaceId(
                openSourceConfig?.hfSpaceId || "ResembleAI/Chatterbox-Multilingual-TTS"
              );
              const result = await synthesizeWithGradio({
                target: spaceId,
                hfToken,
                text: cleanText,
                referenceAudioBase64,
                referenceText: safeRefText,
                language: safeLang,
                modelFamily: openSourceConfig?.hfModelFamily || "auto",
              });

              res.json({
                audioBase64: result.audioBase64,
                mimeType: result.mimeType,
                durationSeconds: result.durationSeconds,
                modelUsed: `hf:${spaceId}`,
              });
              return;
            }

            const rawEndpoint = (openSourceConfig?.endpointUrl || "").trim();
            const hfPageMatch = rawEndpoint.match(
              /^https?:\/\/huggingface\.co\/spaces\/([^/?#]+\/[^/?#]+)/i
            );
            if (hfPageMatch) {
              await verifyOptionalHfToken(hfToken);
              const spaceId = parseHfSpaceId(hfPageMatch[1]);
              const result = await synthesizeWithGradio({
                target: spaceId,
                hfToken,
                text: cleanText,
                referenceAudioBase64,
                referenceText: safeRefText,
                language: safeLang,
                modelFamily: openSourceConfig?.endpointModelFamily || "auto",
              });
              res.json({
                audioBase64: result.audioBase64,
                mimeType: result.mimeType,
                durationSeconds: result.durationSeconds,
                modelUsed: `hf:${spaceId}`,
              });
              return;
            }

            const safeUrl = await assertSafePublicUrl(rawEndpoint);
            const cleanUrl = safeUrl.toString().replace(/\/+$/, "");
            const protocol = openSourceConfig?.endpointProtocol || "auto";
            const modelFamily = openSourceConfig?.endpointModelFamily || "auto";
            const host = safeUrl.hostname.toLowerCase();
            const isKnownGradioHost =
              host.endsWith(".gradio.live") || host.endsWith(".hf.space");

            let useGradio = protocol === "gradio";
            if (protocol === "auto") {
              useGradio =
                isKnownGradioHost || safeUrl.pathname === "/" || safeUrl.pathname === "";
            }

            if (useGradio) {
              try {
                const result = await synthesizeWithGradio({
                  target: cleanUrl,
                  bearerToken,
                  text: cleanText,
                  referenceAudioBase64,
                  referenceText: safeRefText,
                  language: safeLang,
                  modelFamily,
                });
                res.json({
                  audioBase64: result.audioBase64,
                  mimeType: result.mimeType,
                  durationSeconds: result.durationSeconds,
                  modelUsed: `gradio:${safeUrl.hostname}`,
                });
                return;
              } catch (gradioErr) {
                if (protocol === "gradio" || isKnownGradioHost) {
                  throw gradioErr;
                }
                // Fallback to REST POST only when URL isn't explicitly a Gradio host
              }
            }

            const restResult = await synthesizeWithRestEndpoint({
              endpointUrl: cleanUrl,
              bearerToken,
              text: cleanText,
              referenceAudioBase64,
              referenceText: safeRefText,
              language: safeLang,
              style: typeof style === "string" ? style.slice(0, 400) : "",
              modelFamily,
            });
            res.json({
              audioBase64: restResult.audioBase64,
              mimeType: restResult.mimeType,
              durationSeconds: restResult.durationSeconds,
              modelUsed: `rest:${safeUrl.hostname}`,
            });
            return;
          } catch (osError) {
            const parsedOs = parseOpenSourceError(osError);
            res.status(parsedOs.status).json({ error: parsedOs.message });
            return;
          }
        }

        const apiKey = resolveUserGeminiKey(req);
        const ai = getAiClient(apiKey, "v1beta");

        if (mode === "dialogue") {
          if (!Array.isArray(speakers) || speakers.length < 1 || speakers.length > 8) {
            res.status(400).json({
              error: "El modo diálogo admite entre 1 y 8 locutores configurados.",
            });
            return;
          }
          if (!Array.isArray(lines) || lines.length === 0 || lines.length > 40) {
            res.status(400).json({
              error: "El diálogo debe contener entre 1 y 40 intervenciones.",
            });
            return;
          }

          const validLines = lines.filter(
            (l) => typeof l.text === "string" && l.text.trim().length > 0
          );
          if (validLines.length === 0) {
            res.status(400).json({
              error: "Las líneas de diálogo no pueden estar vacías.",
            });
            return;
          }
          if (validLines.some((l) => l.text.length > 2500)) {
            res.status(400).json({
              error: "Cada intervención del diálogo no debe superar los 2,500 caracteres.",
            });
            return;
          }

          const normalizedSpeakers = speakers.map((s) => {
            const rawVoice = typeof s.voiceName === "string" ? s.voiceName.trim() : "";
            const safeSpeakerVoice =
              PREBUILT_VOICES.has(rawVoice) || isCustomVoiceToken(rawVoice) ? rawVoice : "Kore";
            return {
              speaker:
                (typeof s.speaker === "string" ? s.speaker : "").trim().slice(0, 60) || "Locutor",
              voiceName: safeSpeakerVoice,
              style:
                (typeof s.style === "string" ? s.style : "").trim().slice(0, 1200) ||
                "Natural, expressive conversational tone",
            };
          });

          const speakerMap = new Map(normalizedSpeakers.map((s) => [s.speaker, s]));

          const usedSpeakerNames: string[] = [];
          for (const line of validLines) {
            const name = typeof line.speaker === "string" ? line.speaker.trim() : "";
            const spk = speakerMap.get(name) || normalizedSpeakers[0];
            if (!usedSpeakerNames.includes(spk.speaker)) {
              usedSpeakerNames.push(spk.speaker);
            }
          }

          if (usedSpeakerNames.length === 2) {
            const activeTwo = usedSpeakerNames.map(
              (name) => speakerMap.get(name) || normalizedSpeakers[0]
            );

            const parts = validLines.map((line) => {
              const name = typeof line.speaker === "string" ? line.speaker.trim() : "";
              const spk = speakerMap.get(name) || activeTwo[0];
              return {
                text: `${spk.speaker}: ${line.text.trim()}`,
                speechMetadata: {
                  speaker: spk.speaker,
                  style: spk.style,
                },
              };
            });

            const response = await withRetry(() =>
              ai.models.generateContent({
                model: "gemini-3.8-flash-tts",
                contents: [{ role: "user", parts }],
                config: {
                  responseModalities: ["AUDIO"],
                  speechConfig: {
                    multiSpeakerVoiceConfig: {
                      speakerVoiceConfigs: activeTwo.map((s) => ({
                        speaker: s.speaker,
                        voiceConfig: buildVoiceConfig(s.voiceName),
                      })),
                    },
                  },
                },
              })
            );

            const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
            if (!inlineData?.data) {
              res.status(502).json({
                error: "El modelo no devolvió datos de audio. Intenta ajustar el guion.",
              });
              return;
            }

            res.json({
              audioBase64: inlineData.data,
              mimeType: inlineData.mimeType || "audio/wav",
              durationSeconds: calculateWavDurationSeconds(inlineData.data),
              modelUsed: "gemini-3.8-flash-tts",
            });
            return;
          }

          type NormalizedSpeaker = { speaker: string; voiceName: string; style: string };
          type DialogueChunk = {
            speakers: NormalizedSpeaker[];
            lines: Array<{ speaker: string; style: string; text: string }>;
          };

          const chunks: DialogueChunk[] = [];
          let currentChunk: DialogueChunk | null = null;

          for (const line of validLines) {
            const name = typeof line.speaker === "string" ? line.speaker.trim() : "";
            const spk = speakerMap.get(name) || normalizedSpeakers[0];
            const textClean = line.text.trim();

            if (!currentChunk) {
              currentChunk = {
                speakers: [spk],
                lines: [{ speaker: spk.speaker, style: spk.style, text: textClean }],
              };
              continue;
            }

            const hasSpeaker = currentChunk.speakers.some((s) => s.speaker === spk.speaker);
            if (hasSpeaker || currentChunk.speakers.length < 2) {
              if (!hasSpeaker) {
                currentChunk.speakers.push(spk);
              }
              currentChunk.lines.push({ speaker: spk.speaker, style: spk.style, text: textClean });
            } else {
              chunks.push(currentChunk);
              currentChunk = {
                speakers: [spk],
                lines: [{ speaker: spk.speaker, style: spk.style, text: textClean }],
              };
            }
          }
          if (currentChunk) {
            chunks.push(currentChunk);
          }

          const wavBuffers: Buffer[] = [];
          for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
            const chunk = chunks[chunkIdx];
            if (chunkIdx > 0) {
              await new Promise((resolve) => setTimeout(resolve, 350));
            }
            let chunkResp;
            if (chunk.speakers.length === 2) {
              const parts = chunk.lines.map((l) => ({
                text: `${l.speaker}: ${l.text}`,
                speechMetadata: {
                  speaker: l.speaker,
                  style: l.style,
                },
              }));

              chunkResp = await withRetry(() =>
                ai.models.generateContent({
                  model: "gemini-3.8-flash-tts",
                  contents: [{ role: "user", parts }],
                  config: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                      multiSpeakerVoiceConfig: {
                        speakerVoiceConfigs: chunk.speakers.map((s) => ({
                          speaker: s.speaker,
                          voiceConfig: buildVoiceConfig(s.voiceName),
                        })),
                      },
                    },
                  },
                })
              );
            } else {
              const soloSpeaker = chunk.speakers[0];
              const combinedText = chunk.lines
                .map((l) =>
                  l.text.replace(/\|mhm\|/gi, "mhm,").replace(/\|yeah\|/gi, "sí,")
                )
                .join(" ");

              chunkResp = await withRetry(() =>
                ai.models.generateContent({
                  model: "gemini-3.8-flash-tts",
                  contents: [
                    {
                      role: "user",
                      parts: [
                        {
                          text: combinedText,
                          speechMetadata: { style: soloSpeaker.style },
                        },
                      ],
                    },
                  ],
                  config: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                      voiceConfig: buildVoiceConfig(soloSpeaker.voiceName),
                    },
                  },
                })
              );
            }

            const data = chunkResp.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (!data) {
              throw new Error("No se pudo generar uno de los fragmentos del diálogo.");
            }
            wavBuffers.push(Buffer.from(data, "base64"));
          }

          const combinedWav = concatenateWavBuffers(wavBuffers, 160);
          const combinedBase64 = combinedWav.toString("base64");

          res.json({
            audioBase64: combinedBase64,
            mimeType: "audio/wav",
            durationSeconds: calculateWavDurationSeconds(combinedBase64),
            modelUsed: "gemini-3.8-flash-tts",
          });
          return;
        }

        // Single-speaker mode
        if (typeof text !== "string" || text.trim().length === 0) {
          res.status(400).json({
            error: "Escribe un texto antes de generar el audio.",
          });
          return;
        }
        if (text.length > 15000) {
          res.status(400).json({
            error: "El guion supera el límite permitido de 15,000 caracteres.",
          });
          return;
        }
        if (typeof style === "string" && style.length > 1200) {
          res.status(400).json({
            error: "La dirección emocional supera los 1,200 caracteres.",
          });
          return;
        }

        const selectedModel =
          model === "gemini-3.8-flash-lite-tts"
            ? "gemini-3.8-flash-lite-tts"
            : "gemini-3.8-flash-tts";
        const voiceConfigPayload = buildVoiceConfig(voiceName);

        const partPayload: {
          text: string;
          speechMetadata?: { style: string };
        } = {
          text: text.trim(),
        };

        if (typeof style === "string" && style.trim().length > 0) {
          partPayload.speechMetadata = { style: style.trim() };
        }

        const response = await withRetry(() =>
          ai.models.generateContent({
            model: selectedModel,
            contents: [
              {
                role: "user",
                parts: [partPayload],
              },
            ],
            config: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: voiceConfigPayload,
              },
            },
          })
        );

        const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (!inlineData?.data) {
          res.status(502).json({
            error: "No se pudo extraer la pista de audio generada. Intenta nuevamente.",
          });
          return;
        }

        res.json({
          audioBase64: inlineData.data,
          mimeType: inlineData.mimeType || "audio/wav",
          durationSeconds: calculateWavDurationSeconds(inlineData.data),
          modelUsed: selectedModel,
        });
      } catch (error) {
        const parsed = parseErrorResponse(error);
        res.status(parsed.status).json({
          error: parsed.message,
          ...(parsed.retryAfterSeconds ? { retryAfterSeconds: parsed.retryAfterSeconds } : {}),
        });
      }
    }
  );

  app.post(
    "/api/tts/enhance",
    requireVerifiedAuth,
    userRateLimiter,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { text, emotionLabel, emotionIntent } = req.body as {
          text?: string;
          emotionLabel?: string;
          emotionIntent?: string;
        };

        if (typeof text !== "string" || text.trim().length === 0) {
          res.status(400).json({ error: "Escribe primero el texto base para añadir matices." });
          return;
        }
        if (text.length > 15000) {
          res.status(400).json({ error: "El guion supera el límite de 15,000 caracteres." });
          return;
        }

        const safeEmotionLabel =
          typeof emotionLabel === "string" ? emotionLabel.slice(0, 120) : "Natural y cercana";
        const safeEmotionIntent =
          typeof emotionIntent === "string"
            ? emotionIntent.slice(0, 200)
            : "expresiva, humana y orgánica";

        const apiKey = resolveUserGeminiKey(req);
        const ai = getAiClient(apiKey);
        const response = await withRetry(() =>
          ai.models.generateContent({
            model: "gemini-4-hydrogen",
            contents: [
              `Texto original del usuario:\n"""\n${text.trim()}\n"""\n\nEmoción deseada: ${safeEmotionLabel} (${safeEmotionIntent}).`,
            ],
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              systemInstruction:
                "Eres un director de doblaje y locución en español experto en prosodia y expresividad humana. " +
                "Tu tarea es enriquecer levemente el texto del usuario para que suene profundamente natural, humano y emotivo al sintetizarlo con voz de IA, SIN cambiar las palabras ni el significado del mensaje. " +
                "Puedes ajustar signos de puntuación (comas, puntos suspensivos '...') para crear pausas respiratorias naturales, e insertar con mucha moderación (máximo 1 a 3 por texto) marcadores vocales soportados exactamente así: <breath> (toma de aire suave o suspiro previo a una frase emotiva), <laugh> (risa breve y cálida si el contexto es alegre o cómplice), <gasp> (inhalación de asombro o impacto si el contexto es dramático). " +
                "Además, redacta una dirección vocal breve y precisa en 'suggestedStyle' (máximo 18 palabras, describiendo tono, cercanía al micrófono, ritmo, sonrisa o quiebre emocional) y una nota breve de máximo 15 palabras en 'notes' explicando qué ajuste hiciste.",
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  enhancedText: {
                    type: Type.STRING,
                    description:
                      "Texto original enriquecido con pausas naturales y marcadores vocales sutiles.",
                  },
                  suggestedStyle: {
                    type: Type.STRING,
                    description: "Dirección de estilo vocal clara para speechMetadata.style.",
                  },
                  notes: {
                    type: Type.STRING,
                    description: "Explicación breve en español de los matices aplicados.",
                  },
                },
                required: ["enhancedText", "suggestedStyle", "notes"],
              },
            },
          })
        );

        const raw = (response.text ?? "{}").trim();
        const parsed = JSON.parse(raw) as {
          enhancedText?: string;
          suggestedStyle?: string;
          notes?: string;
        };

        res.json({
          enhancedText: parsed.enhancedText || text.trim(),
          suggestedStyle: parsed.suggestedStyle || "",
          notes: parsed.notes || "Matices prosódicos aplicados.",
        });
      } catch (error) {
        const parsed = parseErrorResponse(error);
        res.status(parsed.status).json({ error: parsed.message });
      }
    }
  );

  app.post(
    "/api/tts/split-phrases",
    requireVerifiedAuth,
    userRateLimiter,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { text } = req.body as { text?: string };
        if (typeof text !== "string" || text.trim().length === 0) {
          res.status(400).json({ error: "Escribe o pega un texto para detectar las frases." });
          return;
        }
        if (text.length > 15000) {
          res.status(400).json({ error: "El texto supera el límite de 15,000 caracteres." });
          return;
        }

        const apiKey = resolveUserGeminiKey(req);
        const ai = getAiClient(apiKey);
        const response = await withRetry(() =>
          ai.models.generateContent({
            model: "gemini-4-hydrogen",
            contents: [
              `Divide el siguiente texto en frases habladas naturales para generar un clip de audio independiente por cada frase:\n"""\n${text.trim()}\n"""`,
            ],
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              systemInstruction:
                "Eres un editor de guiones de locución en español. Tu tarea es segmentar el texto del usuario en frases individuales listas para grabarse como clips de audio separados. " +
                "Respeta fielmente las palabras originales del usuario y conserva cualquier etiqueta expresiva existente (<breath>, <laugh>, <gasp>). " +
                "Si el texto ya viene numerado (1., 2), etc.), elimina el prefijo numérico de cada frase. " +
                "Cada frase debe tener sentido completo al escucharse por separado y tener una longitud natural para locución (1 a 2 oraciones cortas como máximo).",
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  phrases: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        text: {
                          type: Type.STRING,
                          description: "Texto exacto de la frase para sintetizar.",
                        },
                      },
                      required: ["text"],
                    },
                  },
                },
                required: ["phrases"],
              },
            },
          })
        );

        const raw = (response.text ?? "{}").trim();
        const parsed = JSON.parse(raw) as { phrases?: Array<{ text?: string }> };
        const cleaned = (parsed.phrases || [])
          .map((p) => (p.text || "").trim())
          .filter((t) => t.length > 0);

        if (cleaned.length === 0) {
          res.status(422).json({
            error: "No se pudieron detectar frases válidas en el texto proporcionado.",
          });
          return;
        }

        res.json({ phrases: cleaned });
      } catch (error) {
        const parsed = parseErrorResponse(error);
        res.status(parsed.status).json({ error: parsed.message });
      }
    }
  );

  app.all("/api/*", (_req, res) => {
    res.status(404).json({ error: "Ruta de API no encontrada." });
  });

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api/")) {
      const status =
        typeof (err as { status?: number })?.status === "number"
          ? (err as { status: number }).status
          : 400;
      res.status(status).json({
        error: "Solicitud inválida al servidor. Verifica los datos enviados.",
      });
      return;
    }
    next(err);
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Resonancia server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
