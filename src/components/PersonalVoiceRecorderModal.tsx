import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Loader2,
  Mic,
  Play,
  RotateCcw,
  Square,
  Upload,
  X,
} from "lucide-react";
import {
  CustomVoiceProfile,
  CustomVoiceStorageMode,
  VOICE_CLONING_SCRIPTS,
  VOICE_CONSENT_SCRIPTS,
  VoiceConsentLanguage,
} from "../types/voice";
import { base64ToAudioBlob, formatTimecode } from "../lib/audioUtils";
import { parseJsonResponse } from "../lib/apiResponse";
import { encodeBlobTo24kMonoWavBase64 } from "../lib/wavEncoder";

interface PersonalVoiceRecorderModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  defaultCloningMode?: "opensource" | "gemini";
  onCreatedVoice: (voice: CustomVoiceProfile) => void;
  authorizedFetch: (url: string, bodyPayload: unknown) => Promise<Response>;
}

type RecordingTarget = "consent" | "sample";

interface RecordedClip {
  wavBase64: string;
  durationSeconds: number;
}

export const PersonalVoiceRecorderModal: React.FC<PersonalVoiceRecorderModalProps> = ({
  isOpen,
  onClose,
  userId,
  defaultCloningMode = "opensource",
  onCreatedVoice,
  authorizedFetch,
}) => {
  const [cloningMode, setCloningMode] = useState<"opensource" | "gemini">(defaultCloningMode);
  const [displayName, setDisplayName] = useState<string>("Mi voz natural");
  const [storageMode, setStorageMode] = useState<CustomVoiceStorageMode>("project");
  const [consentLang, setConsentLang] = useState<VoiceConsentLanguage>("es-ES");
  const [selectedScriptId, setSelectedScriptId] = useState<string>(VOICE_CLONING_SCRIPTS[0].id);
  const [referenceText, setReferenceText] = useState<string>(VOICE_CLONING_SCRIPTS[0].text);

  const [consentClip, setConsentClip] = useState<RecordedClip | null>(null);
  const [sampleClip, setSampleClip] = useState<RecordedClip | null>(null);

  const [recordingTarget, setRecordingTarget] = useState<RecordingTarget | null>(null);
  const [processingTarget, setProcessingTarget] = useState<RecordingTarget | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [micLevel, setMicLevel] = useState<number>(0);

  const [playingTarget, setPlayingTarget] = useState<RecordingTarget | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const analyserCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCloningMode(defaultCloningMode);
    }
  }, [isOpen, defaultCloningMode]);

  const stopPlayback = () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
    }
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPlayingTarget(null);
  };

  const cleanupRecordingResources = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (analyserCtxRef.current) {
      analyserCtxRef.current.close().catch(() => {});
      analyserCtxRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
    setMicLevel(0);
  };

  useEffect(() => {
    if (!isOpen) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      cleanupRecordingResources();
      stopPlayback();
      setRecordingTarget(null);
      setProcessingTarget(null);
      setError(null);
    }
    return () => {
      cleanupRecordingResources();
      stopPlayback();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const currentScript =
    VOICE_CLONING_SCRIPTS.find((s) => s.id === selectedScriptId) || VOICE_CLONING_SCRIPTS[0];
  const currentConsent = VOICE_CONSENT_SCRIPTS[consentLang];

  const handleSelectProposedScript = (scriptId: string) => {
    setSelectedScriptId(scriptId);
    const found = VOICE_CLONING_SCRIPTS.find((s) => s.id === scriptId);
    if (found) {
      setReferenceText(found.text);
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  };

  const handleStartRecording = async (target: RecordingTarget) => {
    if (recordingTarget || processingTarget || isSubmitting) return;
    setError(null);
    stopPlayback();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("Tu navegador no permite capturar audio del micrófono en este contexto.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      const mimeCandidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];
      const supportedMime = mimeCandidates.find((m) =>
        typeof MediaRecorder !== "undefined" ? MediaRecorder.isTypeSupported(m) : false
      );

      const recorder = supportedMime
        ? new MediaRecorder(stream, { mimeType: supportedMime })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      mediaRecorderRef.current = recorder;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        analyserCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateLevel = () => {
          analyser.getByteTimeDomainData(dataArray);
          let sumSq = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const norm = (dataArray[i] - 128) / 128;
            sumSq += norm * norm;
          }
          const rms = Math.sqrt(sumSq / dataArray.length);
          setMicLevel(Math.min(1, rms * 3.5));
          rafRef.current = requestAnimationFrame(updateLevel);
        };
        rafRef.current = requestAnimationFrame(updateLevel);
      }

      const startedAt = Date.now();
      const maxSeconds = target === "consent" ? 15 : 35;
      setElapsedSeconds(0);
      setRecordingTarget(target);

      timerRef.current = window.setInterval(() => {
        const secs = Math.floor((Date.now() - startedAt) / 1000);
        setElapsedSeconds(secs);
        if (secs >= maxSeconds) {
          handleStopRecording();
        }
      }, 250);

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        const recordedMime = recorder.mimeType || supportedMime || "audio/webm";
        const recordedBlob = new Blob(chunksRef.current, { type: recordedMime });
        cleanupRecordingResources();
        setRecordingTarget(null);
        setProcessingTarget(target);

        try {
          const encoded = await encodeBlobTo24kMonoWavBase64(recordedBlob);
          if (encoded.durationSeconds < 1.2) {
            throw new Error(
              "La grabación fue demasiado corta. Mantén una lectura clara de al menos 2 segundos."
            );
          }
          if (target === "consent") {
            setConsentClip(encoded);
          } else {
            setSampleClip(encoded);
          }
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : "No se pudo procesar el audio grabado a WAV 24 kHz."
          );
        } finally {
          setProcessingTarget(null);
        }
      };

      recorder.start(250);
    } catch (err) {
      cleanupRecordingResources();
      setRecordingTarget(null);
      const name = (err as { name?: string })?.name || "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError(
          "Permiso de micrófono denegado. Habilita el micrófono para este sitio en tu navegador e inténtalo de nuevo."
        );
      } else if (name === "NotFoundError") {
        setError("No se detectó ningún micrófono conectado en este dispositivo.");
      } else {
        setError(
          err instanceof Error ? err.message : "No se pudo iniciar la grabación de audio."
        );
      }
    }
  };

  const handleUploadSampleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      setError("El archivo supera los 15 MB. Elige un clip limpio de entre 5 y 30 segundos.");
      return;
    }

    setError(null);
    stopPlayback();
    setProcessingTarget("sample");
    try {
      const encoded = await encodeBlobTo24kMonoWavBase64(file);
      if (encoded.durationSeconds < 1.5) {
        throw new Error("El audio debe durar al menos 2 segundos.");
      }
      if (encoded.durationSeconds > 45) {
        throw new Error(
          "El audio dura más de 45 segundos. Para mejores resultados en zero-shot usa un clip de 6 a 25 segundos."
        );
      }
      setSampleClip(encoded);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo convertir el archivo a WAV 24 kHz."
      );
    } finally {
      setProcessingTarget(null);
    }
  };

  const handleTogglePlay = async (target: RecordingTarget) => {
    const clip = target === "consent" ? consentClip : sampleClip;
    if (!clip) return;

    if (playingTarget === target) {
      stopPlayback();
      return;
    }

    stopPlayback();
    const blob = base64ToAudioBlob(clip.wavBase64, "audio/wav");
    const url = URL.createObjectURL(blob);
    previewUrlRef.current = url;

    if (!previewAudioRef.current) {
      previewAudioRef.current = new Audio();
    }
    const audio = previewAudioRef.current;
    audio.src = url;
    audio.onended = () => {
      setPlayingTarget(null);
    };
    setPlayingTarget(target);
    await audio.play().catch(() => {
      setPlayingTarget(null);
    });
  };

  const handleCreateReplicatedVoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sampleClip || isSubmitting || recordingTarget || processingTarget) return;
    if (cloningMode === "gemini" && !consentClip) return;

    setError(null);

    if (cloningMode === "opensource") {
      const id = `osvoice_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const localVoice: CustomVoiceProfile = {
        id,
        ownerId: userId,
        displayName: displayName.trim() || "Mi voz Open-Source",
        voiceToken: id,
        storageMode: "opensource",
        languageCode: consentLang,
        createdAt: Date.now(),
        sampleAudioBase64: sampleClip.wavBase64,
        referenceText: referenceText.trim() || currentScript.text,
        durationSeconds: sampleClip.durationSeconds,
      };
      onCreatedVoice(localVoice);
      onClose();
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await authorizedFetch("/api/voices/replicate", {
        displayName: displayName.trim() || "Mi voz personalizada",
        sourceAudioBase64: sampleClip.wavBase64,
        consentAudioBase64: consentClip!.wavBase64,
        languageCode: consentLang,
        storeInGeminiProject: storageMode === "project",
      });

      const data = await parseJsonResponse<{
        voiceToken?: string;
        storageMode?: CustomVoiceStorageMode;
        displayName?: string;
        expireTime?: string | null;
        languageCode?: VoiceConsentLanguage;
        error?: string;
      }>(response);

      if (!response.ok || !data.voiceToken) {
        throw new Error(data.error || "No se pudo crear tu modelo de voz personalizada.");
      }

      const newVoice: CustomVoiceProfile = {
        id:
          data.storageMode === "project"
            ? data.voiceToken
            : `cv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ownerId: userId,
        displayName: data.displayName || displayName.trim() || "Mi voz personalizada",
        voiceToken: data.voiceToken,
        storageMode: data.storageMode || storageMode,
        languageCode: data.languageCode || consentLang,
        createdAt: Date.now(),
        expireTime: data.expireTime || undefined,
        sampleAudioBase64: sampleClip.wavBase64,
        referenceText: currentScript.text,
        durationSeconds: sampleClip.durationSeconds,
      };

      onCreatedVoice(newVoice);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Ocurrió un error al registrar tu voz en Gemini."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-voice-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 overflow-y-auto"
    >
      <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full shadow-lg overflow-hidden my-auto max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <Mic className="w-4 h-4 text-blue-600" />
            <h2 id="custom-voice-modal-title" className="text-base font-semibold text-slate-900">
              Clonar mi propia voz
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Cerrar grabador de voz"
            className="text-slate-400 hover:text-slate-700 p-1 rounded-md transition-colors cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form
          onSubmit={handleCreateReplicatedVoice}
          className="p-5 space-y-5 overflow-y-auto flex-1"
        >
          {/* Mode Selector: Open Source (Free) vs Gemini Paid */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              disabled={recordingTarget !== null || isSubmitting}
              onClick={() => {
                setCloningMode("opensource");
                setError(null);
              }}
              className={`py-2 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                cloningMode === "opensource"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Open-Source (Gratis · Local)
            </button>
            <button
              type="button"
              disabled={recordingTarget !== null || isSubmitting}
              onClick={() => {
                setCloningMode("gemini");
                setError(null);
              }}
              className={`py-2 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                cloningMode === "gemini"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Gemini API (Tier 1 de pago)
            </button>
          </div>

          {cloningMode === "opensource" ? (
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-3.5 text-xs text-emerald-950 leading-relaxed space-y-1">
              <p className="font-semibold">
                Clonación zero-shot gratuita para Hugging Face / Google Colab
              </p>
              <p>
                Graba una muestra de 6 a 20 segundos (o sube un archivo de audio) y el navegador la convertirá a{" "}
                <span className="font-mono">WAV 24 kHz</span>. No requiere tarjeta de crédito ni frase de consentimiento de Google.
              </p>
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs text-slate-600 leading-relaxed space-y-1">
              <p className="font-semibold text-slate-900">
                Cómo funciona la replicación vocal en Gemini API
              </p>
              <p>
                Tu navegador convierte automáticamente las grabaciones al formato exacto{" "}
                <span className="font-mono text-slate-800">WAV 24 kHz mono 16-bit</span>. Google
                verifica tu frase de consentimiento y extrae tu timbre vocal para sintetizar nuevos
                guiones con tu voz.
              </p>
              <p className="text-slate-500">
                Requisito oficial: tu clave API personal de Gemini debe pertenecer a un proyecto en{" "}
                <strong className="text-slate-700">Nivel de Pago (Paid Tier 1+)</strong>; las claves
                gratuitas no tienen habilitado el endpoint de replicación vocal.
              </p>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Voice Label & Storage Mode */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className={cloningMode === "opensource" ? "sm:col-span-2" : ""}>
              <label
                htmlFor="custom-voice-name"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Nombre de tu voz
              </label>
              <input
                id="custom-voice-name"
                type="text"
                maxLength={60}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Ej. Voz de Carlos"
                className="w-full px-3 py-2 text-xs text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            {cloningMode === "gemini" && (
              <div>
                <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Almacenamiento del perfil vocal
                </span>
                <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setStorageMode("project")}
                    className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                      storageMode === "project"
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Cuenta Gemini (1 año)
                  </button>
                  <button
                    type="button"
                    onClick={() => setStorageMode("local_key")}
                    className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                      storageMode === "local_key"
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Clave local (7 días)
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Step 1: Mandatory Consent Recording (Gemini mode only) */}
          {cloningMode === "gemini" && (
            <div className="border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-slate-900">
                    Paso 1 · Grabación de consentimiento obligatorio
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Lee la frase exactamente como aparece escrita (3 a 10 segundos).
                  </p>
                </div>

                <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md">
                  {(["es-ES", "en-US"] as const).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      disabled={recordingTarget !== null}
                      onClick={() => setConsentLang(lang)}
                      className={`px-2 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                        consentLang === lang
                          ? "bg-white text-slate-900 shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {lang === "es-ES" ? "Español" : "English"}
                    </button>
                  ))}
                </div>
              </div>

              <blockquote className="text-sm leading-relaxed text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 font-medium">
                “{currentConsent.statement}”
              </blockquote>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {recordingTarget === "consent" ? (
                    <button
                      type="button"
                      onClick={handleStopRecording}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors cursor-pointer"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>Detener ({formatTimecode(elapsedSeconds)})</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleStartRecording("consent")}
                      disabled={
                        recordingTarget !== null ||
                        processingTarget !== null ||
                        isSubmitting
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg transition-colors cursor-pointer"
                    >
                      {processingTarget === "consent" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : consentClip ? (
                        <RotateCcw className="w-3.5 h-3.5" />
                      ) : (
                        <Mic className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {processingTarget === "consent"
                          ? "Procesando WAV..."
                          : consentClip
                            ? "Grabar de nuevo"
                            : "Grabar consentimiento"}
                      </span>
                    </button>
                  )}

                  {consentClip && recordingTarget !== "consent" && (
                    <button
                      type="button"
                      onClick={() => handleTogglePlay("consent")}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
                    >
                      {playingTarget === "consent" ? (
                        <Square className="w-3 h-3 fill-current text-blue-600" />
                      ) : (
                        <Play className="w-3 h-3 fill-current" />
                      )}
                      <span className="font-mono tabular-nums">
                        {formatTimecode(consentClip.durationSeconds)}
                      </span>
                    </button>
                  )}
                </div>

                {recordingTarget === "consent" ? (
                  <div className="flex items-center gap-2 min-w-[120px]">
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-500 transition-all duration-75"
                        style={{ width: `${Math.round(micLevel * 100)}%` }}
                      />
                    </div>
                  </div>
                ) : consentClip ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                    <Check className="w-3.5 h-3.5" />
                    <span>WAV 24 kHz listo</span>
                  </span>
                ) : null}
              </div>
            </div>
          )}

          {/* Voice Sample Reading / File Upload */}
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-900">
                  {cloningMode === "gemini"
                    ? "Paso 2 · Muestra de tu voz leyendo el texto propuesto"
                    : "Muestra de tu voz (6 a 20 segundos en silencio)"}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Graba leyendo este texto natural o sube un audio limpio de tu voz.
                </p>
              </div>

              <select
                aria-label="Seleccionar guion de lectura propuesto"
                value={selectedScriptId}
                onChange={(e) => handleSelectProposedScript(e.target.value)}
                disabled={recordingTarget === "sample"}
                className="text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-600 cursor-pointer"
              >
                {VOICE_CLONING_SCRIPTS.map((script) => (
                  <option key={script.id} value={script.id}>
                    {script.title}
                  </option>
                ))}
              </select>
            </div>

            {cloningMode === "opensource" ? (
              <div>
                <label
                  htmlFor="os-ref-text"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Texto leído en el audio (Chatterbox no lo necesita; F5-TTS lo usa para mayor precisión):
                </label>
                <textarea
                  id="os-ref-text"
                  rows={3}
                  maxLength={1200}
                  value={referenceText}
                  onChange={(e) => setReferenceText(e.target.value)}
                  className="w-full text-sm leading-relaxed text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 resize-y"
                />
              </div>
            ) : (
              <div className="text-sm leading-relaxed text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-3">
                {currentScript.text}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleUploadSampleFile}
              className="hidden"
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {recordingTarget === "sample" ? (
                  <button
                    type="button"
                    onClick={handleStopRecording}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Detener ({formatTimecode(elapsedSeconds)})</span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => handleStartRecording("sample")}
                      disabled={
                        recordingTarget !== null ||
                        processingTarget !== null ||
                        isSubmitting
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg transition-colors cursor-pointer"
                    >
                      {processingTarget === "sample" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : sampleClip ? (
                        <RotateCcw className="w-3.5 h-3.5" />
                      ) : (
                        <Mic className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {processingTarget === "sample"
                          ? "Procesando WAV..."
                          : sampleClip
                            ? "Grabar de nuevo"
                            : "Grabar con micrófono"}
                      </span>
                    </button>

                    {cloningMode === "opensource" && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={
                          recordingTarget !== null ||
                          processingTarget !== null ||
                          isSubmitting
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Subir WAV / MP3</span>
                      </button>
                    )}
                  </>
                )}

                {sampleClip && recordingTarget !== "sample" && (
                  <button
                    type="button"
                    onClick={() => handleTogglePlay("sample")}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
                  >
                    {playingTarget === "sample" ? (
                      <Square className="w-3 h-3 fill-current text-blue-600" />
                    ) : (
                      <Play className="w-3 h-3 fill-current" />
                    )}
                    <span className="font-mono tabular-nums">
                      {formatTimecode(sampleClip.durationSeconds)}
                    </span>
                  </button>
                )}
              </div>

              {recordingTarget === "sample" ? (
                <div className="flex items-center gap-2 min-w-[120px]">
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-red-500 transition-all duration-75"
                      style={{ width: `${Math.round(micLevel * 100)}%` }}
                    />
                  </div>
                </div>
              ) : sampleClip ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                  <Check className="w-3.5 h-3.5" />
                  <span>
                    {sampleClip.durationSeconds < 6
                      ? "Listo (recomendado ≥6 s para mayor fidelidad)"
                      : "WAV 24 kHz listo"}
                  </span>
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg cursor-pointer"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={
                !sampleClip ||
                (cloningMode === "gemini" && !consentClip) ||
                isSubmitting ||
                recordingTarget !== null ||
                processingTarget !== null
              }
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-lg transition-colors cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Creando voz en Gemini...</span>
                </>
              ) : cloningMode === "opensource" ? (
                <span>Guardar voz local gratis</span>
              ) : (
                <span>Registrar y usar mi voz</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
