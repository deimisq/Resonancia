import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  User,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import defaultFirebaseConfig from "../../firebase-applet-config.json";
import {
  AudioTake,
  EMOTION_PRESETS,
  IntensityLevel,
  PaceLevel,
  TtsEngine,
  VOICE_PROFILES,
} from "../types/voice";

const firebaseConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || defaultFirebaseConfig.projectId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || defaultFirebaseConfig.appId,
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || defaultFirebaseConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || defaultFirebaseConfig.authDomain,
  firestoreDatabaseId:
    import.meta.env.VITE_FIREBASE_DATABASE_ID || defaultFirebaseConfig.firestoreDatabaseId,
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || defaultFirebaseConfig.storageBucket,
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || defaultFirebaseConfig.messagingSenderId,
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: Array<{
      providerId?: string | null;
      email?: string | null;
    }>;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error:", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.error("Please check your Firebase configuration (client is offline).");
    }
  }
}

export async function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export async function signOutUser() {
  return firebaseSignOut(auth);
}

export interface UserStudioSettings {
  preferredVoice: string;
  preferredCustomVoiceId: string;
  preferredEmotionId: string;
  preferredStyle: string;
  preferredIntensity: IntensityLevel;
  preferredPace: PaceLevel;
  preferredEngine: TtsEngine;
  hasConfiguredApiKey: boolean;
}

function clampString(val: string, maxLen: number): string {
  return val.trim().slice(0, maxLen);
}

const VALID_PREBUILT_SET = new Set(VOICE_PROFILES.map((v) => v.id));

export function normalizePreferredVoice(voice: string | undefined): string {
  const trimmed = (voice || "").trim();
  if (
    VALID_PREBUILT_SET.has(trimmed as (typeof VOICE_PROFILES)[number]["id"]) ||
    trimmed === "custom" ||
    /^voice_[a-zA-Z0-9_\-]+$/.test(trimmed)
  ) {
    return trimmed.slice(0, 160);
  }
  return "Kore";
}

export function normalizeCustomVoiceId(id: string | undefined): string {
  const trimmed = (id || "").trim().slice(0, 128);
  return /^[a-zA-Z0-9_\-]*$/.test(trimmed) ? trimmed : "";
}

export function normalizeIntensity(val: unknown): IntensityLevel {
  return val === "subtle" || val === "intense" ? val : "balanced";
}

export function normalizePace(val: unknown): PaceLevel {
  return val === "slow" || val === "dynamic" ? val : "natural";
}

export function normalizeEngine(val: unknown): TtsEngine {
  if (val === "gemini-3.8-flash-lite-tts") return "gemini-3.8-flash-lite-tts";
  if (val === "opensource-hf") return "opensource-hf";
  if (val === "opensource-endpoint") return "opensource-endpoint";
  return "gemini-3.8-flash-tts";
}

