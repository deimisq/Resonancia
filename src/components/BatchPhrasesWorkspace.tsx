import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Download,
  ListOrdered,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import { PhraseItem, TtsEngine } from "../types/voice";
import {
  base64ToAudioBlob,
  downloadPhrasesZip,
  downloadWavBase64,
  formatTimecode,
} from "../lib/audioUtils";

interface BatchPhrasesWorkspaceProps {
  rawText: string;
  onChangeRawText: (value: string) => void;
  phrases: PhraseItem[];
  onChangePhrases: (phrases: PhraseItem[]) => void;
  isGeneratingBatch: boolean;
  isSplittingAi: boolean;
  cooldownSeconds: number | null;
  engine: TtsEngine;
  onSwitchToLite: () => void;
  onParseNumbered: () => void;
  onSplitWithAi: () => void;
  onGenerateBatch: () => void;
  onStopBatch: () => void;
  onRegenerateSingle: (id: string) => void;
}

const SAMPLE_NUMBERED = `1. <breath> Bienvenido a nuestra experiencia sonora.
2. Qué alegría tenerte aquí, tómate un momento para escuchar con calma.
3. Si necesitas ayuda en cualquier paso, estamos contigo en todo momento.
4. <laugh> ¡Listo! Ya puedes comenzar cuando quieras.`;

const SAMPLE_PARAGRAPH = `<breath> A veces basta una sola frase bien dicha para cambiar el tono de todo el día. No hace falta correr ni forzar la voz cuando el mensaje nace con honestidad. Respira hondo, deja que las palabras encuentren su propio ritmo y disfruta el resultado.`;

