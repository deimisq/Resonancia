import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Heart,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { AudioTake } from "../types/voice";
import {
  base64ToAudioBlob,
  downloadWavBase64,
  extractWavPeaks,
  formatTimecode,
} from "../lib/audioUtils";

interface WaveformPlayerProps {
  take: AudioTake | null;
  isGenerating: boolean;
  onToggleFavorite: (id: string) => void;
}

const PLAYBACK_RATES = [0.85, 1, 1.15, 1.3];

export const WaveformPlayer: React.FC<WaveformPlayerProps> = ({
  take,
  isGenerating,
  onToggleFavorite,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  const peaks = useMemo(() => {
    if (!take?.audioBase64) return [];
    return extractWavPeaks(take.audioBase64, 96);
  }, [take?.audioBase64]);

  useEffect(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    setIsPlaying(false);
    setCurrentTime(0);

    if (!take?.audioBase64) {
      setDuration(0);
      return;
    }

    const blob = base64ToAudioBlob(take.audioBase64, take.mimeType);
    const url = URL.createObjectURL(blob);
    objectUrlRef.current = url;
    setDuration(take.durationSeconds || 0);

    const audio = audioRef.current;
    if (audio) {
      audio.src = url;
      audio.playbackRate = playbackRate;
      audio.muted = isMuted;
      audio.load();
    }

    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [take?.id, take?.audioBase64, take?.mimeType]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
    }
  }, [isMuted]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const effectiveDuration = duration > 0 ? duration : take?.durationSeconds || 1;
    const progress = Math.max(0, Math.min(1, currentTime / effectiveDuration));

    const barCount = peaks.length;
    const gap = 3;
    const barWidth = Math.max(2, (width - gap * (barCount - 1)) / barCount);
    const centerY = height / 2;

    peaks.forEach((peak, index) => {
      const barRatio = index / barCount;
      const barHeight = Math.max(4, peak * (height - 8));
      const x = index * (barWidth + gap);
      const y = centerY - barHeight / 2;

      ctx.fillStyle = barRatio <= progress ? "#2563EB" : "#CBD5E1";
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 1.5);
      ctx.fill();
    });
  }, [peaks, currentTime, duration, take?.durationSeconds]);

  const handleTogglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || !take) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    }
  };

  const handleSeek = (deltaSeconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const maxTime = audio.duration || duration || 0;
    const next = Math.max(0, Math.min(maxTime, audio.currentTime + deltaSeconds));
    audio.currentTime = next;
    setCurrentTime(next);
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio || !take) return;

    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const maxTime = audio.duration || duration || take.durationSeconds || 0;
    if (maxTime > 0) {
      const targetTime = ratio * maxTime;
      audio.currentTime = targetTime;
      setCurrentTime(targetTime);
    }
  };

  const cycleRate = () => {
    const currentIndex = PLAYBACK_RATES.indexOf(playbackRate);
    const nextRate = PLAYBACK_RATES[(currentIndex + 1) % PLAYBACK_RATES.length];
    setPlaybackRate(nextRate);
  };

  if (isGenerating) {
    return (
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="space-y-1.5">
            <div className="h-4 w-44 bg-slate-200 rounded animate-pulse" />
            <div className="h-3 w-64 bg-slate-100 rounded animate-pulse" />
          </div>
          <div className="h-8 w-28 bg-slate-100 rounded-lg animate-pulse" />
        </div>
        <div className="h-16 w-full bg-slate-100 rounded-lg animate-pulse mb-4" />
        <div className="flex items-center justify-between">
          <div className="h-9 w-36 bg-slate-100 rounded-lg animate-pulse" />
          <div className="h-4 w-24 bg-slate-100 rounded animate-pulse" />
        </div>
      </section>
    );
  }

  if (!take || !take.audioBase64) {
    return (
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {take ? `${take.title} (guion sincronizado)` : "Reproductor maestro"}
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              {take
                ? "El texto y la dirección vocal se cargaron desde tu cuenta. Pulsa «Generar audio» para sintetizar la pista WAV en este dispositivo."
                : "El audio sintetizado aparecerá aquí con forma de onda interactiva y descarga en formato WAV de 24 kHz."}
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-400 whitespace-nowrap shrink-0">
            00:00 / {take ? formatTimecode(take.durationSeconds) : "00:00"}
          </span>
        </div>
      </section>
    );
  }

  const effectiveDuration = duration > 0 ? duration : take.durationSeconds;

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5">
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) {
            setDuration(e.currentTarget.duration);
          }
        }}
        onEnded={() => setIsPlaying(false)}
      />

      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900 truncate">{take.title}</h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
            <span>{take.voiceSummary}</span>
            <span aria-hidden="true">·</span>
            <span>{take.emotionLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {formatTimecode(effectiveDuration)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onToggleFavorite(take.id)}
            aria-label={take.favorite ? "Quitar de favoritos" : "Marcar como favorito"}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              take.favorite
                ? "border-blue-200 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${take.favorite ? "fill-blue-600 text-blue-600" : ""}`} />
            <span>{take.favorite ? "Favorita" : "Guardar"}</span>
          </button>

          <button
            type="button"
            onClick={() =>
              downloadWavBase64(
                take.audioBase64,
                `resonancia-${take.voiceSummary.toLowerCase().replace(/\s+/g, "-")}-${take.id.slice(0, 6)}.wav`,
                take.mimeType
              )
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Descargar WAV</span>
          </button>
        </div>
      </div>

      <div className="py-4">
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          aria-label="Forma de onda del audio generado. Haz clic para adelantar o retroceder."
          className="w-full h-16 cursor-pointer block"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleTogglePlay}
            aria-label={isPlaying ? "Pausar reproducción" : "Reproducir audio"}
            className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer shrink-0"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>

          <button
            type="button"
            onClick={() => handleSeek(-5)}
            aria-label="Retroceder 5 segundos"
            className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="font-mono tabular-nums">-5s</span>
          </button>

          <button
            type="button"
            onClick={() => handleSeek(5)}
            aria-label="Adelantar 5 segundos"
            className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span className="font-mono tabular-nums">+5s</span>
          </button>

          <button
            type="button"
            onClick={cycleRate}
            aria-label="Cambiar velocidad de reproducción"
            className="px-2.5 py-2 text-xs font-mono tabular-nums font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {playbackRate}x
          </button>

          <button
            type="button"
            onClick={() => setIsMuted((prev) => !prev)}
            aria-label={isMuted ? "Activar sonido" : "Silenciar"}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer shrink-0"
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>

        <div className="text-xs font-mono tabular-nums text-slate-600">
          {formatTimecode(currentTime)} <span className="text-slate-400">/</span>{" "}
          {formatTimecode(effectiveDuration)}
        </div>
      </div>
    </section>
  );
};
