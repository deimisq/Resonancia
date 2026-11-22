import React, { useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { parseJsonResponse, ProxySessionExpiredError } from "../lib/apiResponse";

function sanitizeApiKeyInput(raw: string): string {
  let value = raw.trim();
  value = value.replace(/^(?:GEMINI_API_KEY|VITE_GEMINI_API_KEY)\s*=\s*/i, "").trim();
  value = value.replace(/^["'`]+|["'`]+$/g, "").trim();
  value = value.replace(/[\r\n\t\u200B-\u200D\uFEFF]/g, "");
  return value;
}

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentApiKey: string;
  syncSecrets: boolean;
  onSaveApiKey: (key: string, remember: boolean) => void;
  onClearApiKey: () => void;
  getIdToken: () => Promise<string>;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  isOpen,
  onClose,
  currentApiKey,
  syncSecrets,
  onSaveApiKey,
  onClearApiKey,
  getIdToken,
}) => {
  const [remember, setRemember] = useState(syncSecrets);
  const [draftKey, setDraftKey] = useState(currentApiKey);
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const [validationSuccess, setValidationSuccess] = useState(false);

  if (!isOpen) return null;

  const handleValidateAndSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = sanitizeApiKeyInput(draftKey);
    setDraftKey(cleaned);

    if (cleaned.length < 20) {
      setValidationError(
        "La clave API es demasiado corta. Copia la clave completa desde Google AI Studio (suele empezar por AIza...)."
      );
      return;
    }

    if (/\s/.test(cleaned) || !/^[\x21-\x7E]+$/.test(cleaned)) {
      setValidationError(
        "La clave no debe contener espacios ni caracteres especiales. Pega únicamente el valor de tu clave API."
      );
      return;
    }

    setValidationError(null);
    setNeedsReload(false);
    setValidationSuccess(false);
    setIsValidating(true);

    try {
      const token = await getIdToken();
      const response = await fetch("/api/keys/validate", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Firebase-Auth": token,
          "X-Gemini-Key": cleaned,
        },
        body: JSON.stringify({}),
      });

      const data = await parseJsonResponse<{ valid?: boolean; error?: string }>(response);
      if (!response.ok || !data.valid) {
        throw new Error(data.error || "La clave no pudo ser validada con Gemini.");
      }

      onSaveApiKey(cleaned, remember);
      setValidationSuccess(true);
      setTimeout(() => {
        onClose();
      }, 600);
    } catch (error) {
      if (error instanceof ProxySessionExpiredError) {
        setNeedsReload(true);
      }
      setValidationError(
        error instanceof Error ? error.message : "Error al validar la clave API."
      );
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="api-key-modal-title"
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-blue-50 text-blue-700 shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 id="api-key-modal-title" className="text-lg font-semibold text-slate-900">
                Tu clave API de Gemini
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Cada usuario utiliza su propia clave y su propia cuota independiente.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ventana"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 flex items-start gap-2.5 text-xs text-slate-600 leading-relaxed">
          <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
          <span>
            Tu clave nunca se guarda en Firestore ni en servidores externos: permanece aislada en la sesión actual de tu navegador y se envía cifrada por HTTPS solo cuando generas un audio.
          </span>
        </div>

        <form onSubmit={handleValidateAndSave} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="byok-gemini-input"
                className="text-xs font-semibold text-slate-700"
              >
                GEMINI_API_KEY personal
              </label>
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
              >
                <span>Obtener clave en Google AI Studio</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <input
              id="byok-gemini-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draftKey}
              onChange={(e) => {
                setDraftKey(e.target.value);
                setValidationError(null);
              }}
              placeholder="AIzaSy..."
              className="w-full px-3 py-2.5 text-sm font-mono text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          {validationError && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 space-y-2">
              <p>{validationError}</p>
              {needsReload && (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-md transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Recargar página</span>
                </button>
              )}
            </div>
          )}

          {validationSuccess && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Clave verificada y activa para tu sesión.</span>
            </p>
          )}

          <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Recordar en todos mis dispositivos. Se guarda <strong>cifrada</strong> en el servidor
              de Resonancia y se descarta al desmarcar esta opción.
            </span>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
            {currentApiKey ? (
              <button
                type="button"
                onClick={() => {
                  setDraftKey("");
                  onClearApiKey();
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Eliminar de esta sesión</span>
              </button>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isValidating || !draftKey.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-lg transition-colors cursor-pointer"
              >
                {isValidating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isValidating ? "Verificando..." : "Validar y guardar"}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