export const BatchPhrasesWorkspace: React.FC<BatchPhrasesWorkspaceProps> = ({
  rawText,
  onChangeRawText,
  phrases,
  onChangePhrases,
  isGeneratingBatch,
  isSplittingAi,
  cooldownSeconds,
  engine,
  onSwitchToLite,
  onParseNumbered,
  onSplitWithAi,
  onGenerateBatch,
  onStopBatch,
  onRegenerateSingle,
}) => {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isZipping, setIsZipping] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (activeUrlRef.current) {
        URL.revokeObjectURL(activeUrlRef.current);
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const handleTogglePlay = async (item: PhraseItem) => {
    if (!item.audioBase64) return;
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.onended = () => setPlayingId(null);
    }

    const audio = audioRef.current;
    if (playingId === item.id) {
      audio.pause();
      setPlayingId(null);
      return;
    }

    if (activeUrlRef.current) {
      URL.revokeObjectURL(activeUrlRef.current);
      activeUrlRef.current = null;
    }

    const blob = base64ToAudioBlob(item.audioBase64, item.mimeType || "audio/wav");
    const url = URL.createObjectURL(blob);
    activeUrlRef.current = url;
    audio.src = url;
    try {
      await audio.play();
      setPlayingId(item.id);
    } catch {
      setPlayingId(null);
    }
  };

  const handleAddPhrase = () => {
    onChangePhrases([
      ...phrases,
      {
        id: `phrase-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text: "",
        status: "pending",
      },
    ]);
  };

  const handleUpdatePhraseText = (id: string, nextText: string) => {
    onChangePhrases(
      phrases.map((item) =>
        item.id === id
          ? {
              ...item,
              text: nextText,
              status: item.text === nextText ? item.status : "pending",
              audioBase64: item.text === nextText ? item.audioBase64 : undefined,
              durationSeconds: item.text === nextText ? item.durationSeconds : undefined,
              errorMessage: undefined,
            }
          : item
      )
    );
  };

  const handleDeletePhrase = (id: string) => {
    if (playingId === id && audioRef.current) {
      audioRef.current.pause();
      setPlayingId(null);
    }
    onChangePhrases(phrases.filter((item) => item.id !== id));
  };

  const handleDownloadZip = async () => {
    if (isZipping) return;
    setIsZipping(true);
    try {
      await downloadPhrasesZip(phrases);
    } finally {
      setIsZipping(false);
    }
  };

  const readyCount = phrases.filter(
    (p) => p.status === "ready" && Boolean(p.audioBase64)
  ).length;
  const totalDuration = phrases.reduce(
    (acc, p) => acc + (p.status === "ready" ? p.durationSeconds || 0 : 0),
    0
  );
  const padWidth = Math.max(2, String(phrases.length).length);

  return (
    <div className="space-y-6">
      {/* Text Source & Segmentation Card */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Texto base o lista numerada
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Pega frases numeradas (1., 2., 3.) o un párrafo completo para que la IA detecte cada frase.
            </p>
          </div>

          <select
            value=""
            aria-label="Cargar ejemplo para frases"
            onChange={(e) => {
              if (e.target.value === "numbered") {
                onChangeRawText(SAMPLE_NUMBERED);
              } else if (e.target.value === "paragraph") {
                onChangeRawText(SAMPLE_PARAGRAPH);
              }
            }}
            className="text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 cursor-pointer"
          >
            <option value="" disabled>
              Cargar texto de ejemplo...
            </option>
            <option value="numbered">Lista numerada (4 frases)</option>
            <option value="paragraph">Párrafo narrativo para IA</option>
          </select>
        </div>

        <div className="p-5">
          <textarea
            rows={5}
            value={rawText}
            onChange={(e) => onChangeRawText(e.target.value)}
            placeholder={"1. Primera frase con <breath> emoción.\n2. Segunda frase...\n\nO pega aquí un párrafo continuo y pulsa «Detectar frases con IA»."}
            className="w-full text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 bg-transparent focus:outline-none resize-y"
          />
        </div>

        <div className="px-5 py-3 bg-slate-50/70 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onParseNumbered}
              disabled={!rawText.trim() || isGeneratingBatch || isSplittingAi}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:border-slate-300 hover:text-slate-900 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ListOrdered className="w-3.5 h-3.5" />
              <span>Separar numeración / líneas</span>
            </button>

            <button
              type="button"
              onClick={onSplitWithAi}
              disabled={!rawText.trim() || isGeneratingBatch || isSplittingAi}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isSplittingAi ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>{isSplittingAi ? "Detectando frases..." : "Detectar frases con IA"}</span>
            </button>
          </div>

          <span className="text-xs font-mono tabular-nums text-slate-500">
            {phrases.length} {phrases.length === 1 ? "frase en cola" : "frases en cola"}
          </span>
        </div>
      </section>

      {/* Numbered Phrases Queue & ZIP Export */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Audios numerados por frase
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              <span>
                {readyCount} / {phrases.length} listos
              </span>
              <span aria-hidden="true">·</span>
              <span>{formatTimecode(totalDuration)} total</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {isGeneratingBatch ? (
              <button
                type="button"
                onClick={onStopBatch}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-red-700" />
                <span>Detener lote</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onGenerateBatch}
                disabled={phrases.every((p) => !p.text.trim())}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Generar audios</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleDownloadZip}
              disabled={readyCount === 0 || isZipping}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isZipping ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Archive className="w-3.5 h-3.5" />
              )}
              <span>
                {isZipping ? "Empaquetando..." : `Descargar ZIP (${readyCount})`}
              </span>
            </button>
          </div>
        </div>

        {cooldownSeconds !== null && cooldownSeconds > 0 && (
          <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-900">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-700 shrink-0" />
              <span>
                Límite temporal por minuto alcanzado. Reanudando automáticamente en{" "}
                <strong className="font-mono tabular-nums">{cooldownSeconds}s</strong>...
              </span>
            </div>
            {engine === "gemini-3.8-flash-tts" && (
              <button
                type="button"
                onClick={() => {
                  onStopBatch();
                  onSwitchToLite();
                }}
                className="font-semibold text-amber-900 underline hover:text-amber-700 whitespace-nowrap cursor-pointer"
              >
                Detener y cambiar a Rápido (Lite)
              </button>
            )}
          </div>
        )}

        {phrases.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-slate-600">
              Aún no hay frases en la lista. Pega un texto arriba y pulsa{" "}
              <strong className="font-semibold text-slate-900">
                Separar numeración / líneas
              </strong>{" "}
              o{" "}
              <strong className="font-semibold text-slate-900">
                Detectar frases con IA
              </strong>
              .
            </p>
            <button
              type="button"
              onClick={handleAddPhrase}
              className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Agregar frase manualmente</span>
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {phrases.map((item, idx) => {
              const numLabel = String(idx + 1).padStart(padWidth, "0");
              const isPlaying = playingId === item.id;
              return (
                <div key={item.id} className="px-5 py-3.5 space-y-2">
                  <div className="flex items-start gap-3">
                    <span className="pt-2 text-xs font-mono tabular-nums font-semibold text-slate-400 shrink-0 w-7">
                      {numLabel}
                    </span>

                    <textarea
                      rows={2}
                      value={item.text}
                      disabled={item.status === "generating"}
                      onChange={(e) => handleUpdatePhraseText(item.id, e.target.value)}
                      placeholder={`Escribe la frase ${numLabel}...`}
                      className="flex-1 text-sm leading-relaxed text-slate-900 bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-600 focus:bg-slate-50/40 rounded-lg px-3 py-1.5 focus:outline-none resize-y disabled:opacity-60"
                    />

                    <div className="flex items-center gap-1.5 pt-1 shrink-0">
                      {item.status === "ready" && item.audioBase64 && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleTogglePlay(item)}
                            aria-label={
                              isPlaying
                                ? `Pausar frase ${numLabel}`
                                : `Reproducir frase ${numLabel}`
                            }
                            className={`p-2 rounded-lg transition-colors cursor-pointer ${
                              isPlaying
                                ? "bg-blue-600 text-white"
                                : "bg-slate-100 text-slate-800 hover:bg-slate-200"
                            }`}
                          >
                            {isPlaying ? (
                              <Pause className="w-3.5 h-3.5" />
                            ) : (
                              <Play className="w-3.5 h-3.5" />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              downloadWavBase64(
                                item.audioBase64!,
                                `${numLabel}_frase.wav`,
                                item.mimeType
                              )
                            }
                            aria-label={`Descargar frase ${numLabel} en WAV`}
                            className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => onRegenerateSingle(item.id)}
                        disabled={
                          !item.text.trim() ||
                          item.status === "generating" ||
                          isGeneratingBatch
                        }
                        aria-label={`Sintetizar frase ${numLabel}`}
                        title="Generar o regenerar esta frase"
                        className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:text-blue-700 hover:border-blue-200 disabled:opacity-40 transition-colors cursor-pointer"
                      >
                        {item.status === "generating" ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeletePhrase(item.id)}
                        disabled={isGeneratingBatch}
                        aria-label={`Eliminar frase ${numLabel}`}
                        className="p-2 rounded-lg text-slate-400 hover:text-red-600 disabled:opacity-40 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Row Status Metadata (unboxed text, accessible color + label/icon) */}
                  <div className="pl-10 flex flex-wrap items-center gap-2 text-xs">
                    {item.status === "pending" && (
                      <span className="text-slate-400">Pendiente de sintetizar</span>
                    )}
                    {item.status === "generating" && (
                      <span className="inline-flex items-center gap-1.5 text-blue-700 font-medium">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Sintetizando frase...</span>
                      </span>
                    )}
                    {item.status === "ready" && (
                      <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Lista</span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span className="font-mono tabular-nums text-slate-500">
                          {formatTimecode(item.durationSeconds || 0)}
                        </span>
                      </span>
                    )}
                    {item.status === "error" && (
                      <span className="inline-flex items-center gap-1.5 text-red-700">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{item.errorMessage || "Error al sintetizar"}</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {phrases.length > 0 && (
          <div className="px-5 py-3 bg-slate-50/60 border-t border-slate-100 flex items-center justify-between">
            <button
              type="button"
              onClick={handleAddPhrase}
              disabled={isGeneratingBatch}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:text-blue-800 hover:bg-blue-50 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Agregar frase</span>
            </button>

            <span className="text-xs text-slate-500">
              Los archivos del ZIP se nombran como 01_..., 02_..., etc.
            </span>
          </div>
        )}
      </section>
    </div>
  );
};
