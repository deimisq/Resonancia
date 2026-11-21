import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Cpu,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  User as UserIcon,
  Volume2,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  ActiveTab,
  AudioTake,
  CustomVoiceProfile,
  DEFAULT_OPENSOURCE_CONFIG,
  DialogueLine,
  DialogueSpeaker,
  EMOTION_PRESETS,
  INITIAL_DIALOGUE_LINES,
  INITIAL_DIALOGUE_SPEAKERS,
  IntensityLevel,
  isOpenSourceEngine,
  OpenSourcePublicConfig,
  PaceLevel,
  PhraseItem,
  SAMPLE_SCRIPTS,
  SampleScript,
  TtsEngine,
  VOICE_PROFILES,
  VoiceSelection,
} from "./types/voice";
import {
  base64ToAudioBlob,
  composeStyleDirection,
  estimateSpeechSeconds,
  formatTimecode,
} from "./lib/audioUtils";
import { parseJsonResponse } from "./lib/apiResponse";
import {
  deleteAudioTake,
  deleteCustomVoice,
  listAudioTakes,
  listCustomVoices,
  saveAudioTake,
  saveCustomVoice,
} from "./lib/audioDb";
import {
  auth,
  deleteTakeFromFirestore,
  ensureUserDocuments,
  listUserTakesFromFirestore,
  normalizeEngine,
  normalizeIntensity,
  normalizePace,
  saveTakeMetadataToFirestore,
  signInWithGoogle,
  signOutUser,
  testFirestoreConnection,
  toggleTakeFavoriteInFirestore,
  updateApiKeyStatusFlag,
  updateUserPreferences,
} from "./lib/firebase";
import { WaveformPlayer } from "./components/WaveformPlayer";
import { VoiceInspector } from "./components/VoiceInspector";
import { DialogueEditor } from "./components/DialogueEditor";
import { BatchPhrasesWorkspace } from "./components/BatchPhrasesWorkspace";
import { LibraryView } from "./components/LibraryView";
import { ExpressiveGuide } from "./components/ExpressiveGuide";
import { ApiKeyModal } from "./components/ApiKeyModal";
import { PersonalVoiceRecorderModal } from "./components/PersonalVoiceRecorderModal";
import { OpenSourceConfigModal } from "./components/OpenSourceConfigModal";

const SINGLE_CUES = [
  { token: "<breath>", label: "Respiro" },
  { token: "<laugh>", label: "Risa" },
  { token: "<gasp>", label: "Suspiro" },
  { token: "...", label: "Pausa" },
];

function getSessionKeyStorageId(uid: string): string {
  return `resonancia_byok_${uid}`;
}

function getSessionHfTokenStorageId(uid: string): string {
  return `resonancia_hf_token_${uid}`;
}

function getSessionEndpointTokenStorageId(uid: string): string {
  return `resonancia_os_token_${uid}`;
}

function getLocalPrefsStorageId(uid: string): string {
  return `resonancia_prefs_${uid}`;
}

function getLocalOpenSourceConfigStorageId(uid: string): string {
  return `resonancia_os_cfg_${uid}`;
}

function getLocalDialoguePrefsStorageId(uid: string): string {
  return `resonancia_dialogue_prefs_${uid}`;
}

interface StoredStudioPrefs {
  voice: VoiceSelection;
  customVoiceId?: string;
  emotionId: string;
  customStyle: string;
  intensity: IntensityLevel;
  pace: PaceLevel;
  engine: TtsEngine;
}

interface StoredDialoguePrefs {
  speakers: DialogueSpeaker[];
  intensity: IntensityLevel;
  pace: PaceLevel;
}

