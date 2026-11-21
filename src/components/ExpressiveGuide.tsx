import React from "react";
import { ArrowRight } from "lucide-react";
import { SampleScript, SAMPLE_SCRIPTS } from "../types/voice";

interface ExpressiveGuideProps {
  onApplySample: (sample: SampleScript) => void;
}

const TECHNIQUES = [
  {
    index: "01",
    title: "Respiración antes de una frase clave",
    cue: "<breath>",
    description:
      "Coloca <breath> justo antes de una confesión, un cambio de tema o una pausa emotiva. La voz toma aire de forma audible antes de pronunciar la siguiente palabra.",
    example: "<breath> Nunca te lo dije, pero ese día entendí todo.",
  },
  {
    index: "02",
    title: "Risas breves y sonrisas dentro del texto",
    cue: "<laugh>",
    description:
      "Inserta <laugh> en momentos de complicidad o alivio. Combinado con una dirección actoral que mencione 'sonrisa audible', elimina la rigidez robótica.",
    example: "Pensé que no llegaríamos a tiempo... <laugh> ¡y al final sobraron veinte minutos!",
  },
  {
    index: "03",
    title: "Inhalación de asombro o impacto",
    cue: "<gasp>",
    description:
      "Usa <gasp> cuando el guion revela algo inesperado o emocionante. Aporta un sobresalto orgánico que prepara al oyente.",
    example: "¡Mira quién acaba de entrar por la puerta! <gasp> No puede ser verdad.",
  },
  {
    index: "04",
    title: "Interjecciones naturales en diálogos",
    cue: "|mhm| y |yeah|",
    description:
      "En el modo Diálogo con dos voces, los marcadores |mhm| y |yeah| generan respuestas breves de escucha activa que hacen que la charla suene improvisada.",
    example: "Mateo: |mhm| Sí, totalmente... <breath> yo sentí exactamente lo mismo.",
  },
];

export const ExpressiveGuide: React.FC<ExpressiveGuideProps> = ({ onApplySample }) => {
  return (
    <div className="max-w-[1160px] mx-auto space-y-10">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Guía de dirección vocal y naturalidad
        </h1>
        <p className="text-sm leading-relaxed text-slate-600 mt-2">
          La diferencia entre una lectura sintética y una interpretación humana está en la respiración, el subtexto y la cadencia. Estas técnicas funcionan directamente con el motor expresivo de Resonancia.
        </p>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {TECHNIQUES.map((tech) => (
          <article
            key={tech.index}
            className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between gap-4"
          >
            <div>
              <div className="flex items-center justify-between gap-4 mb-2">
                <span className="text-xs font-mono tabular-nums text-slate-400">
                  {tech.index}. Técnica vocal
                </span>
                <code className="text-xs font-mono text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                  {tech.cue}
                </code>
              </div>
              <h2 className="text-base font-semibold text-slate-900">{tech.title}</h2>
              <p className="text-sm leading-relaxed text-slate-600 mt-2">{tech.description}</p>
            </div>

            <div className="pt-3 border-t border-slate-100">
              <p className="text-xs font-mono text-slate-700 leading-relaxed">{tech.example}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Guiones listos para probar
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Carga cualquiera de estos ejemplos en el estudio para escuchar cómo responden las distintas voces y emociones.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {SAMPLE_SCRIPTS.map((sample) => (
            <div
              key={sample.id}
              className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-semibold text-slate-900 text-sm">{sample.title}</span>
                  <span aria-hidden="true">·</span>
                  <span>Voz {sample.voice}</span>
                </div>
                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{sample.text}</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Dirección: {sample.style}
                </p>
              </div>

              <button
                type="button"
                onClick={() => onApplySample(sample)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer self-start sm:self-center"
              >
                <span>Probar en estudio</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