export async function ensureUserDocuments(
  user: User,
  hasConfiguredApiKey: boolean
): Promise<UserStudioSettings> {
  if (!user.emailVerified) {
    throw new Error("Tu cuenta de Google debe tener el correo verificado.");
  }

  const userPath = `users/${user.uid}`;
  const privatePath = `users/${user.uid}/private/info`;

  let preferredVoice = "Kore";
  let preferredCustomVoiceId = "";
  let preferredEmotionId = EMOTION_PRESETS[0].id;
  let preferredStyle = EMOTION_PRESETS[0].stylePrompt;
  let preferredIntensity: IntensityLevel = "balanced";
  let preferredPace: PaceLevel = "natural";
  let preferredEngine: TtsEngine = "gemini-3.8-flash-tts";

  try {
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    const safeName = clampString(user.displayName || "Usuario", 120) || "Usuario";
    const safePhoto = user.photoURL ? clampString(user.photoURL, 512) : "";

    if (!snap.exists()) {
      const payload: Record<string, unknown> = {
        uid: user.uid,
        displayName: safeName,
        preferredVoice,
        preferredCustomVoiceId,
        preferredEmotionId,
        preferredStyle,
        preferredIntensity,
        preferredPace,
        preferredEngine,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (safePhoto) {
        payload.photoURL = safePhoto;
      }
      await setDoc(userRef, payload);
    } else {
      const data = snap.data();
      preferredVoice = normalizePreferredVoice(
        typeof data.preferredVoice === "string" ? data.preferredVoice : undefined
      );
      preferredCustomVoiceId = normalizeCustomVoiceId(
        typeof data.preferredCustomVoiceId === "string"
          ? data.preferredCustomVoiceId
          : undefined
      );
      if (typeof data.preferredEmotionId === "string" && data.preferredEmotionId.trim()) {
        preferredEmotionId = clampString(data.preferredEmotionId, 60) || EMOTION_PRESETS[0].id;
      }
      if (typeof data.preferredStyle === "string") {
        preferredStyle = data.preferredStyle.slice(0, 1200);
      }
      preferredIntensity = normalizeIntensity(data.preferredIntensity);
      preferredPace = normalizePace(data.preferredPace);
      preferredEngine = normalizeEngine(data.preferredEngine);

      const updatePayload: Record<string, unknown> = {
        displayName: safeName,
        preferredVoice,
        preferredCustomVoiceId,
        preferredEmotionId,
        preferredStyle,
        preferredIntensity,
        preferredPace,
        preferredEngine,
        updatedAt: serverTimestamp(),
      };
      if (safePhoto) {
        updatePayload.photoURL = safePhoto;
      }
      await updateDoc(userRef, updatePayload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  try {
    const privateRef = doc(db, "users", user.uid, "private", "info");
    const privSnap = await getDoc(privateRef);
    const safeEmail = clampString(user.email || "user@example.com", 254);

    if (!privSnap.exists()) {
      await setDoc(privateRef, {
        uid: user.uid,
        email: safeEmail,
        hasConfiguredApiKey,
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(privateRef, {
        email: safeEmail,
        hasConfiguredApiKey,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, privatePath);
  }

  return {
    preferredVoice,
    preferredCustomVoiceId,
    preferredEmotionId,
    preferredStyle,
    preferredIntensity,
    preferredPace,
    preferredEngine,
    hasConfiguredApiKey,
  };
}

export async function updateUserPreferences(
  userId: string,
  prefs: {
    preferredVoice: string;
    preferredCustomVoiceId?: string;
    preferredEmotionId: string;
    preferredStyle: string;
    preferredIntensity: IntensityLevel;
    preferredPace: PaceLevel;
    preferredEngine: TtsEngine;
  }
): Promise<void> {
  const path = `users/${userId}`;
  try {
    await updateDoc(doc(db, "users", userId), {
      preferredVoice: normalizePreferredVoice(prefs.preferredVoice),
      preferredCustomVoiceId: normalizeCustomVoiceId(prefs.preferredCustomVoiceId),
      preferredEmotionId: clampString(prefs.preferredEmotionId, 60) || EMOTION_PRESETS[0].id,
      preferredStyle: prefs.preferredStyle.slice(0, 1200),
      preferredIntensity: normalizeIntensity(prefs.preferredIntensity),
      preferredPace: normalizePace(prefs.preferredPace),
      preferredEngine: normalizeEngine(prefs.preferredEngine),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateApiKeyStatusFlag(
  userId: string,
  email: string,
  hasConfiguredApiKey: boolean
): Promise<void> {
  const path = `users/${userId}/private/info`;
  try {
    await updateDoc(doc(db, "users", userId, "private", "info"), {
      email: clampString(email, 254),
      hasConfiguredApiKey,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function saveTakeMetadataToFirestore(
  userId: string,
  take: AudioTake
): Promise<void> {
  const path = `users/${userId}/takes/${take.id}`;
  try {
    await setDoc(doc(db, "users", userId, "takes", take.id), {
      ownerId: userId,
      title: clampString(take.title || "Locución expresiva", 140),
      mode: take.mode,
      voiceSummary: clampString(take.voiceSummary || "Kore", 120),
      emotionLabel: clampString(take.emotionLabel || "Natural", 120),
      styleUsed: clampString(take.styleUsed || "", 1200),
      scriptText: clampString(take.scriptText || " ", 15000),
      durationSeconds: Number.isFinite(take.durationSeconds)
        ? Math.max(0, Math.min(86400, take.durationSeconds))
        : 0,
      modelUsed: clampString(take.modelUsed || "gemini-3.8-flash-tts", 80),
      favorite: Boolean(take.favorite),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function listUserTakesFromFirestore(userId: string): Promise<AudioTake[]> {
  const path = `users/${userId}/takes`;
  try {
    const q = query(
      collection(db, "users", userId, "takes"),
      where("ownerId", "==", userId),
      orderBy("createdAt", "desc")
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      const createdAtMs =
        data.createdAt && typeof data.createdAt.toMillis === "function"
          ? data.createdAt.toMillis()
          : Date.now();
      return {
        id: docSnap.id,
        ownerId: data.ownerId,
        title: data.title || "Locución expresiva",
        mode: data.mode === "dialogue" ? "dialogue" : "single",
        voiceSummary: data.voiceSummary || "Kore",
        emotionLabel: data.emotionLabel || "Natural",
        styleUsed: data.styleUsed || "",
        scriptText: data.scriptText || "",
        audioBase64: "",
        mimeType: "audio/wav",
        durationSeconds: Number(data.durationSeconds) || 0,
        modelUsed: data.modelUsed || "gemini-3.8-flash-tts",
        createdAt: createdAtMs,
        favorite: Boolean(data.favorite),
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function toggleTakeFavoriteInFirestore(
  userId: string,
  takeId: string,
  favorite: boolean
): Promise<void> {
  const path = `users/${userId}/takes/${takeId}`;
  try {
    await updateDoc(doc(db, "users", userId, "takes", takeId), {
      favorite,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteTakeFromFirestore(
  userId: string,
  takeId: string
): Promise<void> {
  const path = `users/${userId}/takes/${takeId}`;
  try {
    await deleteDoc(doc(db, "users", userId, "takes", takeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