function readLocalStudioPrefs(uid: string): StoredStudioPrefs | null {
  try {
    const raw = localStorage.getItem(getLocalPrefsStorageId(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredStudioPrefs>;
    if (typeof parsed.voice !== "string" || !parsed.voice.trim()) return null;
    return {
      voice: parsed.voice.trim(),
      customVoiceId: typeof parsed.customVoiceId === "string" ? parsed.customVoiceId : "",
      emotionId:
        typeof parsed.emotionId === "string" && parsed.emotionId.trim()
          ? parsed.emotionId.trim()
          : EMOTION_PRESETS[0].id,
      customStyle: typeof parsed.customStyle === "string" ? parsed.customStyle : "",
      intensity: normalizeIntensity(parsed.intensity),
      pace: normalizePace(parsed.pace),
      engine: normalizeEngine(parsed.engine),
    };
  } catch {
    return null;
  }
}

export default function App() {
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState<boolean>(false);
  const [requiresUserKey, setRequiresUserKey] = useState<boolean>(true);
  const [userApiKey, setUserApiKey] = useState<string>("");
  const [hfToken, setHfToken] = useState<string>("");
  const [endpointToken, setEndpointToken] = useState<string>("");
  const [openSourceConfig, setOpenSourceConfig] = useState<OpenSourcePublicConfig>(
    DEFAULT_OPENSOURCE_CONFIG
  );
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState<boolean>(false);
  const [isOpenSourceModalOpen, setIsOpenSourceModalOpen] = useState<boolean>(false);
  const [isVoiceRecorderOpen, setIsVoiceRecorderOpen] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>("studio");

  // Single-speaker studio state
  const [takeTitle, setTakeTitle] = useState<string>(SAMPLE_SCRIPTS[0].title);
  const [scriptText, setScriptText] = useState<string>(SAMPLE_SCRIPTS[0].text);
  const [previousScriptBackup, setPreviousScriptBackup] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<VoiceSelection>(SAMPLE_SCRIPTS[0].voice);
  const [selectedEmotionId, setSelectedEmotionId] = useState<string>(
    SAMPLE_SCRIPTS[0].emotionId
  );
  const [customStyle, setCustomStyle] = useState<string>(SAMPLE_SCRIPTS[0].style);
  const [intensity, setIntensity] = useState<IntensityLevel>("balanced");
  const [pace, setPace] = useState<PaceLevel>("natural");
  const [engine, setEngine] = useState<TtsEngine>("gemini-3.8-flash-tts");

  // Personal cloned voices state
  const [customVoices, setCustomVoices] = useState<CustomVoiceProfile[]>([]);

  // Dual-speaker & multi-speaker dialogue state
  const [dialogueSpeakers, setDialogueSpeakers] = useState<DialogueSpeaker[]>(
    INITIAL_DIALOGUE_SPEAKERS
  );
  const [dialogueLines, setDialogueLines] = useState<DialogueLine[]>(INITIAL_DIALOGUE_LINES);
  const [activeSpeakerIndex, setActiveSpeakerIndex] = useState<number>(0);
  const [dialogueIntensity, setDialogueIntensity] = useState<IntensityLevel>("balanced");
  const [dialoguePace, setDialoguePace] = useState<PaceLevel>("natural");

  // Batch phrases state
  const [rawBatchText, setRawBatchText] = useState<string>(
    `1. <breath> Bienvenido, qué alegría tenerte por aquí.\n2. Tómate unos segundos para escuchar cada detalle con calma.\n3. <laugh> ¡Listo! Ya puedes descargar todas las pistas numeradas.`
  );
  const [phrases, setPhrases] = useState<PhraseItem[]>([
    {
      id: "phrase-init-1",
      text: "<breath> Bienvenido, qué alegría tenerte por aquí.",
      status: "pending",
    },
    {
      id: "phrase-init-2",
      text: "Tómate unos segundos para escuchar cada detalle con calma.",
      status: "pending",
    },
    {
      id: "phrase-init-3",
      text: "<laugh> ¡Listo! Ya puedes descargar todas las pistas numeradas.",
      status: "pending",
    },
  ]);
  const [isSplittingAi, setIsSplittingAi] = useState<boolean>(false);
  const [isGeneratingBatch, setIsGeneratingBatch] = useState<boolean>(false);
  const [batchCooldownSeconds, setBatchCooldownSeconds] = useState<number | null>(null);
  const batchCancelRef = useRef<boolean>(false);

  // Synthesis & enhancement states
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isEnhancing, setIsEnhancing] = useState<boolean>(false);
  const [enhanceNote, setEnhanceNote] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRateLimited, setIsRateLimited] = useState<boolean>(false);

  // Audio playback & library
  const [currentTake, setCurrentTake] = useState<AudioTake | null>(null);
  const [libraryTakes, setLibraryTakes] = useState<AudioTake[]>([]);

  // Voice audition cache & player
  const [auditioningVoice, setAuditioningVoice] = useState<VoiceSelection | null>(null);
  const auditionCacheRef = useRef<Record<string, string>>({});
  const auditionAudioRef = useRef<HTMLAudioElement | null>(null);
  const auditionUrlRef = useRef<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const prefsSyncTimeoutRef = useRef<number | null>(null);
  const latestStudioPrefsRef = useRef<StoredStudioPrefs>({
    voice: SAMPLE_SCRIPTS[0].voice,
    customVoiceId: "",
    emotionId: SAMPLE_SCRIPTS[0].emotionId,
    customStyle: SAMPLE_SCRIPTS[0].style,
    intensity: "balanced",
    pace: "natural",
    engine: "gemini-3.8-flash-tts",
  });
  const customVoicesRef = useRef<CustomVoiceProfile[]>([]);

  useEffect(() => {
    customVoicesRef.current = customVoices;
  }, [customVoices]);

  useEffect(() => {
    latestStudioPrefsRef.current = {
      voice: selectedVoice,
      customVoiceId:
        customVoicesRef.current.find((cv) => cv.voiceToken === selectedVoice)?.id || "",
      emotionId: selectedEmotionId,
      customStyle,
      intensity,
      pace,
      engine,
    };
  }, [selectedVoice, selectedEmotionId, customStyle, intensity, pace, engine]);

  const persistStudioPrefs = (
    patch: Partial<StoredStudioPrefs>,
    options: { immediate?: boolean; uidOverride?: string; voicesOverride?: CustomVoiceProfile[] } = {}
  ) => {
    const activeUid = options.uidOverride || user?.uid;
    const voicesList = options.voicesOverride || customVoicesRef.current;

    const merged: StoredStudioPrefs = {
      ...latestStudioPrefsRef.current,
      ...patch,
    };

    const matchedCustom = voicesList.find((cv) => cv.voiceToken === merged.voice);
    merged.customVoiceId = matchedCustom ? matchedCustom.id : "";
    latestStudioPrefsRef.current = merged;

    if (!activeUid) return;

    try {
      localStorage.setItem(getLocalPrefsStorageId(activeUid), JSON.stringify(merged));
    } catch {
      // Ignore quota errors
    }

    const firestoreVoice = matchedCustom
      ? matchedCustom.storageMode === "project" && matchedCustom.voiceToken.startsWith("voice_")
        ? matchedCustom.voiceToken
        : "custom"
      : merged.voice;

    const writeRemote = () => {
      updateUserPreferences(activeUid, {
        preferredVoice: firestoreVoice,
        preferredCustomVoiceId: matchedCustom ? matchedCustom.id : "",
        preferredEmotionId: merged.emotionId,
        preferredStyle: merged.customStyle,
        preferredIntensity: merged.intensity,
        preferredPace: merged.pace,
        preferredEngine: merged.engine,
      }).catch(console.error);
    };

    if (prefsSyncTimeoutRef.current !== null) {
      window.clearTimeout(prefsSyncTimeoutRef.current);
      prefsSyncTimeoutRef.current = null;
    }

    if (options.immediate) {
      writeRemote();
    } else {
      prefsSyncTimeoutRef.current = window.setTimeout(() => {
        prefsSyncTimeoutRef.current = null;
        writeRemote();
      }, 550);
    }
  };

  useEffect(() => {
    if (!user) return;
    try {
      const payload: StoredDialoguePrefs = {
        speakers: dialogueSpeakers,
        intensity: dialogueIntensity,
        pace: dialoguePace,
      };
      localStorage.setItem(getLocalDialoguePrefsStorageId(user.uid), JSON.stringify(payload));
    } catch {
      // Ignore quota errors
    }
  }, [user, dialogueSpeakers, dialogueIntensity, dialoguePace]);

  const syncRemoteProjectVoices = async (activeUser: User, apiKeyToUse: string) => {
    if (!apiKeyToUse.trim()) return;
    try {
      const idToken = await activeUser.getIdToken();
      const resp = await fetch("/api/voices", {
        method: "GET",
        credentials: "same-origin",
        headers: {
          "X-Firebase-Auth": idToken,
          "X-Gemini-Key": apiKeyToUse.trim(),
        },
      });
      if (!resp.ok) return;
      const data = await parseJsonResponse<{
        voices?: Array<{
          voiceToken: string;
          displayName: string;
          languageCode: "es-ES" | "en-US";
          expireTime?: string;
        }>;
      }>(resp);

      if (!Array.isArray(data.voices) || data.voices.length === 0) return;

      const existing = await listCustomVoices(activeUser.uid);
      const existingByToken = new Map(existing.map((v) => [v.voiceToken, v]));
      const nextList = [...existing];
      let changed = false;

      for (const remoteVoice of data.voices) {
        if (!existingByToken.has(remoteVoice.voiceToken)) {
          const imported: CustomVoiceProfile = {
            id: remoteVoice.voiceToken,
            ownerId: activeUser.uid,
            displayName: remoteVoice.displayName,
            voiceToken: remoteVoice.voiceToken,
            storageMode: "project",
            languageCode: remoteVoice.languageCode || "es-ES",
            createdAt: Date.now(),
            expireTime: remoteVoice.expireTime,
          };
          await saveCustomVoice(imported);
          nextList.unshift(imported);
          changed = true;
        }
      }

      if (changed) {
        setCustomVoices(nextList);
      }
    } catch {
      // Non-blocking sync
    }
  };

  useEffect(() => {
    void testFirestoreConnection();

    fetch("/api/health")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { requiresUserKey?: boolean } | null) => {
        if (data && typeof data.requiresUserKey === "boolean") {
          setRequiresUserKey(data.requiresUserKey);
        }
      })
      .catch(() => {
        // Default strictly to requiring user key
      });

    let activeAuthCycle = 0;

    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      const cycleId = ++activeAuthCycle;

      if (!nextUser) {
        batchCancelRef.current = true;
        auditionCacheRef.current = {};
        if (auditionAudioRef.current) {
          auditionAudioRef.current.pause();
        }
        setUser(null);
        setUserApiKey("");
        setHfToken("");
        setEndpointToken("");
        setOpenSourceConfig(DEFAULT_OPENSOURCE_CONFIG);
        setCustomVoices([]);
        setLibraryTakes([]);
        setCurrentTake(null);
        setErrorMessage(null);
        setAuthReady(true);
        return;
      }

      if (!nextUser.emailVerified) {
        await signOutUser().catch(() => {});
        if (cycleId === activeAuthCycle) {
          setAuthError("Tu cuenta de Google debe tener el correo electrónico verificado.");
          setUser(null);
          setAuthReady(true);
        }
        return;
      }

      const savedSessionKey =
        sessionStorage.getItem(getSessionKeyStorageId(nextUser.uid)) || "";
      const savedHfToken =
        sessionStorage.getItem(getSessionHfTokenStorageId(nextUser.uid)) || "";
      const savedEndpointToken =
        sessionStorage.getItem(getSessionEndpointTokenStorageId(nextUser.uid)) || "";
      setUser(nextUser);
      setUserApiKey(savedSessionKey);
      setHfToken(savedHfToken);
      setEndpointToken(savedEndpointToken);
      setAuthError(null);

      try {
        const rawOsCfg = localStorage.getItem(getLocalOpenSourceConfigStorageId(nextUser.uid));
        if (rawOsCfg) {
          const parsedOsCfg = JSON.parse(rawOsCfg) as Partial<OpenSourcePublicConfig>;
          const normalizedSpace =
            parsedOsCfg.hfSpaceId === "SWivid/F5-TTS"
              ? "mrfakename/E2-F5-TTS"
              : parsedOsCfg.hfSpaceId;
          setOpenSourceConfig({
            ...DEFAULT_OPENSOURCE_CONFIG,
            ...parsedOsCfg,
            ...(normalizedSpace ? { hfSpaceId: normalizedSpace } : {}),
          });
        }
      } catch {
        // Ignore parse errors
      }

      // Immediately hydrate from local preferences cache to avoid UI flash
      const localPrefs = readLocalStudioPrefs(nextUser.uid);
      if (localPrefs) {
        setSelectedVoice(localPrefs.voice);
        setSelectedEmotionId(localPrefs.emotionId);
        setCustomStyle(localPrefs.customStyle);
        setIntensity(localPrefs.intensity);
        setPace(localPrefs.pace);
        setEngine(localPrefs.engine);
      }

      try {
        const rawDialogue = localStorage.getItem(getLocalDialoguePrefsStorageId(nextUser.uid));
        if (rawDialogue) {
          const parsedDialogue = JSON.parse(rawDialogue) as Partial<StoredDialoguePrefs>;
          if (Array.isArray(parsedDialogue.speakers) && parsedDialogue.speakers.length >= 2) {
            setDialogueSpeakers(parsedDialogue.speakers.slice(0, 8));
          }
          if (parsedDialogue.intensity) {
            setDialogueIntensity(normalizeIntensity(parsedDialogue.intensity));
          }
          if (parsedDialogue.pace) {
            setDialoguePace(normalizePace(parsedDialogue.pace));
          }
        }
      } catch {
        // Ignore dialogue cache parse errors
      }

      try {
        const [settings, localTakes, remoteTakes, localCustomVoices] = await Promise.all([
          ensureUserDocuments(nextUser, Boolean(savedSessionKey)),
          listAudioTakes(nextUser.uid),
          listUserTakesFromFirestore(nextUser.uid).catch(() => [] as AudioTake[]),
          listCustomVoices(nextUser.uid),
        ]);

        if (cycleId !== activeAuthCycle) return;

        setCustomVoices(localCustomVoices);

        // Resolve persisted studio preferences (local cache + Firestore + custom voices)
        let resolvedVoice: string = settings.preferredVoice;
        if (settings.preferredVoice === "custom" || settings.preferredCustomVoiceId) {
          const foundCustom =
            localCustomVoices.find((cv) => cv.id === settings.preferredCustomVoiceId) ||
            localCustomVoices.find((cv) => cv.voiceToken === localPrefs?.voice);
          resolvedVoice = foundCustom ? foundCustom.voiceToken : "Kore";
        } else if (settings.preferredVoice.startsWith("voice_")) {
          const foundProject = localCustomVoices.find(
            (cv) => cv.voiceToken === settings.preferredVoice
          );
          resolvedVoice = foundProject ? foundProject.voiceToken : settings.preferredVoice;
        } else if (
          localPrefs &&
          localPrefs.voice &&
          localPrefs.voice !== "Kore" &&
          settings.preferredVoice === "Kore" &&
          localCustomVoices.some((cv) => cv.voiceToken === localPrefs.voice)
        ) {
          resolvedVoice = localPrefs.voice;
        }

        const resolvedEmotionId = settings.preferredEmotionId || localPrefs?.emotionId || EMOTION_PRESETS[0].id;
        const resolvedStyle =
          typeof settings.preferredStyle === "string" && settings.preferredStyle.length > 0
            ? settings.preferredStyle
            : localPrefs?.customStyle || EMOTION_PRESETS[0].stylePrompt;
        const resolvedIntensity = settings.preferredIntensity || localPrefs?.intensity || "balanced";
        const resolvedPace = settings.preferredPace || localPrefs?.pace || "natural";
        const resolvedEngine = settings.preferredEngine || localPrefs?.engine || "gemini-3.8-flash-tts";

        setSelectedVoice(resolvedVoice);
        setSelectedEmotionId(resolvedEmotionId);
        setCustomStyle(resolvedStyle);
        setIntensity(resolvedIntensity);
        setPace(resolvedPace);
        setEngine(resolvedEngine);

        latestStudioPrefsRef.current = {
          voice: resolvedVoice,
          customVoiceId:
            localCustomVoices.find((cv) => cv.voiceToken === resolvedVoice)?.id || "",
          emotionId: resolvedEmotionId,
          customStyle: resolvedStyle,
          intensity: resolvedIntensity,
          pace: resolvedPace,
          engine: resolvedEngine,
        };

        try {
          localStorage.setItem(
            getLocalPrefsStorageId(nextUser.uid),
            JSON.stringify(latestStudioPrefsRef.current)
          );
        } catch {
          // Ignore storage quota
        }

        if (savedSessionKey) {
          void syncRemoteProjectVoices(nextUser, savedSessionKey);
        }

        const localMap = new Map(localTakes.map((t) => [t.id, t]));
        const mergedMap = new Map<string, AudioTake>();

        for (const remote of remoteTakes) {
          const localMatch = localMap.get(remote.id);
          mergedMap.set(remote.id, {
            ...remote,
            ownerId: nextUser.uid,
            audioBase64: localMatch?.audioBase64 || "",
            mimeType: localMatch?.mimeType || remote.mimeType || "audio/wav",
            dialogueData: localMatch?.dialogueData,
          });
        }

        for (const local of localTakes) {
          if (!mergedMap.has(local.id)) {
            mergedMap.set(local.id, local);
          }
        }

        const merged = Array.from(mergedMap.values()).sort(
          (a, b) => b.createdAt - a.createdAt
        );
        setLibraryTakes(merged);
        setCurrentTake(merged.find((t) => Boolean(t.audioBase64)) || merged[0] || null);
      } catch (error) {
        if (cycleId !== activeAuthCycle) return;
        console.error("Error loading user workspace:", error);
        const [fallbackLocal, fallbackVoices] = await Promise.all([
          listAudioTakes(nextUser.uid),
          listCustomVoices(nextUser.uid),
        ]);
        setCustomVoices(fallbackVoices);
        setLibraryTakes(fallbackLocal);
        setCurrentTake(fallbackLocal[0] || null);
      } finally {
        if (cycleId === activeAuthCycle) {
          setAuthReady(true);
        }
      }
    });

    return () => {
      unsubscribe();
      if (prefsSyncTimeoutRef.current !== null) {
        window.clearTimeout(prefsSyncTimeoutRef.current);
      }
      if (auditionUrlRef.current) {
        URL.revokeObjectURL(auditionUrlRef.current);
      }
      if (auditionAudioRef.current) {
        auditionAudioRef.current.pause();
      }
    };
  }, []);

  const authorizedFetch = async (
    url: string,
    bodyPayload: unknown,
    options: { skipGeminiKeyCheck?: boolean } = {}
  ): Promise<Response> => {
    if (!user) {
      throw new Error("Inicia sesión con Google para utilizar el estudio.");
    }
    if (!options.skipGeminiKeyCheck && requiresUserKey && !userApiKey.trim()) {
      setIsApiKeyModalOpen(true);
      throw new Error(
        "Configura tu clave API personal de Gemini para generar o procesar guiones."
      );
    }
    const idToken = await user.getIdToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Firebase-Auth": idToken,
    };
    if (userApiKey.trim()) {
      headers["X-Gemini-Key"] = userApiKey.trim();
    }
    if (hfToken.trim()) {
      headers["X-HF-Token"] = hfToken.trim();
    }
    if (endpointToken.trim()) {
      headers["X-OpenSource-Token"] = endpointToken.trim();
    }
    return fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify(bodyPayload),
    });
  };

  const handleGoogleSignIn = async () => {
    if (isSigningIn) return;
    setAuthError(null);
    setIsSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      const code = (error as { code?: string })?.code || "";
      if (code === "auth/popup-closed-by-user") {
        setAuthError("Se cerró la ventana de acceso antes de completar el inicio de sesión.");
      } else {
        setAuthError(
          error instanceof Error
            ? error.message
            : "No se pudo iniciar sesión con Google. Inténtalo nuevamente."
        );
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    if (user) {
      sessionStorage.removeItem(getSessionKeyStorageId(user.uid));
      sessionStorage.removeItem(getSessionHfTokenStorageId(user.uid));
      sessionStorage.removeItem(getSessionEndpointTokenStorageId(user.uid));
    }
    batchCancelRef.current = true;
    auditionCacheRef.current = {};
    if (auditionAudioRef.current) {
      auditionAudioRef.current.pause();
    }
    setUserApiKey("");
    setHfToken("");
    setEndpointToken("");
    setLibraryTakes([]);
    setCurrentTake(null);
    setErrorMessage(null);
    await signOutUser();
  };

  const handleSaveApiKey = (newKey: string) => {
    if (!user) return;
    const cleaned = newKey.trim();
    sessionStorage.setItem(getSessionKeyStorageId(user.uid), cleaned);
    setUserApiKey(cleaned);
    auditionCacheRef.current = {};
    setErrorMessage(null);
    updateApiKeyStatusFlag(user.uid, user.email || "", true).catch(console.error);
    void syncRemoteProjectVoices(user, cleaned);
  };

  const handleClearApiKey = () => {
    if (!user) return;
    sessionStorage.removeItem(getSessionKeyStorageId(user.uid));
    setUserApiKey("");
    auditionCacheRef.current = {};
    updateApiKeyStatusFlag(user.uid, user.email || "", false).catch(console.error);
  };

  const handleSaveOpenSourceConfig = (
    nextConfig: OpenSourcePublicConfig,
    nextHfToken: string,
    nextEndpointToken: string,
    activateEngine?: "opensource-hf" | "opensource-endpoint"
  ) => {
    if (!user) return;
    setOpenSourceConfig(nextConfig);
    try {
      localStorage.setItem(
        getLocalOpenSourceConfigStorageId(user.uid),
        JSON.stringify(nextConfig)
      );
    } catch {
      // Ignore storage quota
    }

    if (nextHfToken) {
      sessionStorage.setItem(getSessionHfTokenStorageId(user.uid), nextHfToken);
    } else {
      sessionStorage.removeItem(getSessionHfTokenStorageId(user.uid));
    }
    setHfToken(nextHfToken);

    if (nextEndpointToken) {
      sessionStorage.setItem(getSessionEndpointTokenStorageId(user.uid), nextEndpointToken);
    } else {
      sessionStorage.removeItem(getSessionEndpointTokenStorageId(user.uid));
    }
    setEndpointToken(nextEndpointToken);

    if (activateEngine) {
      setEngine(activateEngine);
      persistStudioPrefs({ engine: activateEngine }, { immediate: true });
    }
    setErrorMessage(null);
  };

  const handleSelectVoice = (voice: VoiceSelection) => {
    setSelectedVoice(voice);
    persistStudioPrefs({ voice }, { immediate: true });
  };

  const handleSelectEngine = (nextEngine: TtsEngine) => {
    setEngine(nextEngine);
    persistStudioPrefs({ engine: nextEngine }, { immediate: true });
  };

  const handleSelectIntensity = (nextIntensity: IntensityLevel) => {
    setIntensity(nextIntensity);
    persistStudioPrefs({ intensity: nextIntensity }, { immediate: true });
  };

  const handleSelectPace = (nextPace: PaceLevel) => {
    setPace(nextPace);
    persistStudioPrefs({ pace: nextPace }, { immediate: true });
  };

  const handleChangeCustomStyle = (nextStyle: string) => {
    setCustomStyle(nextStyle);
    persistStudioPrefs({ customStyle: nextStyle }, { immediate: false });
  };

  const currentEmotion = useMemo(
    () => EMOTION_PRESETS.find((e) => e.id === selectedEmotionId) || EMOTION_PRESETS[0],
    [selectedEmotionId]
  );

  const scriptMetrics = useMemo(() => {
    const trimmed = scriptText.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    const chars = scriptText.length;
    const estimatedSec = estimateSpeechSeconds(scriptText);
    return { words, chars, estimatedSec };
  }, [scriptText]);

  const handleSelectEmotion = (emotionId: string) => {
    setSelectedEmotionId(emotionId);
    const preset = EMOTION_PRESETS.find((e) => e.id === emotionId);
    const nextStyle = preset ? preset.stylePrompt : customStyle;
    if (preset) {
      setCustomStyle(preset.stylePrompt);
    }
    persistStudioPrefs({ emotionId, customStyle: nextStyle }, { immediate: true });
  };

  const resolveVoiceLabel = (voiceId: string): string => {
    const custom = customVoices.find((cv) => cv.voiceToken === voiceId);
    if (custom) return custom.displayName;
    const prebuilt = VOICE_PROFILES.find((v) => v.id === voiceId);
    if (prebuilt) return prebuilt.name;
    if (
      voiceId.startsWith("voice_") ||
      voiceId.startsWith("voicekey_") ||
      voiceId.startsWith("osvoice_")
    ) {
      return "Voz personalizada";
    }
    return voiceId || "Kore";
  };

  const handleCreatedCustomVoice = async (newVoice: CustomVoiceProfile) => {
    await saveCustomVoice(newVoice);
    const updatedVoices = [
      newVoice,
      ...customVoicesRef.current.filter((v) => v.id !== newVoice.id),
    ];
    setCustomVoices(updatedVoices);
    setSelectedVoice(newVoice.voiceToken);
    persistStudioPrefs(
      { voice: newVoice.voiceToken, customVoiceId: newVoice.id },
      { immediate: true, voicesOverride: updatedVoices }
    );
  };

  const handleDeleteCustomVoice = async (voice: CustomVoiceProfile) => {
    if (!user) return;
    await deleteCustomVoice(voice.id, user.uid);
    const remaining = customVoicesRef.current.filter((v) => v.id !== voice.id);
    setCustomVoices(remaining);

    if (voice.storageMode === "project" && voice.voiceToken.startsWith("voice_") && userApiKey) {
      user
        .getIdToken()
        .then((idToken) =>
          fetch(`/api/voices/${encodeURIComponent(voice.voiceToken)}`, {
            method: "DELETE",
            credentials: "same-origin",
            headers: {
              "X-Firebase-Auth": idToken,
              "X-Gemini-Key": userApiKey.trim(),
            },
          })
        )
        .catch(() => {});
    }

    if (selectedVoice === voice.voiceToken) {
      setSelectedVoice("Kore");
      persistStudioPrefs(
        { voice: "Kore", customVoiceId: "" },
        { immediate: true, voicesOverride: remaining }
      );
    }

    setDialogueSpeakers((prev) =>
      prev.map((spk) =>
        spk.voiceName === voice.voiceToken ? { ...spk, voiceName: "Kore" } : spk
      )
    );
  };

  const handleSelectDialogueEmotion = (emotionId: string) => {
    const preset = EMOTION_PRESETS.find((e) => e.id === emotionId);
    setDialogueSpeakers((prev) =>
      prev.map((spk, idx) =>
        idx === activeSpeakerIndex
          ? {
              ...spk,
              emotionId,
              style: preset ? preset.stylePrompt : spk.style,
            }
          : spk
      )
    );
  };

  const handleInsertCue = (token: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setScriptText((prev) => `${prev} ${token}`.trim());
      return;
    }

    const start = textarea.selectionStart ?? scriptText.length;
    const end = textarea.selectionEnd ?? scriptText.length;
    const before = scriptText.slice(0, start);
    const after = scriptText.slice(end);
    const padLeft = token !== "..." && before.length > 0 && !before.endsWith(" ") ? " " : "";
    const padRight = after.length > 0 && !after.startsWith(" ") ? " " : "";
    const updated = `${before}${padLeft}${token}${padRight}${after}`;

    setScriptText(updated);
    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + padLeft.length + token.length + padRight.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  };

  const handleEnhanceText = async () => {
    if (!scriptText.trim() || isEnhancing) return;
    setErrorMessage(null);
    setEnhanceNote(null);
    setIsEnhancing(true);

    try {
      const response = await authorizedFetch("/api/tts/enhance", {
        text: scriptText,
        emotionLabel: currentEmotion.label,
        emotionIntent: currentEmotion.summary,
      });

      const data = await parseJsonResponse<{
        enhancedText?: string;
        suggestedStyle?: string;
        notes?: string;
        error?: string;
      }>(response);

      if (!response.ok) {
        throw new Error(data.error || "No se pudo enriquecer el texto.");
      }

      setPreviousScriptBackup(scriptText);
      if (data.enhancedText) {
        setScriptText(data.enhancedText);
      }
      if (data.suggestedStyle) {
        setCustomStyle(data.suggestedStyle);
        persistStudioPrefs({ customStyle: data.suggestedStyle }, { immediate: true });
      }
      if (data.notes) {
        setEnhanceNote(data.notes);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Error al sugerir matices expresivos."
      );
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleUndoEnhance = () => {
    if (previousScriptBackup !== null) {
      setScriptText(previousScriptBackup);
      setPreviousScriptBackup(null);
      setEnhanceNote(null);
    }
  };

  const handleApplySample = (sample: SampleScript) => {
    setTakeTitle(sample.title);
    setScriptText(sample.text);
    setSelectedVoice(sample.voice);
    setSelectedEmotionId(sample.emotionId);
    setCustomStyle(sample.style);
    persistStudioPrefs(
      {
        voice: sample.voice,
        emotionId: sample.emotionId,
        customStyle: sample.style,
      },
      { immediate: true }
    );
    setPreviousScriptBackup(null);
    setEnhanceNote(null);
    setErrorMessage(null);
    setActiveTab("studio");
  };

  const handleAuditionVoice = async (voice: VoiceSelection) => {
    if (auditioningVoice !== null) return;
    setErrorMessage(null);

    const prebuiltProfile = VOICE_PROFILES.find((v) => v.id === voice);
    const customProfile = customVoices.find((cv) => cv.voiceToken === voice);
    if (!prebuiltProfile && !customProfile) return;

    const cacheKey = `${voice}-preview`;
    const playBase64 = async (base64: string) => {
      if (!auditionAudioRef.current) {
        auditionAudioRef.current = new Audio();
      }
      if (auditionUrlRef.current) {
        URL.revokeObjectURL(auditionUrlRef.current);
      }
      const blob = base64ToAudioBlob(base64, "audio/wav");
      const url = URL.createObjectURL(blob);
      auditionUrlRef.current = url;
      auditionAudioRef.current.src = url;
      await auditionAudioRef.current.play();
    };

    if (auditionCacheRef.current[cacheKey]) {
      try {
        await playBase64(auditionCacheRef.current[cacheKey]);
        return;
      } catch {
        // Fall through to re-fetch if cached playback fails
      }
    }

    if (customProfile?.sampleAudioBase64 && (isOpenSourceEngine(engine) || (requiresUserKey && !userApiKey.trim()))) {
      await playBase64(customProfile.sampleAudioBase64);
      return;
    }

    setAuditioningVoice(voice);
    try {
      const response = await authorizedFetch("/api/tts/generate", {
        mode: "single",
        model: "gemini-3.8-flash-tts",
        voiceName: voice,
        text: prebuiltProfile
          ? prebuiltProfile.sampleLine
          : "Hola, así suena mi voz personalizada en Resonancia, lista para narrar cualquier guion.",
        style: prebuiltProfile
          ? `Natural, expressive Spanish voice showcasing ${prebuiltProfile.timbre.toLowerCase()}`
          : "Warm, natural Spanish conversational tone preserving the speaker's authentic vocal timbre",
      });

      const data = await parseJsonResponse<{
        audioBase64?: string;
        error?: string;
      }>(response);

      if (!response.ok || !data.audioBase64) {
        throw new Error(data.error || "No se pudo reproducir la muestra de voz.");
      }

      auditionCacheRef.current[cacheKey] = data.audioBase64;
      await playBase64(data.audioBase64);
    } catch (error) {
      if (customProfile?.sampleAudioBase64) {
        await playBase64(customProfile.sampleAudioBase64).catch(() => {});
      }
      setErrorMessage(
        error instanceof Error ? error.message : "Error al probar la voz seleccionada."
      );
    } finally {
      setAuditioningVoice(null);
    }
  };

  const handleGenerate = async () => {
    if (activeTab === "library" || activeTab === "guide") {
      setActiveTab("studio");
      return;
    }

    if (!user) {
      setErrorMessage("Inicia sesión con Google para generar audios.");
      return;
    }

    if (activeTab === "phrases") {
      await handleGenerateBatch();
      return;
    }

    setErrorMessage(null);
    const isDialogue = activeTab === "dialogue";

    if (!isDialogue && !scriptText.trim()) {
      setErrorMessage("Escribe o pega un texto en el editor antes de generar el audio.");
      return;
    }

    if (isDialogue && dialogueLines.every((l) => !l.text.trim())) {
      setErrorMessage("Agrega contenido en al menos una intervención del diálogo.");
      return;
    }

    setIsGenerating(true);

    try {
      let payload: Record<string, unknown>;
      let titleForTake: string;
      let voiceSummary: string;
      let emotionLabel: string;
      let styleUsed: string;
      let scriptSummary: string;

      if (isDialogue) {
        const preparedSpeakers = dialogueSpeakers.map((s) => ({
          speaker: s.speaker.trim() || "Locutor",
          voiceName: s.voiceName,
          style: composeStyleDirection(s.style, dialogueIntensity, dialoguePace),
        }));

        const validLines = dialogueLines
          .filter((l) => l.text.trim().length > 0)
          .map((l) => ({
            speaker: l.speaker.trim(),
            text: l.text.trim(),
          }));

        payload = {
          mode: "dialogue",
          model: "gemini-3.8-flash-tts",
          speakers: preparedSpeakers,
          lines: validLines,
        };

        const activeNames = Array.from(
          new Set(
            validLines.map((l) => {
              const found = preparedSpeakers.find((s) => s.speaker === l.speaker);
              return found ? found.speaker : preparedSpeakers[0].speaker;
            })
          )
        );
        titleForTake =
          activeNames.length <= 2
            ? `Diálogo: ${activeNames.join(" y ")}`
            : `Escena (${activeNames.length} voces): ${activeNames.slice(0, 3).join(", ")}${
                activeNames.length > 3 ? "…" : ""
              }`;

        const uniqueVoices = Array.from(
          new Set(preparedSpeakers.map((s) => resolveVoiceLabel(s.voiceName)))
        );
        voiceSummary = uniqueVoices.join(", ").slice(0, 120);

        const uniqueEmotions = Array.from(
          new Set(
            dialogueSpeakers.map(
              (s) => EMOTION_PRESETS.find((e) => e.id === s.emotionId)?.label || "Natural"
            )
          )
        );
        emotionLabel =
          uniqueEmotions.length <= 2
            ? uniqueEmotions.join(" / ")
            : `${uniqueEmotions[0]} +${uniqueEmotions.length - 1}`;
        styleUsed = preparedSpeakers.map((s) => `${s.speaker}: ${s.style}`).join(" | ");
        scriptSummary = validLines.map((l) => `${l.speaker}: ${l.text}`).join("\n");
      } else {
        // Ensure latest selected studio parameters are immediately persisted on generation
        persistStudioPrefs({}, { immediate: true });

        const usingOpenSource = isOpenSourceEngine(engine);
        const selectedCustom = customVoices.find((cv) => cv.voiceToken === selectedVoice);

        if (usingOpenSource) {
          if (!selectedCustom?.sampleAudioBase64) {
            setIsGenerating(false);
            setIsVoiceRecorderOpen(true);
            setErrorMessage(
              "Para usar el motor Open-Source debes seleccionar o grabar una muestra local de tu voz (6–20 s)."
            );
            return;
          }
          if (engine === "opensource-endpoint" && !openSourceConfig.endpointUrl.trim()) {
            setIsGenerating(false);
            setIsOpenSourceModalOpen(true);
            setErrorMessage(
              "Configura la URL HTTPS de Google Colab o tu servidor Open-Source antes de sintetizar."
            );
            return;
          }
        }

        const composedStyle = composeStyleDirection(
          customStyle || currentEmotion.stylePrompt,
          intensity,
          pace
        );
        payload = usingOpenSource
          ? {
              mode: "single",
              model: engine,
              text: scriptText.trim(),
              voiceName: selectedVoice,
              style: composedStyle,
              referenceAudioBase64: selectedCustom?.sampleAudioBase64,
              referenceText: selectedCustom?.referenceText || "",
              openSourceConfig,
            }
          : {
              mode: "single",
              model: engine,
              text: scriptText.trim(),
              voiceName: selectedVoice,
              style: composedStyle,
            };

        const autoTitle =
          takeTitle.trim() ||
          scriptText
            .replace(/<[^>]+>/g, "")
            .trim()
            .split(/\s+/)
            .slice(0, 6)
            .join(" ");

        titleForTake = autoTitle || "Locución expresiva";
        voiceSummary = resolveVoiceLabel(selectedVoice).slice(0, 120);
        emotionLabel = usingOpenSource ? "Open-Source Zero-Shot" : currentEmotion.label;
        styleUsed = composedStyle;
        scriptSummary = scriptText.trim();
      }

      const response = await authorizedFetch("/api/tts/generate", payload, {
        skipGeminiKeyCheck: !isDialogue && isOpenSourceEngine(engine),
      });

      const data = await parseJsonResponse<{
        audioBase64?: string;
        mimeType?: string;
        durationSeconds?: number;
        modelUsed?: string;
        error?: string;
      }>(response);

      if (!response.ok || !data.audioBase64) {
        if (response.status === 429) {
          setIsRateLimited(true);
        } else {
          setIsRateLimited(false);
        }
        throw new Error(data.error || "No se pudo sintetizar el audio.");
      }

      setIsRateLimited(false);

      const newTake: AudioTake = {
        id: `take-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ownerId: user.uid,
        title: titleForTake,
        mode: isDialogue ? "dialogue" : "single",
        voiceSummary,
        emotionLabel,
        styleUsed,
        scriptText: scriptSummary,
        dialogueData: isDialogue
          ? {
              speakers: dialogueSpeakers,
              lines: dialogueLines,
            }
          : undefined,
        audioBase64: data.audioBase64,
        mimeType: data.mimeType || "audio/wav",
        durationSeconds: data.durationSeconds || 0,
        modelUsed: data.modelUsed || "gemini-3.8-flash-tts",
        createdAt: Date.now(),
        favorite: false,
      };

      await saveAudioTake(newTake);
      saveTakeMetadataToFirestore(user.uid, newTake).catch(console.error);
      setCurrentTake(newTake);
      setLibraryTakes((prev) => [newTake, ...prev]);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Ocurrió un error al generar el audio."
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleToggleFavorite = async (id: string) => {
    if (!user) return;
    const target = libraryTakes.find((t) => t.id === id);
    if (!target) return;
    const updated: AudioTake = { ...target, ownerId: user.uid, favorite: !target.favorite };
    await saveAudioTake(updated);
    toggleTakeFavoriteInFirestore(user.uid, id, updated.favorite).catch(console.error);
    setLibraryTakes((prev) => prev.map((t) => (t.id === id ? updated : t)));
    if (currentTake?.id === id) {
      setCurrentTake(updated);
    }
  };

  const handleDeleteTake = async (id: string) => {
    if (!user) return;
    await deleteAudioTake(id, user.uid);
    deleteTakeFromFirestore(user.uid, id).catch(console.error);
    setLibraryTakes((prev) => prev.filter((t) => t.id !== id));
    if (currentTake?.id === id) {
      setCurrentTake(null);
    }
  };

  const handleLoadInStudio = (take: AudioTake) => {
    setCurrentTake(take);
    setErrorMessage(null);
    if (take.mode === "dialogue" && take.dialogueData) {
      setDialogueSpeakers(take.dialogueData.speakers);
      setDialogueLines(take.dialogueData.lines);
      setActiveTab("dialogue");
    } else {
      setTakeTitle(take.title);
      setScriptText(take.scriptText);
      const matchedPrebuilt = VOICE_PROFILES.find((v) => v.id === take.voiceSummary);
      const matchedCustom = customVoices.find((cv) => cv.displayName === take.voiceSummary);
      const nextVoice = matchedPrebuilt?.id || matchedCustom?.voiceToken || selectedVoice;
      setSelectedVoice(nextVoice);
      setCustomStyle(take.styleUsed);
      persistStudioPrefs(
        { voice: nextVoice, customStyle: take.styleUsed },
        { immediate: true }
      );
      setActiveTab("studio");
    }
  };

  const handleRenameDialogueSpeaker = (index: number, newName: string) => {
    const oldName = dialogueSpeakers[index]?.speaker;
    setDialogueSpeakers((prev) =>
      prev.map((spk, idx) => (idx === index ? { ...spk, speaker: newName } : spk))
    );
    if (oldName && newName.trim()) {
      setDialogueLines((prev) =>
        prev.map((line) =>
          line.speaker === oldName ? { ...line, speaker: newName } : line
        )
      );
    }
  };

  const handleAddDialogueSpeaker = () => {
    if (dialogueSpeakers.length >= 8) return;
    const defaultNames = ["Sofía", "Carlos", "Elena", "Diego", "Valeria", "Andrés"];
    const existingNames = new Set(dialogueSpeakers.map((s) => s.speaker.trim()));
    const nextName =
      defaultNames.find((name) => !existingNames.has(name)) ||
      `Persona ${dialogueSpeakers.length + 1}`;
    const usedVoices = new Set(dialogueSpeakers.map((s) => s.voiceName));
    const nextVoice =
      VOICE_PROFILES.find((v) => !usedVoices.has(v.id))?.id ||
      VOICE_PROFILES[dialogueSpeakers.length % VOICE_PROFILES.length].id;
    const nextEmotion =
      EMOTION_PRESETS[dialogueSpeakers.length % EMOTION_PRESETS.length];

    const newSpeaker: DialogueSpeaker = {
      speaker: nextName,
      voiceName: nextVoice,
      emotionId: nextEmotion.id,
      style: nextEmotion.stylePrompt,
    };

    setDialogueSpeakers((prev) => [...prev, newSpeaker]);
    setActiveSpeakerIndex(dialogueSpeakers.length);
  };

  const handleRemoveDialogueSpeaker = (index: number) => {
    if (dialogueSpeakers.length <= 2) return;
    const removedName = dialogueSpeakers[index]?.speaker;
    const remaining = dialogueSpeakers.filter((_, idx) => idx !== index);
    const fallbackName = remaining[0]?.speaker || "Lucía";

    setDialogueSpeakers(remaining);
    if (removedName) {
      setDialogueLines((prev) =>
        prev.map((line) =>
          line.speaker === removedName ? { ...line, speaker: fallbackName } : line
        )
      );
    }
    setActiveSpeakerIndex((prev) => {
      if (prev === index) return 0;
      if (prev > index) return prev - 1;
      return Math.min(prev, remaining.length - 1);
    });
  };

  const activeDialogueSpeaker = dialogueSpeakers[activeSpeakerIndex] || dialogueSpeakers[0];

  const handleParseNumberedPhrases = () => {
    const trimmed = rawBatchText.trim();
    if (!trimmed) return;
    setErrorMessage(null);

    const lines = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    let extracted: string[] = [];

    if (lines.length > 1) {
      extracted = lines
        .map((line) => line.replace(/^\s*(?:\d{1,3}\s*[.):\-–]|[-•*])\s+/, "").trim())
        .filter(Boolean);
    } else {
      // Check inline numbering like "1. Hola. 2. Qué tal."
      const inlineMatches = trimmed.split(/(?:^|\s)\d{1,3}[.)]\s+/).map((s) => s.trim()).filter(Boolean);
      if (inlineMatches.length > 1) {
        extracted = inlineMatches;
      } else {
        // Fallback sentence split
        extracted = trimmed
          .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¡¿<])/)
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }

    if (extracted.length === 0) {
      extracted = [trimmed];
    }

    setPhrases(
      extracted.map((text, idx) => ({
        id: `phrase-${Date.now()}-${idx}`,
        text,
        status: "pending",
      }))
    );
  };

  const handleSplitPhrasesWithAi = async () => {
    if (!rawBatchText.trim() || isSplittingAi) return;
    setErrorMessage(null);
    setIsSplittingAi(true);

    try {
      const response = await authorizedFetch("/api/tts/split-phrases", {
        text: rawBatchText,
      });

      const data = await parseJsonResponse<{ phrases?: string[]; error?: string }>(response);
      if (!response.ok || !Array.isArray(data.phrases)) {
        throw new Error(data.error || "No se pudieron detectar las frases.");
      }

      setPhrases(
        data.phrases.map((text, idx) => ({
          id: `phrase-${Date.now()}-${idx}`,
          text,
          status: "pending",
        }))
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Error al detectar frases con IA."
      );
    } finally {
      setIsSplittingAi(false);
    }
  };

  const synthesizeSinglePhrase = async (phrase: PhraseItem): Promise<PhraseItem> => {
    const usingOpenSource = isOpenSourceEngine(engine);
    const selectedCustom = customVoices.find((cv) => cv.voiceToken === selectedVoice);

    if (usingOpenSource && !selectedCustom?.sampleAudioBase64) {
      setIsVoiceRecorderOpen(true);
      throw new Error(
        "Graba o selecciona primero una muestra local de tu voz para generar con Open-Source."
      );
    }
    if (engine === "opensource-endpoint" && !openSourceConfig.endpointUrl.trim()) {
      setIsOpenSourceModalOpen(true);
      throw new Error("Configura la URL HTTPS de Google Colab o endpoint Open-Source.");
    }

    const composedStyle = composeStyleDirection(
      customStyle || currentEmotion.stylePrompt,
      intensity,
      pace
    );

    const response = await authorizedFetch(
      "/api/tts/generate",
      usingOpenSource
        ? {
            mode: "single",
            model: engine,
            text: phrase.text.trim(),
            voiceName: selectedVoice,
            style: composedStyle,
            referenceAudioBase64: selectedCustom?.sampleAudioBase64,
            referenceText: selectedCustom?.referenceText || "",
            openSourceConfig,
          }
        : {
            mode: "single",
            model: engine,
            text: phrase.text.trim(),
            voiceName: selectedVoice,
            style: composedStyle,
          },
      { skipGeminiKeyCheck: usingOpenSource }
    );

    const data = await parseJsonResponse<{
      audioBase64?: string;
      mimeType?: string;
      durationSeconds?: number;
      error?: string;
      retryAfterSeconds?: number;
    }>(response);

    if (!response.ok || !data.audioBase64) {
      const err = new Error(data.error || "No se pudo sintetizar esta frase.") as Error & {
        status?: number;
        retryAfterSeconds?: number;
      };
      err.status = response.status;
      err.retryAfterSeconds = data.retryAfterSeconds;
      throw err;
    }

    return {
      ...phrase,
      status: "ready",
      audioBase64: data.audioBase64,
      mimeType: data.mimeType || "audio/wav",
      durationSeconds: data.durationSeconds || 0,
      errorMessage: undefined,
    };
  };

  const handleRegenerateSinglePhrase = async (id: string) => {
    const target = phrases.find((p) => p.id === id);
    if (!target || !target.text.trim() || isGeneratingBatch) return;
    setErrorMessage(null);
    setIsRateLimited(false);

    setPhrases((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, status: "generating", errorMessage: undefined } : p
      )
    );

    try {
      const result = await synthesizeSinglePhrase(target);
      setPhrases((prev) => prev.map((p) => (p.id === id ? result : p)));
    } catch (error) {
      const errObj = error as Error & { status?: number };
      if (errObj.status === 429) {
        setIsRateLimited(true);
        setErrorMessage(errObj.message);
      }
      const msg = error instanceof Error ? error.message : "Error al sintetizar";
      setPhrases((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, status: "error", errorMessage: msg } : p
        )
      );
    }
  };

  const handleGenerateBatch = async () => {
    const valid = phrases.filter((p) => p.text.trim().length > 0);
    if (valid.length === 0 || isGeneratingBatch) {
      setErrorMessage("Agrega al menos una frase antes de generar los audios.");
      return;
    }

    setErrorMessage(null);
    setIsRateLimited(false);
    setBatchCooldownSeconds(null);
    batchCancelRef.current = false;
    setIsGeneratingBatch(true);

    // If all valid phrases are already ready, regenerate all; otherwise generate pending/error ones
    const hasPendingOrError = valid.some((p) => p.status !== "ready");
    const targetIds = new Set(
      valid
        .filter((p) => (hasPendingOrError ? p.status !== "ready" : true))
        .map((p) => p.id)
    );

    try {
      let processedCount = 0;
      for (const item of valid) {
        if (!targetIds.has(item.id)) continue;
        if (batchCancelRef.current) break;

        if (processedCount > 0) {
          await new Promise((resolve) => setTimeout(resolve, 600));
        }
        if (batchCancelRef.current) break;

        let attempts = 0;
        const maxCooldownRetries = 2;

        while (attempts <= maxCooldownRetries && !batchCancelRef.current) {
          setPhrases((prev) =>
            prev.map((p) =>
              p.id === item.id
                ? { ...p, status: "generating", errorMessage: undefined }
                : p
            )
          );

          try {
            const result = await synthesizeSinglePhrase(item);
            setPhrases((prev) => prev.map((p) => (p.id === item.id ? result : p)));
            break;
          } catch (error) {
            const errObj = error as Error & {
              status?: number;
              retryAfterSeconds?: number;
            };
            if (errObj.status === 429 && attempts < maxCooldownRetries) {
              attempts++;
              const waitSecs = errObj.retryAfterSeconds || 20;
              for (let s = waitSecs; s > 0; s--) {
                if (batchCancelRef.current) break;
                setBatchCooldownSeconds(s);
                await new Promise((resolve) => setTimeout(resolve, 1000));
              }
              setBatchCooldownSeconds(null);
              if (batchCancelRef.current) {
                setPhrases((prev) =>
                  prev.map((p) =>
                    p.id === item.id ? { ...p, status: "pending" } : p
                  )
                );
                break;
              }
              continue;
            }

            if (errObj.status === 429) {
              setIsRateLimited(true);
            }
            const msg = error instanceof Error ? error.message : "Error al sintetizar";
            setPhrases((prev) =>
              prev.map((p) =>
                p.id === item.id ? { ...p, status: "error", errorMessage: msg } : p
              )
            );
            break;
          }
        }

        processedCount++;
      }
    } finally {
      setBatchCooldownSeconds(null);
      setIsGeneratingBatch(false);
    }
  };

  const handleStopBatch = () => {
    batchCancelRef.current = true;
    setBatchCooldownSeconds(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Brand Wordmark */}
          <a
            href="#estudio"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab("studio");
            }}
            className="text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-display"
          >
            Resonancia
          </a>

          {/* Zone 2: Clean single-line navigation links */}
          <nav
            aria-label="Navegación principal"
            className="flex items-center gap-5 sm:gap-7 overflow-x-auto"
          >
            {(
              [
                { id: "studio", label: "Estudio" },
                { id: "phrases", label: "Por frases" },
                { id: "dialogue", label: "Diálogo" },
                { id: "library", label: "Biblioteca" },
                { id: "guide", label: "Guía expresiva" },
              ] as const
            ).map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? "border-blue-600 text-slate-900"
                      : "border-transparent text-slate-500 hover:text-slate-900"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="shrink-0">
            {!user ? (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isSigningIn || !authReady}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isSigningIn ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogIn className="w-4 h-4" />
                )}
                <span>{isSigningIn ? "Conectando..." : "Entrar con Google"}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating || isGeneratingBatch}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isGenerating || isGeneratingBatch ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Sintetizando...</span>
                  </>
                ) : activeTab === "library" || activeTab === "guide" ? (
                  <>
                    <Volume2 className="w-4 h-4" />
                    <span>Ir al estudio</span>
                  </>
                ) : activeTab === "phrases" ? (
                  <>
                    <Volume2 className="w-4 h-4" />
                    <span>Generar audios</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="w-4 h-4" />
                    <span>Generar audio</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Signed-in Workspace Session Strip */}
      {user && (
        <div className="bg-white border-b border-slate-200">
          <div className="max-w-[1360px] mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2.5 text-slate-600 min-w-0">
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-800 truncate">
                <UserIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{user.displayName || user.email}</span>
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              {isOpenSourceEngine(engine) ? (
                <span className="inline-flex items-center gap-1 font-medium text-emerald-700 whitespace-nowrap">
                  <Cpu className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {engine === "opensource-hf"
                      ? `Open-Source: ${openSourceConfig.hfSpaceId}`
                      : openSourceConfig.endpointUrl
                        ? "Open-Source: Colab / HTTPS activo"
                        : "Falta configurar URL Open-Source"}
                  </span>
                </span>
              ) : userApiKey ? (
                <span className="inline-flex items-center gap-1 font-medium text-emerald-700 whitespace-nowrap">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>Clave Gemini activa (BYOK)</span>
                </span>
              ) : !requiresUserKey ? (
                <span className="inline-flex items-center gap-1 font-medium text-slate-600 whitespace-nowrap">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>Modo servidor habilitado (puedes añadir tu propia clave)</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-medium text-amber-700 whitespace-nowrap">
                  <KeyRound className="w-3.5 h-3.5 shrink-0" />
                  <span>Falta configurar tu clave API personal</span>
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsOpenSourceModalOpen(true)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                  isOpenSourceEngine(engine)
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>Motor Open-Source</span>
              </button>

              <button
                type="button"
                onClick={() => setIsApiKeyModalOpen(true)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                  userApiKey
                    ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>{userApiKey ? "Gestionar clave Gemini" : "Configurar clave Gemini"}</span>
              </button>

              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Cerrar sesión</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-[1360px] w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {(errorMessage || authError) && (
          <div
            role="alert"
            className="mb-6 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-4 text-sm text-red-800"
          >
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
              <span>{errorMessage || authError}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {isRateLimited &&
                engine === "gemini-3.8-flash-tts" &&
                (activeTab === "studio" || activeTab === "phrases") && (
                  <button
                    type="button"
                    onClick={() => {
                      handleSelectEngine("gemini-3.8-flash-lite-tts");
                      setErrorMessage(null);
                      setIsRateLimited(false);
                    }}
                    className="px-3 py-1 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Cambiar a Rápido (Lite)
                  </button>
                )}
              <button
                type="button"
                onClick={() => {
                  setErrorMessage(null);
                  setAuthError(null);
                  setIsRateLimited(false);
                }}
                className="text-xs font-semibold text-red-700 hover:text-red-900 whitespace-nowrap cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}

        {!authReady ? (
          <div className="max-w-lg mx-auto my-16 bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
            <Loader2 className="w-6 h-6 text-blue-600 animate-spin mx-auto" />
            <h2 className="text-base font-semibold text-slate-900">
              Verificando sesión segura...
            </h2>
            <p className="text-xs text-slate-500">
              Cargando tu espacio de trabajo y preferencias de voz.
            </p>
          </div>
        ) : !user && activeTab !== "guide" ? (
          <section className="max-w-2xl mx-auto my-8 sm:my-12 bg-white border border-slate-200 rounded-xl p-8 sm:p-10 space-y-7">
            <div className="space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                Estudio multiusuario con aislamiento privado
              </p>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900 text-balance">
                Síntesis de voz emotiva con tu propia cuenta y clave API
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed">
                Resonancia te permite dirigir locuciones humanas, diálogos de hasta 8 personajes y lotes de frases descargables en ZIP. Cada persona accede con Google y utiliza su propia clave de Gemini.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100 text-xs text-slate-600 leading-relaxed">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-1.5">
                <h2 className="font-semibold text-slate-900 text-sm">
                  1. Biblioteca aislada por usuario
                </h2>
                <p>
                  Tus guiones y tomas favoritas se vinculan exclusivamente a tu cuenta verificada de Google mediante reglas estrictas de Firestore e IndexedDB aislado.
                </p>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-1.5">
                <h2 className="font-semibold text-slate-900 text-sm">
                  2. Clave API personal (BYOK)
                </h2>
                <p>
                  Tu clave de Google AI Studio permanece solo en la sesión activa del navegador y nunca se almacena en la base de datos ni se comparte con terceros.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isSigningIn}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors cursor-pointer"
              >
                {isSigningIn ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogIn className="w-4 h-4" />
                )}
                <span>{isSigningIn ? "Iniciando sesión..." : "Continuar con Google"}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("guide")}
                className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 rounded-lg transition-colors cursor-pointer"
              >
                Explorar guía expresiva
              </button>
            </div>
          </section>
        ) : (
          <>
        {user && (activeTab === "studio" || activeTab === "phrases" || activeTab === "dialogue") && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left / Center Workspace */}
            <div className="lg:col-span-7 xl:col-span-8 space-y-6">
              {/* Intro Headline + Scene Quick Presets */}
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                  <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900 text-balance">
                    {activeTab === "dialogue"
                      ? "Diálogos con múltiples voces"
                      : activeTab === "phrases"
                        ? "Lote de audios por frases"
                        : "Voz con alma y matices reales"}
                  </h1>
                  <p className="text-sm text-slate-600 mt-1">
                    {activeTab === "dialogue"
                      ? "Dirige conversaciones entre dos o más personas con respiraciones, risas y matices naturales."
                      : activeTab === "phrases"
                        ? "Separa frases numeradas o deja que la IA divida tu texto para generar y descargar un ZIP numerado."
                        : "Escribe tu guion, elige el registro emocional y ajusta la respiración para lograr una locución humana."}
                  </p>
                </div>

                {activeTab === "studio" && (
                  <div className="flex items-center gap-2 shrink-0">
                    <label htmlFor="sample-select" className="sr-only">
                      Cargar escena de ejemplo
                    </label>
                    <select
                      id="sample-select"
                      value=""
                      onChange={(e) => {
                        const found = SAMPLE_SCRIPTS.find((s) => s.id === e.target.value);
                        if (found) handleApplySample(found);
                      }}
                      className="text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 cursor-pointer"
                    >
                      <option value="" disabled>
                        Cargar guion de ejemplo...
                      </option>
                      {SAMPLE_SCRIPTS.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title} ({s.voice})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {activeTab === "studio" ? (
                <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  {/* Title & AI Prosody Toolbar */}
                  <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                    <input
                      type="text"
                      value={takeTitle}
                      onChange={(e) => setTakeTitle(e.target.value)}
                      placeholder="Título de la locución..."
                      aria-label="Título de la locución"
                      className="text-sm font-semibold text-slate-900 bg-transparent focus:outline-none min-w-[200px] flex-1"
                    />

                    <div className="flex items-center gap-2 shrink-0">
                      {previousScriptBackup !== null && (
                        <button
                          type="button"
                          onClick={handleUndoEnhance}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Deshacer</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={handleEnhanceText}
                        disabled={isEnhancing || !scriptText.trim()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                      >
                        {isEnhancing ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                        <span>{isEnhancing ? "Ajustando..." : "Añadir matices"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Vocal Burst Quick Insert Bar */}
                  <div className="px-5 py-2.5 bg-slate-50/70 border-b border-slate-100 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-slate-500 mr-1">
                      Matices expresivos:
                    </span>
                    {SINGLE_CUES.map((cue) => (
                      <button
                        key={cue.token}
                        type="button"
                        onClick={() => handleInsertCue(cue.token)}
                        className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 hover:text-slate-900 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        + {cue.label}
                      </button>
                    ))}
                  </div>

                  {/* Script Textarea */}
                  <div className="p-5">
                    <textarea
                      ref={textareaRef}
                      rows={8}
                      value={scriptText}
                      onChange={(e) => setScriptText(e.target.value)}
                      placeholder="Escribe aquí lo que quieres escuchar... Usa <breath> para respirar antes de una frase, <laugh> para una risa breve o '...' para pausas sentidas."
                      className="w-full text-[15px] leading-[1.7] text-slate-900 placeholder:text-slate-400 bg-transparent focus:outline-none resize-y"
                    />

                    {enhanceNote && (
                      <p className="mt-3 pt-3 border-t border-slate-100 text-xs text-blue-700">
                        Ajuste aplicado: {enhanceNote}
                      </p>
                    )}
                  </div>

                  {/* Editor Footer Metrics */}
                  <div className="px-5 py-3 bg-slate-50/60 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                      <span>{scriptMetrics.words} palabras</span>
                      <span aria-hidden="true">·</span>
                      <span>{scriptMetrics.chars} caracteres</span>
                      <span aria-hidden="true">·</span>
                      <span>~{formatTimecode(scriptMetrics.estimatedSec)} est.</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setScriptText("");
                          setPreviousScriptBackup(null);
                          setEnhanceNote(null);
                        }}
                        disabled={!scriptText}
                        className="text-xs font-medium text-slate-500 hover:text-slate-900 disabled:opacity-40 cursor-pointer"
                      >
                        Limpiar texto
                      </button>
                    </div>
                  </div>
                </section>
              ) : activeTab === "phrases" ? (
                <BatchPhrasesWorkspace
                  rawText={rawBatchText}
                  onChangeRawText={setRawBatchText}
                  phrases={phrases}
                  onChangePhrases={setPhrases}
                  isGeneratingBatch={isGeneratingBatch}
                  isSplittingAi={isSplittingAi}
                  cooldownSeconds={batchCooldownSeconds}
                  engine={engine}
                  onSwitchToLite={() => handleSelectEngine("gemini-3.8-flash-lite-tts")}
                  onParseNumbered={handleParseNumberedPhrases}
                  onSplitWithAi={handleSplitPhrasesWithAi}
                  onGenerateBatch={handleGenerateBatch}
                  onStopBatch={handleStopBatch}
                  onRegenerateSingle={handleRegenerateSinglePhrase}
                />
              ) : (
                <DialogueEditor
                  speakers={dialogueSpeakers}
                  lines={dialogueLines}
                  onChangeLines={setDialogueLines}
                  activeSpeakerIndex={activeSpeakerIndex}
                  onSelectActiveSpeaker={setActiveSpeakerIndex}
                  onRenameSpeaker={handleRenameDialogueSpeaker}
                  onAddSpeaker={handleAddDialogueSpeaker}
                  onRemoveSpeaker={handleRemoveDialogueSpeaker}
                  resolveVoiceLabel={resolveVoiceLabel}
                />
              )}

              {/* Waveform Master Player (Studio & Dialogue) */}
              {activeTab !== "phrases" && (
                <WaveformPlayer
                  take={currentTake}
                  isGenerating={isGenerating}
                  onToggleFavorite={handleToggleFavorite}
                />
              )}
            </div>

            {/* Right Column: Voice & Emotion Inspector */}
            <div className="lg:col-span-5 xl:col-span-4">
              {activeTab === "studio" || activeTab === "phrases" ? (
                <VoiceInspector
                  selectedVoice={selectedVoice}
                  onSelectVoice={handleSelectVoice}
                  customVoices={customVoices}
                  onOpenVoiceRecorder={() => setIsVoiceRecorderOpen(true)}
                  onDeleteCustomVoice={handleDeleteCustomVoice}
                  selectedEmotionId={selectedEmotionId}
                  onSelectEmotion={handleSelectEmotion}
                  customStyle={customStyle}
                  onChangeCustomStyle={handleChangeCustomStyle}
                  intensity={intensity}
                  onChangeIntensity={handleSelectIntensity}
                  pace={pace}
                  onChangePace={handleSelectPace}
                  engine={engine}
                  onChangeEngine={handleSelectEngine}
                  openSourceConfig={openSourceConfig}
                  hasHfToken={Boolean(hfToken.trim())}
                  onOpenOpenSourceConfig={() => setIsOpenSourceModalOpen(true)}
                  auditioningVoice={auditioningVoice}
                  onAuditionVoice={handleAuditionVoice}
                  showEngineSelector={true}
                  persistenceHint={true}
                />
              ) : (
                <VoiceInspector
                  speakerHeading={`Configurando: ${activeDialogueSpeaker.speaker} (Voz ${
                    activeSpeakerIndex + 1
                  })`}
                  selectedVoice={activeDialogueSpeaker.voiceName}
                  onSelectVoice={(voice) =>
                    setDialogueSpeakers((prev) =>
                      prev.map((spk, idx) =>
                        idx === activeSpeakerIndex ? { ...spk, voiceName: voice } : spk
                      )
                    )
                  }
                  customVoices={customVoices}
                  onOpenVoiceRecorder={() => setIsVoiceRecorderOpen(true)}
                  onDeleteCustomVoice={handleDeleteCustomVoice}
                  selectedEmotionId={activeDialogueSpeaker.emotionId}
                  onSelectEmotion={handleSelectDialogueEmotion}
                  customStyle={activeDialogueSpeaker.style}
                  onChangeCustomStyle={(style) =>
                    setDialogueSpeakers((prev) =>
                      prev.map((spk, idx) =>
                        idx === activeSpeakerIndex ? { ...spk, style } : spk
                      )
                    )
                  }
                  intensity={dialogueIntensity}
                  onChangeIntensity={setDialogueIntensity}
                  pace={dialoguePace}
                  onChangePace={setDialoguePace}
                  engine="gemini-3.8-flash-tts"
                  onChangeEngine={() => {}}
                  auditioningVoice={auditioningVoice}
                  onAuditionVoice={handleAuditionVoice}
                  showEngineSelector={false}
                />
              )}
            </div>
          </div>
        )}

        {user && activeTab === "library" && (
          <LibraryView
            takes={libraryTakes}
            onToggleFavorite={handleToggleFavorite}
            onDeleteTake={handleDeleteTake}
            onLoadInStudio={handleLoadInStudio}
            onGoToStudio={() => setActiveTab("studio")}
          />
        )}

        {activeTab === "guide" && <ExpressiveGuide onApplySample={handleApplySample} />}
          </>
        )}
      </main>

      {user && (
        <>
          <ApiKeyModal
            key={`${user.uid}-${isApiKeyModalOpen}`}
            isOpen={isApiKeyModalOpen}
            onClose={() => setIsApiKeyModalOpen(false)}
            currentApiKey={userApiKey}
            onSaveApiKey={handleSaveApiKey}
            onClearApiKey={handleClearApiKey}
            getIdToken={() => user.getIdToken()}
          />

          <OpenSourceConfigModal
            key={`os-${user.uid}-${isOpenSourceModalOpen}-${engine}`}
            isOpen={isOpenSourceModalOpen}
            onClose={() => setIsOpenSourceModalOpen(false)}
            activeTabEngine={
              engine === "opensource-endpoint" ? "opensource-endpoint" : "opensource-hf"
            }
            config={openSourceConfig}
            hfToken={hfToken}
            endpointToken={endpointToken}
            onSaveConfig={handleSaveOpenSourceConfig}
            getIdToken={() => user.getIdToken()}
          />

          <PersonalVoiceRecorderModal
            isOpen={isVoiceRecorderOpen}
            onClose={() => setIsVoiceRecorderOpen(false)}
            userId={user.uid}
            defaultCloningMode={isOpenSourceEngine(engine) ? "opensource" : "gemini"}
            onCreatedVoice={handleCreatedCustomVoice}
            authorizedFetch={authorizedFetch}
          />
        </>
      )}
    </div>
  );
}
