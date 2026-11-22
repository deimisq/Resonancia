import type { User } from "firebase/auth";
import type { AudioTake, OpenSourcePublicConfig } from "../types/voice";

// Settings that follow the user across devices (stored encrypted on the server).
export interface VaultData {
  geminiKey?: string;
  hfToken?: string;
  endpointToken?: string;
  openSourceConfig?: OpenSourcePublicConfig;
}

export type CloudAudio = Pick<AudioTake, "audioBase64" | "mimeType" | "dialogueData">;

async function call(user: User, path: string, method = "GET", body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { "X-Firebase-Auth": await user.getIdToken() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
}

export async function fetchVault(user: User): Promise<VaultData | null> {
  try {
    const resp = await call(user, "/api/vault");
    if (!resp.ok) return null;
    return ((await resp.json()) as { data: VaultData | null }).data;
  } catch {
    return null;
  }
}

// `null` removes the stored copy (user opted out of syncing).
export async function pushVault(user: User, data: VaultData | null): Promise<void> {
  await call(user, "/api/vault", data ? "PUT" : "DELETE", data ? { data } : undefined);
}

export async function uploadTakeAudio(user: User, take: AudioTake): Promise<void> {
  const resp = await call(user, `/api/takes/${encodeURIComponent(take.id)}/audio`, "PUT", {
    audioBase64: take.audioBase64,
    mimeType: take.mimeType,
    dialogueData: take.dialogueData,
  });
  if (!resp.ok) throw new Error(`upload ${take.id}: HTTP ${resp.status}`);
}

export async function downloadTakeAudio(user: User, id: string): Promise<CloudAudio | null> {
  const resp = await call(user, `/api/takes/${encodeURIComponent(id)}/audio`);
  return resp.ok ? ((await resp.json()) as CloudAudio) : null;
}

export async function deleteTakeAudio(user: User, id: string): Promise<void> {
  await call(user, `/api/takes/${encodeURIComponent(id)}/audio`, "DELETE");
}

export async function listCloudAudioIds(user: User): Promise<Set<string>> {
  const resp = await call(user, "/api/takes/audio-ids");
  if (!resp.ok) return new Set();
  return new Set(((await resp.json()) as { ids: string[] }).ids);
}
