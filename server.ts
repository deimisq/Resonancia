import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { App as FirebaseAdminApp, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { Client, handle_file } from "@gradio/client";
import { assertSafePublicUrl, installOutboundGuard, safeFetchPublic } from "./server/netSafety.ts";
import {
  GradioEndpointMeta,
  parseHfSpaceId,
  parseOpenSourceError,
  pickBestGradioTtsEndpoint,
  sanitizeOptionalToken,
  synthesizeWithGradio,
  synthesizeWithRestEndpoint,
  verifyOptionalHfToken,
} from "./server/openSource.ts";
import {
  calculateWavDurationSeconds,
  concatenateWavBuffers,
  ensureWav,
  isValidWavBase64,
} from "./server/wav.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Override via env if Google renames/retires a model.
const TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts";
const TTS_LITE_MODEL = process.env.GEMINI_TTS_LITE_MODEL || "gemini-3.8-flash-lite-tts";
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-4-hydrogen";

const PORT = Number(process.env.PORT) || 3000;
// Behind a reverse proxy / tunnel set HOST=127.0.0.1 so only it can reach the app.
const HOST = process.env.HOST || "0.0.0.0";
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

// Returns false (without recording) if `cost` more requests would exceed the window.
function consumeRateLimit(uid: string, cost = 1): boolean {
  const now = Date.now();
  const recent = (userRequestTimestamps.get(uid) || []).filter(
    (ts) => ts > now - RATE_LIMIT_WINDOW_MS
  );
  if (recent.length + cost > RATE_LIMIT_MAX_REQUESTS) {
    userRequestTimestamps.set(uid, recent);
    return false;
  }
  for (let i = 0; i < cost; i++) recent.push(now);
  userRequestTimestamps.set(uid, recent);
  return true;
}

// Drop idle users so the map cannot grow without bound.
setInterval(() => {
  const windowStart = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [uid, ts] of userRequestTimestamps) {
    if (ts.length === 0 || ts[ts.length - 1] <= windowStart) userRequestTimestamps.delete(uid);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

function userRateLimiter(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const uid = req.authUser?.uid;
  if (!uid) {
    res.status(401).json({ error: "Autenticación requerida." });
    return;
  }
  if (!consumeRateLimit(uid)) {
    res.status(429).json({
      error: "Has enviado demasiadas solicitudes en un minuto. Espera unos segundos.",
      retryAfterSeconds: 15,
    });
    return;
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

async function startServer() {
  const app = express();
  app.disable("x-powered-by");

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    // Report-Only until verified in a browser (Firebase popup login loads apis.google.com).
    // Once the console shows no violations, rename to "Content-Security-Policy" to enforce it.
    // Goal: limit what an XSS could exfiltrate (the BYOK key lives in sessionStorage).
    res.setHeader(
      "Content-Security-Policy-Report-Only",
      process.env.NODE_ENV === "production"
        ? "default-src 'self'; script-src 'self' https://apis.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' blob: data:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; frame-src https://*.firebaseapp.com https://accounts.google.com; frame-ancestors 'self'; base-uri 'self'; object-src 'none'"
        : "frame-ancestors 'self'"
    );
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
            model: TTS_MODEL,
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
    // 6MB so open-source mode can carry a 24kHz WAV reference sample; parsed only after auth
    express.json({ limit: "6mb" }),
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
                model: TTS_MODEL,
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

            const wav2 = ensureWav(inlineData.data, inlineData.mimeType);
            res.json({
              audioBase64: wav2.base64,
              mimeType: wav2.mimeType,
              durationSeconds: calculateWavDurationSeconds(wav2.base64),
              modelUsed: TTS_MODEL,
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

          // Each extra chunk is another Gemini call: charge it against the rate limit up front.
          if (!consumeRateLimit(req.authUser!.uid, chunks.length - 1)) {
            res.status(429).json({
              error: "Este diálogo requiere demasiadas solicitudes para el límite por minuto. Espera unos segundos o divídelo.",
              retryAfterSeconds: 15,
            });
            return;
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
                  model: TTS_MODEL,
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
                  model: TTS_MODEL,
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

            const chunkInline = chunkResp.candidates?.[0]?.content?.parts?.[0]?.inlineData;
            const data = chunkInline?.data
              ? ensureWav(chunkInline.data, chunkInline.mimeType).base64
              : undefined;
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
            modelUsed: TTS_MODEL,
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
          model === "gemini-3.8-flash-lite-tts" ? TTS_LITE_MODEL : TTS_MODEL;
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

        const wav1 = ensureWav(inlineData.data, inlineData.mimeType);
        res.json({
          audioBase64: wav1.base64,
          mimeType: wav1.mimeType,
          durationSeconds: calculateWavDurationSeconds(wav1.base64),
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
    express.json({ limit: "256kb" }),
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
            model: TEXT_MODEL,
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
    express.json({ limit: "256kb" }),
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
            model: TEXT_MODEL,
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
      const e = err as { type?: string; message?: string };
      console.error(`[Resonancia middleware error] ${req.method} ${req.path} type=${e?.type} msg=${String(e?.message).slice(0, 200)}`);
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

  app.listen(PORT, HOST, () => {
    console.log(`Resonancia server listening on http://${HOST}:${PORT}`);
  });
}

installOutboundGuard();
startServer();
