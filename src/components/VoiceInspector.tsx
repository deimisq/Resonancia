import React from "react";
import { AlertCircle, Cpu, Loader2, Mic, Settings2, Trash2, Volume2 } from "lucide-react";
import {
  CustomVoiceProfile,
  EMOTION_PRESETS,
  IntensityLevel,
  isOpenSourceEngine,
  OpenSourcePublicConfig,
  PaceLevel,
  TtsEngine,
  VOICE_PROFILES,
  VoiceSelection,
} from "../types/voice";

interface VoiceInspectorProps {
  selectedVoice: VoiceSelection;
  onSelectVoice: (voice: VoiceSelection) => void;
  customVoices?: CustomVoiceProfile[];
  onOpenVoiceRecorder?: () => void;
  onDeleteCustomVoice?: (voice: CustomVoiceProfile) => void;
  selectedEmotionId: string;
  onSelectEmotion: (emotionId: string) => void;
  customStyle: string;
  onChangeCustomStyle: (style: string) => void;
  intensity: IntensityLevel;
  onChangeIntensity: (level: IntensityLevel) => void;
  pace: PaceLevel;
  onChangePace: (pace: PaceLevel) => void;
  engine: TtsEngine;
  onChangeEngine: (engine: TtsEngine) => void;
  openSourceConfig?: OpenSourcePublicConfig;
  hasHfToken?: boolean;
  onOpenOpenSourceConfig?: () => void;
  auditioningVoice: VoiceSelection | null;
  onAuditionVoice: (voice: VoiceSelection) => void;
  showEngineSelector?: boolean;
  speakerHeading?: string;
  persistenceHint?: boolean;
}

