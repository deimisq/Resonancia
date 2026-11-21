import React, { useRef, useState } from "react";
import { Plus, Trash2, UserPlus, X } from "lucide-react";
import { DialogueLine, DialogueSpeaker } from "../types/voice";

interface DialogueEditorProps {
  speakers: DialogueSpeaker[];
  lines: DialogueLine[];
  onChangeLines: (lines: DialogueLine[]) => void;
  activeSpeakerIndex: number;
  onSelectActiveSpeaker: (index: number) => void;
  onRenameSpeaker: (index: number, newName: string) => void;
  onAddSpeaker: () => void;
  onRemoveSpeaker: (index: number) => void;
  resolveVoiceLabel?: (voiceName: string) => string;
}

const VOCAL_CUES = [
  { token: "<breath>", label: "Respiro" },
  { token: "<laugh>", label: "Risa" },
  { token: "<gasp>", label: "Suspiro" },
  { token: "|mhm|", label: "Asentir (mhm)" },
  { token: "|yeah|", label: "Sí espontáneo" },
];

export const DialogueEditor: React.FC<DialogueEditorProps> = ({
  speakers,
  lines,
  onChangeLines,
  activeSpeakerIndex,
  onSelectActiveSpeaker,
  onRenameSpeaker,
  onAddSpeaker,
  onRemoveSpeaker,
  resolveVoiceLabel,
}) => {
  const [focusedLineId, setFocusedLineId] = useState<string>(lines[0]?.id || "");
  const inputRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const insertCueIntoLine = (token: string) => {
    const targetId = focusedLineId || lines[lines.length - 1]?.id;
    if (!targetId) return;

    const textarea = inputRefs.current[targetId];
    const line = lines.find((l) => l.id === targetId);
    if (!line) return;

    if (textarea) {
      const start = textarea.selectionStart ?? line.text.length;
      const end = textarea.selectionEnd ?? line.text.length;
      const before = line.text.slice(0, start);
      const after = line.text.slice(end);
      const padLeft = before.length > 0 && !before.endsWith(" ") ? " " : "";
      const padRight = after.length > 0 && !after.startsWith(" ") ? " " : "";
      const nextText = `${before}${padLeft}${token}${padRight}${after}`;

      onChangeLines(
        lines.map((item) => (item.id === targetId ? { ...item, text: nextText } : item))
      );

      requestAnimationFrame(() => {
        textarea.focus();
        const cursor = start + padLeft.length + token.length + padRight.length;
        textarea.setSelectionRange(cursor, cursor);
      });
    } else {
      onChangeLines(
        lines.map((item) =>
          item.id === targetId ? { ...item, text: `${item.text} ${token}`.trim() } : item
        )
      );
    }
  };

  const handleAddLine = () => {
    const lastSpeaker = lines[lines.length - 1]?.speaker;
    const lastIdx = speakers.findIndex((s) => s.speaker === lastSpeaker);
    const nextSpeaker =
      speakers[(lastIdx >= 0 ? lastIdx + 1 : 0) % speakers.length]?.speaker ||
      speakers[0].speaker;
    const newId = `line-${Date.now()}`;
    const updated = [...lines, { id: newId, speaker: nextSpeaker, text: "" }];
    onChangeLines(updated);
    setFocusedLineId(newId);
    requestAnimationFrame(() => {
      inputRefs.current[newId]?.focus();
    });
  };

  const handleDeleteLine = (id: string) => {
    if (lines.length <= 1) return;
    onChangeLines(lines.filter((l) => l.id !== id));
  };

  const handleToggleSpeakerForLine = (lineId: string, speakerName: string) => {
    onChangeLines(
      lines.map((l) => (l.id === lineId ? { ...l, speaker: speakerName } : l))
    );
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Speakers cast header strip */}
      <div className="px-5 py-4 border-b border-slate-100 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-slate-900 text-sm">
              Participantes ({speakers.length})
            </span>
            <span aria-hidden="true">·</span>
            <span>Selecciona una persona para ajustar su voz y emoción a la derecha</span>
          </div>

          <button
            type="button"
            onClick={onAddSpeaker}
            disabled={speakers.length >= 8}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Agregar persona</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {speakers.map((spk, idx) => {
            const isSelected = activeSpeakerIndex === idx;
            return (
              <div
                key={idx}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors ${
                  isSelected
                    ? "border-blue-600 bg-blue-50/70"
                    : "border-slate-200 bg-slate-50"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectActiveSpeaker(idx)}
                  className="text-xs font-mono tabular-nums font-medium text-slate-500 hover:text-slate-900 whitespace-nowrap cursor-pointer"
                >
                  {String(idx + 1).padStart(2, "0")}
                </button>
                <input
                  type="text"
                  value={spk.speaker}
                  maxLength={24}
                  onFocus={() => onSelectActiveSpeaker(idx)}
                  onChange={(e) => onRenameSpeaker(idx, e.target.value)}
                  aria-label={`Nombre del participante ${idx + 1}`}
                  className="w-24 text-xs font-semibold text-slate-900 bg-transparent border-b border-transparent focus:border-blue-600 focus:outline-none"
                />
                <span className="text-xs text-slate-400" aria-hidden="true">
                  ·
                </span>
                <button
                  type="button"
                  onClick={() => onSelectActiveSpeaker(idx)}
                  className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap cursor-pointer"
                >
                  {resolveVoiceLabel ? resolveVoiceLabel(spk.voiceName) : spk.voiceName}
                </button>

                {speakers.length > 2 && (
                  <button
                    type="button"
                    onClick={() => onRemoveSpeaker(idx)}
                    aria-label={`Quitar a ${spk.speaker}`}
                    className="p-0.5 text-slate-400 hover:text-red-600 transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Expressive Cue Toolbar */}
      <div className="px-5 py-2.5 bg-slate-50/70 border-b border-slate-100 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500 mr-1">Insertar matiz:</span>
        {VOCAL_CUES.map((cue) => (
          <button
            key={cue.token}
            type="button"
            onClick={() => insertCueIntoLine(cue.token)}
            className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 hover:text-slate-900 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            + {cue.label}
          </button>
        ))}
      </div>

      {/* Dialogue Lines */}
      <div className="divide-y divide-slate-100">
        {lines.map((line, idx) => (
          <div key={line.id} className="px-5 py-3.5 flex items-start gap-3 group">
            <div className="flex flex-col gap-1.5 pt-1 shrink-0">
              <span className="text-[11px] font-mono tabular-nums text-slate-400">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <select
                value={line.speaker}
                onChange={(e) => handleToggleSpeakerForLine(line.id, e.target.value)}
                aria-label={`Locutor de la línea ${idx + 1}`}
                className="text-xs font-semibold text-slate-800 bg-slate-100 border border-slate-200 rounded-md px-2 py-1 max-w-[128px] focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 cursor-pointer"
              >
                {speakers.map((s, sIdx) => (
                  <option key={sIdx} value={s.speaker}>
                    {s.speaker}
                  </option>
                ))}
              </select>
            </div>

            <textarea
              ref={(el) => {
                inputRefs.current[line.id] = el;
              }}
              rows={2}
              value={line.text}
              onFocus={() => {
                setFocusedLineId(line.id);
                const spkIdx = speakers.findIndex((s) => s.speaker === line.speaker);
                if (spkIdx !== -1) onSelectActiveSpeaker(spkIdx);
              }}
              onChange={(e) =>
                onChangeLines(
                  lines.map((item) =>
                    item.id === line.id ? { ...item, text: e.target.value } : item
                  )
                )
              }
              placeholder={`Escribe la intervención de ${line.speaker}...`}
              className="flex-1 text-sm leading-relaxed text-slate-900 bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-600 focus:bg-slate-50/40 rounded-lg px-3 py-1.5 focus:outline-none resize-y"
            />

            <button
              type="button"
              onClick={() => handleDeleteLine(line.id)}
              disabled={lines.length <= 1}
              aria-label="Eliminar turno de diálogo"
              className="p-2 text-slate-400 hover:text-red-600 rounded-lg transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Add Line Footer */}
      <div className="px-5 py-3 bg-slate-50/60 border-t border-slate-100 flex items-center justify-between">
        <button
          type="button"
          onClick={handleAddLine}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Agregar intervención</span>
        </button>

        <span className="text-xs font-mono tabular-nums text-slate-500">
          {lines.length} {lines.length === 1 ? "turno" : "turnos"}
        </span>
      </div>
    </div>
  );
};
