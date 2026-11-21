import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Download,
  Heart,
  Pause,
  Play,
  Search,
  Trash2,
} from "lucide-react";
import { AudioTake } from "../types/voice";
import { base64ToAudioBlob, downloadWavBase64, formatTimecode } from "../lib/audioUtils";

interface LibraryViewProps {
  takes: AudioTake[];
  onToggleFavorite: (id: string) => void;
  onDeleteTake: (id: string) => void;
  onLoadInStudio: (take: AudioTake) => void;
  onGoToStudio: () => void;
}

type LibraryFilter = "all" | "favorites" | "single" | "dialogue";

export const LibraryView: React.FC<LibraryViewProps> = ({
  takes,
  onToggleFavorite,
  onDeleteTake,
  onLoadInStudio,
  onGoToStudio,
}) => {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [playingId, setPlayingId] = useState<string | null>(null);
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

  const handleTogglePlay = async (take: AudioTake) => {
    if (!take.audioBase64) return;
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.onended = () => setPlayingId(null);
    }

    const audio = audioRef.current;

    if (playingId === take.id) {
      audio.pause();
      setPlayingId(null);
      return;
    }

    if (activeUrlRef.current) {
      URL.revokeObjectURL(activeUrlRef.current);
      activeUrlRef.current = null;
    }

    const blob = base64ToAudioBlob(take.audioBase64, take.mimeType);
    const url = URL.createObjectURL(blob);
    activeUrlRef.current = url;
    audio.src = url;
    try {
      await audio.play();
      setPlayingId(take.id);
    } catch {
      setPlayingId(null);
    }
  };

  const filteredTakes = takes.filter((take) => {
    if (filter === "favorites" && !take.favorite) return false;
    if (filter === "single" && take.mode !== "single") return false;
    if (filter === "dialogue" && take.mode !== "dialogue") return false;

    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        take.title.toLowerCase().includes(q) ||
        take.scriptText.toLowerCase().includes(q) ||
        take.voiceSummary.toLowerCase().includes(q) ||
        take.emotionLabel.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const formatDate = (timestamp: number) => {
    return new Intl.DateTimeFormat("es-ES", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));
  };

  return (
    <div className="max-w-[1160px] mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Biblioteca de tomas
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Tu historial de guiones se sincroniza con tu cuenta y los archivos WAV se conservan localmente en este navegador.
          </p>
        </div>

        <span className="text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap shrink-0">
          {takes.length} {takes.length === 1 ? "toma guardada" : "tomas guardadas"}
        </span>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg self-start">
          {(
            [
              { id: "all", label: "Todas" },
              { id: "favorites", label: "Favoritas" },
              { id: "single", label: "Monólogo" },
              { id: "dialogue", label: "Diálogo" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                filter === item.id
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por guion, voz o emoción..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
          />
        </div>
      </div>

      {/* List or Empty State */}
      {filteredTakes.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <h2 className="text-base font-semibold text-slate-900">
            {takes.length === 0
              ? "Aún no has generado audios"
              : "No hay tomas que coincidan con este filtro"}
          </h2>
          <p className="text-sm text-slate-500 mt-1.5 max-w-md mx-auto">
            {takes.length === 0
              ? "Escribe un texto en el estudio, elige un registro emocional y genera tu primera locución natural."
              : "Prueba con otro término de búsqueda o cambia la categoría seleccionada."}
          </p>
          {takes.length === 0 && (
            <button
              type="button"
              onClick={onGoToStudio}
              className="mt-5 inline-flex items-center px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              Ir al estudio
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
          {filteredTakes.map((take) => {
            const isPlaying = playingId === take.id;
            const hasLocalAudio = Boolean(take.audioBase64);
            return (
              <div
                key={take.id}
                className="px-5 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/70 transition-colors"
              >
                <div className="flex items-start gap-3.5 min-w-0 flex-1">
                  <button
                    type="button"
                    disabled={!hasLocalAudio}
                    onClick={() => handleTogglePlay(take)}
                    aria-label={
                      !hasLocalAudio
                        ? "Audio no disponible en este dispositivo"
                        : isPlaying
                          ? "Pausar toma"
                          : "Reproducir toma"
                    }
                    title={
                      hasLocalAudio
                        ? isPlaying
                          ? "Pausar"
                          : "Reproducir"
                        : "Sincronizada desde otra sesión. Cárgala en el estudio para volver a sintetizar el WAV."
                    }
                    className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                      !hasLocalAudio
                        ? "bg-slate-100 text-slate-300 cursor-not-allowed"
                        : isPlaying
                          ? "bg-blue-600 text-white cursor-pointer"
                          : "bg-slate-100 text-slate-800 hover:bg-slate-200 cursor-pointer"
                    }`}
                  >
                    {isPlaying ? (
                      <Pause className="w-4 h-4" />
                    ) : (
                      <Play className="w-4 h-4 ml-0.5" />
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900 truncate">
                        {take.title}
                      </h3>
                      {!hasLocalAudio && (
                        <span className="text-[11px] font-medium text-slate-400">
                          Guion en la nube · Carga para generar WAV
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
                      <span>{take.mode === "dialogue" ? "Diálogo" : "Monólogo"}</span>
                      <span aria-hidden="true">·</span>
                      <span>{take.voiceSummary}</span>
                      <span aria-hidden="true">·</span>
                      <span>{take.emotionLabel}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {formatTimecode(take.durationSeconds)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{formatDate(take.createdAt)}</span>
                    </div>

                    <p className="text-xs text-slate-600 line-clamp-1 mt-1.5">
                      {take.scriptText}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                  <button
                    type="button"
                    onClick={() => onLoadInStudio(take)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <span>Cargar en estudio</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleFavorite(take.id)}
                    aria-label={take.favorite ? "Quitar de favoritos" : "Marcar favorito"}
                    className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                      take.favorite
                        ? "border-blue-200 bg-blue-50 text-blue-600"
                        : "border-slate-200 text-slate-500 hover:text-slate-900"
                    }`}
                  >
                    <Heart
                      className={`w-3.5 h-3.5 ${take.favorite ? "fill-blue-600" : ""}`}
                    />
                  </button>

                  {hasLocalAudio && (
                    <button
                      type="button"
                      onClick={() =>
                        downloadWavBase64(
                          take.audioBase64,
                          `resonancia-${take.id.slice(0, 6)}.wav`,
                          take.mimeType
                        )
                      }
                      aria-label="Descargar WAV"
                      className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      if (playingId === take.id && audioRef.current) {
                        audioRef.current.pause();
                        setPlayingId(null);
                      }
                      onDeleteTake(take.id);
                    }}
                    aria-label="Eliminar toma"
                    className="p-2 rounded-lg border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