export const VoiceInspector: React.FC<VoiceInspectorProps> = ({
  selectedVoice,
  onSelectVoice,
  customVoices = [],
  onOpenVoiceRecorder,
  onDeleteCustomVoice,
  selectedEmotionId,
  onSelectEmotion,
  customStyle,
  onChangeCustomStyle,
  intensity,
  onChangeIntensity,
  pace,
  onChangePace,
  engine,
  onChangeEngine,
  openSourceConfig,
  hasHfToken = false,
  onOpenOpenSourceConfig,
  auditioningVoice,
  onAuditionVoice,
  showEngineSelector = true,
  speakerHeading,
  persistenceHint = false,
}) => {
  const usingOpenSource = showEngineSelector && isOpenSourceEngine(engine);
  const selectedCustomVoice = customVoices.find((cv) => cv.voiceToken === selectedVoice);
  const hasUsableLocalSample = Boolean(selectedCustomVoice?.sampleAudioBase64);
  const firstLocalSample = customVoices.find((cv) => Boolean(cv.sampleAudioBase64));

  return (
    <aside className="bg-white border border-slate-200 rounded-xl p-5 space-y-6">
      {speakerHeading && (
        <div className="pb-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">{speakerHeading}</h2>
        </div>
      )}

      {/* Personal Replicated Voice Section */}
      {(onOpenVoiceRecorder || customVoices.length > 0) && (
        <div>
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Tu voz clonada</h3>
              <p className="text-[11px] text-slate-500">
                Graba una muestra leyendo un texto para generar audios con tu voz.
              </p>
            </div>
            {onOpenVoiceRecorder && (
              <button
                type="button"
                onClick={onOpenVoiceRecorder}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Mic className="w-3.5 h-3.5" />
                <span>Grabar mi voz</span>
              </button>
            )}
          </div>

          {customVoices.length > 0 && (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
              {customVoices.map((cv) => {
                const isActive = selectedVoice === cv.voiceToken;
                const isAuditioning = auditioningVoice === cv.voiceToken;
                return (
                  <div
                    key={cv.id}
                    className={`flex items-center justify-between gap-2 px-3.5 py-2.5 transition-colors ${
                      isActive ? "bg-blue-50/70" : "bg-white hover:bg-slate-50"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectVoice(cv.voiceToken)}
                      className="flex-1 text-left min-w-0 cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm font-semibold truncate ${
                            isActive ? "text-blue-700" : "text-slate-900"
                          }`}
                        >
                          {cv.displayName}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-0.5">
                        {cv.storageMode === "opensource"
                          ? "Voz local · Open-Source (gratis)"
                          : cv.storageMode === "project"
                            ? "Voz propia · Proyecto Gemini"
                            : "Voz propia · Clave local (7 d)"}
                      </p>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onAuditionVoice(cv.voiceToken)}
                        disabled={auditioningVoice !== null}
                        aria-label={`Escuchar voz ${cv.displayName}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-blue-700 hover:bg-white border border-slate-200 rounded-md transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
                      >
                        {isAuditioning ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                        ) : (
                          <Volume2 className="w-3.5 h-3.5" />
                        )}
                        <span>{isAuditioning ? "Cargando" : "Probar"}</span>
                      </button>

                      {onDeleteCustomVoice && (
                        <button
                          type="button"
                          onClick={() => onDeleteCustomVoice(cv)}
                          aria-label={`Eliminar voz ${cv.displayName}`}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded-md transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {usingOpenSource && !hasUsableLocalSample && (
            <div className="mt-2.5 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span>
                  Los motores Open-Source clonan directamente desde una muestra grabada.{" "}
                  {firstLocalSample
                    ? "Selecciona una de tus voces grabadas arriba o graba una nueva."
                    : "Graba o sube un audio de 6–20 s con tu voz para sintetizar gratis."}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-6">
                {firstLocalSample && (
                  <button
                    type="button"
                    onClick={() => onSelectVoice(firstLocalSample.voiceToken)}
                    className="px-2.5 py-1 text-[11px] font-semibold bg-amber-900 text-white rounded-md hover:bg-amber-800 cursor-pointer"
                  >
                    Usar «{firstLocalSample.displayName}»
                  </button>
                )}
                {onOpenVoiceRecorder && (
                  <button
                    type="button"
                    onClick={onOpenVoiceRecorder}
                    className="px-2.5 py-1 text-[11px] font-semibold bg-white text-amber-900 border border-amber-300 rounded-md hover:bg-amber-100 cursor-pointer"
                  >
                    Grabar / subir muestra gratis
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Voice Persona Selector */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900">Timbre de voz</h3>
          <span className="text-xs text-slate-500">5 perfiles de estudio</span>
        </div>

        <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
          {VOICE_PROFILES.map((voice) => {
            const isActive = selectedVoice === voice.id;
            const isAuditioning = auditioningVoice === voice.id;
            return (
              <div
                key={voice.id}
                className={`flex items-center justify-between gap-3 px-3.5 py-2.5 transition-colors ${
                  isActive ? "bg-blue-50/70" : "bg-white hover:bg-slate-50"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectVoice(voice.id)}
                  className="flex-1 text-left min-w-0 cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-semibold ${
                        isActive ? "text-blue-700" : "text-slate-900"
                      }`}
                    >
                      {voice.name}
                    </span>
                    <span className="text-xs text-slate-500 truncate">{voice.timbre}</span>
                  </div>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{voice.idealFor}</p>
                </button>

                <button
                  type="button"
                  onClick={() => onAuditionVoice(voice.id)}
                  disabled={auditioningVoice !== null}
                  aria-label={`Escuchar muestra de voz ${voice.name}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-blue-700 hover:bg-white border border-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  {isAuditioning ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" />
                  )}
                  <span>{isAuditioning ? "Cargando" : "Probar"}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Emotional Register */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900">Registro emocional</h3>
          <span className="text-xs text-slate-500">Matiz principal</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {EMOTION_PRESETS.map((emotion) => {
            const isSelected = selectedEmotionId === emotion.id;
            return (
              <button
                key={emotion.id}
                type="button"
                onClick={() => onSelectEmotion(emotion.id)}
                className={`text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                  isSelected
                    ? "border-blue-600 bg-blue-50/70 text-blue-900"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <div className="text-xs font-semibold truncate">{emotion.label}</div>
                <div className="text-[11px] text-slate-500 truncate mt-0.5">{emotion.summary}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Intensity & Pace Segmented Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2">
            Intensidad emotiva
          </label>
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                { id: "subtle", label: "Sutil" },
                { id: "balanced", label: "Media" },
                { id: "intense", label: "Intensa" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeIntensity(opt.id)}
                className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  intensity === opt.id
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2">Cadencia</label>
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                { id: "slow", label: "Pausada" },
                { id: "natural", label: "Natural" },
                { id: "dynamic", label: "Ágil" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangePace(opt.id)}
                className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  pace === opt.id
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Custom Vocal Direction */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label htmlFor="custom-style-input" className="text-xs font-semibold text-slate-700">
            Dirección actoral (matiz libre)
          </label>
        </div>
        <textarea
          id="custom-style-input"
          rows={3}
          value={customStyle}
          onChange={(e) => onChangeCustomStyle(e.target.value)}
          placeholder="Ej. Voz íntima cercana al micrófono, leve sonrisa nostálgica y respiraciones suaves..."
          className="w-full px-3 py-2.5 text-xs leading-relaxed text-slate-800 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 resize-none"
        />
      </div>

      {/* Engine Choice */}
      {showEngineSelector && (
        <div className="pt-3 border-t border-slate-100 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Motor de síntesis
            </label>
            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => onChangeEngine("gemini-3.8-flash-tts")}
                  className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    engine === "gemini-3.8-flash-tts"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Gemini Flash
                </button>
                <button
                  type="button"
                  onClick={() => onChangeEngine("gemini-3.8-flash-lite-tts")}
                  className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    engine === "gemini-3.8-flash-lite-tts"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Gemini Lite
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1 p-1 bg-emerald-50/70 border border-emerald-200/70 rounded-lg">
                <button
                  type="button"
                  onClick={() => onChangeEngine("opensource-hf")}
                  className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    engine === "opensource-hf"
                      ? "bg-white text-emerald-900 shadow-xs font-semibold"
                      : "text-emerald-800/80 hover:text-emerald-950"
                  }`}
                >
                  Hugging Face (Gratis)
                </button>
                <button
                  type="button"
                  onClick={() => onChangeEngine("opensource-endpoint")}
                  className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    engine === "opensource-endpoint"
                      ? "bg-white text-emerald-900 shadow-xs font-semibold"
                      : "text-emerald-800/80 hover:text-emerald-950"
                  }`}
                >
                  Colab / Endpoint
                </button>
              </div>
            </div>
          </div>

          {usingOpenSource ? (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800 min-w-0 truncate">
                  <Cpu className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                  <span className="truncate">
                    {engine === "opensource-hf"
                      ? openSourceConfig?.hfSpaceId || "ResembleAI/Chatterbox-Multilingual-TTS"
                      : openSourceConfig?.endpointUrl || "Falta URL de Colab / Endpoint"}
                  </span>
                </span>
                {onOpenOpenSourceConfig && (
                  <button
                    type="button"
                    onClick={onOpenOpenSourceConfig}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md shrink-0 cursor-pointer"
                  >
                    <Settings2 className="w-3 h-3" />
                    <span>Configurar</span>
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                {engine === "opensource-hf"
                  ? hasHfToken
                    ? "Token HF activo para tu cuota ZeroGPU. Clonación zero-shot con Chatterbox / F5-TTS."
                    : "Sin Token HF (usa cuota pública limitada). Añade un token gratuito en Configurar para mejorar disponibilidad."
                  : openSourceConfig?.endpointUrl
                    ? `Conectando por HTTPS (${openSourceConfig.endpointProtocol}) en idioma «${openSourceConfig.language}».`
                    : "Pega la URL de Google Colab T4 o de un servidor externo en Configurar."}
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">
              {engine === "gemini-3.8-flash-tts"
                ? "Diseñado para diseño vocal, suspiros, risas y máxima carga emotiva."
                : "Optimizado para lectura fluida de artículos y respuestas ágiles."}
            </p>
          )}
        </div>
      )}

      {persistenceHint && (
        <p className="text-[11px] text-slate-400 pt-2 border-t border-slate-100">
          Tu voz, emoción, dirección actoral, intensidad, cadencia y motor se guardan
          automáticamente como predeterminados hasta que los cambies.
        </p>
      )}
    </aside>
  );
};
