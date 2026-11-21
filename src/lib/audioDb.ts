import { AudioTake, CustomVoiceProfile } from "../types/voice";

const DB_NAME = "resonancia_audio_studio";
const DB_VERSION = 3;
const STORE_NAME = "takes";
const CUSTOM_VOICES_STORE = "custom_voices";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("ownerId", "ownerId", { unique: false });
      } else {
        const store = request.transaction?.objectStore(STORE_NAME);
        if (store && !store.indexNames.contains("ownerId")) {
          store.createIndex("ownerId", "ownerId", { unique: false });
        }
      }

      if (!db.objectStoreNames.contains(CUSTOM_VOICES_STORE)) {
        const voiceStore = db.createObjectStore(CUSTOM_VOICES_STORE, { keyPath: "id" });
        voiceStore.createIndex("ownerId", "ownerId", { unique: false });
        voiceStore.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listAudioTakes(ownerId: string): Promise<AudioTake[]> {
  if (!ownerId) return [];
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const items = ((request.result as AudioTake[]) || []).filter(
          (item) => item.ownerId === ownerId
        );
        items.sort((a, b) => b.createdAt - a.createdAt);
        resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

export async function saveAudioTake(take: AudioTake): Promise<void> {
  if (!take.ownerId) {
    throw new Error("No se puede guardar una toma sin propietario autenticado.");
  }
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(take);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function deleteAudioTake(id: string, ownerId: string): Promise<void> {
  if (!ownerId) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result as AudioTake | undefined;
      if (!existing || existing.ownerId !== ownerId) {
        resolve();
        return;
      }
      const delReq = store.delete(id);
      delReq.onsuccess = () => resolve();
      delReq.onerror = () => reject(delReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function listCustomVoices(ownerId: string): Promise<CustomVoiceProfile[]> {
  if (!ownerId) return [];
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(CUSTOM_VOICES_STORE, "readonly");
      const store = tx.objectStore(CUSTOM_VOICES_STORE);
      const request = store.getAll();
      request.onsuccess = () => {
        const items = ((request.result as CustomVoiceProfile[]) || []).filter(
          (item) => item.ownerId === ownerId
        );
        items.sort((a, b) => b.createdAt - a.createdAt);
        resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

export async function saveCustomVoice(voice: CustomVoiceProfile): Promise<void> {
  if (!voice.ownerId) {
    throw new Error("No se puede guardar una voz personalizada sin propietario autenticado.");
  }
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CUSTOM_VOICES_STORE, "readwrite");
    const store = tx.objectStore(CUSTOM_VOICES_STORE);
    const request = store.put(voice);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function deleteCustomVoice(id: string, ownerId: string): Promise<void> {
  if (!ownerId) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CUSTOM_VOICES_STORE, "readwrite");
    const store = tx.objectStore(CUSTOM_VOICES_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result as CustomVoiceProfile | undefined;
      if (!existing || existing.ownerId !== ownerId) {
        resolve();
        return;
      }
      const delReq = store.delete(id);
      delReq.onsuccess = () => resolve();
      delReq.onerror = () => reject(delReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}
