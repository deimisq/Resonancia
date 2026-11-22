import { Client, handle_file } from "@gradio/client";
import { assertSafePublicUrl, safeFetchPublic } from "./netSafety.ts";

export function parseHfSpaceId(raw: string): string {
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

export function sanitizeOptionalToken(raw: string | undefined): string {
  if (!raw) return "";
  const cleaned = raw.trim().replace(/[\r\n\t\u200B-\u200D\uFEFF]/g, "");
  if (cleaned.length > 512) return "";
  return cleaned;
}

export async function verifyOptionalHfToken(hfToken: string): Promise<string | null> {
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

export function detectAudioMimeFromBuffer(buf: Buffer, headerMime?: string | null): string {
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

export function mapLanguageForGradio(
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

export interface GradioParamMeta {
  label?: string;
  parameter_name?: string;
  parameter_default?: unknown;
  parameter_has_default?: boolean;
  type?: string;
  description?: string;
  component?: string;
  python_type?: { type?: string; description?: string };
}

export interface GradioEndpointMeta {
  parameters?: GradioParamMeta[];
  returns?: GradioParamMeta[];
}

export function pickBestGradioTtsEndpoint(apiInfo: {
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

export function buildGradioArgs(
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

export async function extractAudioBufferFromGradioOutput(
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

export function estimateAudioDuration(buf: Buffer, mimeType: string): number {
  if (mimeType === "audio/wav" && buf.length > 44) {
    const byteRate = buf.readUInt32LE(28) || 48000;
    const dataSize = Math.max(0, buf.length - 44);
    return Number((dataSize / byteRate).toFixed(2));
  }
  return Math.max(1, Number((buf.length / 16000).toFixed(2)));
}

export async function synthesizeWithGradio(opts: {
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

export async function synthesizeWithRestEndpoint(opts: {
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

export function extractOpenSourceErrorMessage(error: unknown): string {
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

export function parseOpenSourceError(error: unknown): { status: number; message: string } {
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
