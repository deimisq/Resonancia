import React, { useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Cpu,
  ExternalLink,
  Loader2,
  ShieldCheck,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import {
  COLAB_CHATTERBOX_SNIPPET,
  HF_SPACE_PRESETS,
  OpenSourceLanguage,
  OpenSourceModelFamily,
  OpenSourceProtocol,
  OpenSourcePublicConfig,
} from "../types/voice";
import { parseJsonResponse } from "../lib/apiResponse";

interface OpenSourceConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTabEngine: "opensource-hf" | "opensource-endpoint";
  config: OpenSourcePublicConfig;
  hfToken: string;
  endpointToken: string;
  onSaveConfig: (
    nextConfig: OpenSourcePublicConfig,
    nextHfToken: string,
    nextEndpointToken: string,
    activateEngine?: "opensource-hf" | "opensource-endpoint"
  ) => void;
  getIdToken: () => Promise<string>;
}

export const OpenSourceConfigModal: React.FC<OpenSourceConfigModalProps> = ({
  isOpen,
  onClose,
  activeTabEngine,
  config,
  hfToken,
  endpointToken,
  onSaveConfig,
  getIdToken,
}) => {
  const [providerTab, setProviderTab] = useState<"opensource-hf" | "opensource-endpoint">(
    activeTabEngine
  );
  const [draftConfig, setDraftConfig] = useState<OpenSourcePublicConfig>(config);
  const [draftHfToken, setDraftHfToken] = useState<string>(hfToken);
  const [draftEndpointToken, setDraftEndpointToken] = useState<string>(endpointToken);

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showColabGuide, setShowColabGuide] = useState(false);
  const [copiedColab, setCopiedColab] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setProviderTab(activeTabEngine);
    setDraftConfig({
      ...config,
      hfSpaceId:
        config.hfSpaceId === "SWivid/F5-TTS" ? "mrfakename/E2-F5-TTS" : config.hfSpaceId,
    });
    setDraftHfToken(hfToken);
    setDraftEndpointToken(endpointToken);
    setTestResult(null);
  }, [isOpen, activeTabEngine, config, hfToken, endpointToken]);

  if (!isOpen) return null;

  const handleSelectPreset = (spaceId: string, family: OpenSourceModelFamily) => {
    setDraftConfig((prev) => ({
      ...prev,
      hfSpaceId: spaceId,
      hfModelFamily: family,
    }));
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const idToken = await getIdToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Firebase-Auth": idToken,
      };
      if (draftHfToken.trim()) {
        headers["X-HF-Token"] = draftHfToken.trim();
      }
      if (draftEndpointToken.trim()) {
        headers["X-OpenSource-Token"] = draftEndpointToken.trim();
      }

      const resp = await fetch("/api/opensource/test", {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({
          engine: providerTab,
          hfSpaceId: draftConfig.hfSpaceId.trim(),
          endpointUrl: draftConfig.endpointUrl.trim(),
          endpointProtocol: draftConfig.endpointProtocol,
        }),
      });

      const data = await parseJsonResponse<{
        connected?: boolean;
        message?: string;
        error?: string;
      }>(resp);

      if (!resp.ok || !data.connected) {
        throw new Error(data.error || "No se pudo conectar con el motor Open-Source.");
      }

      setTestResult({
        ok: true,
        message: data.message || "Conexión verificada correctamente.",
      });
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : "Error al verificar la conexión.",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleCopyColabSnippet = async () => {
    try {
      await navigator.clipboard.writeText(COLAB_CHATTERBOX_SNIPPET);
      setCopiedColab(true);
      setTimeout(() => setCopiedColab(false), 2000);
    } catch {
      // Fallback ignored if clipboard unavailable
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedConfig: OpenSourcePublicConfig = {
      ...draftConfig,
      hfSpaceId: draftConfig.hfSpaceId.trim() || "ResembleAI/Chatterbox-Multilingual-TTS",
      endpointUrl: draftConfig.endpointUrl.trim(),
    };
    onSaveConfig(
      cleanedConfig,
      draftHfToken.trim(),
      draftEndpointToken.trim(),
      providerTab
    );
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="opensource-modal-title"
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full shadow-lg overflow-hidden my-auto max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-700 shrink-0">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h2 id="opensource-modal-title" className="text-base font-semibold text-slate-900">
                Configurar motores Open-Source (sin hardware propio)
              </h2>
              <p className="text-xs text-slate-500">
                Clonación zero-shot gratuita con Hugging Face Spaces o Google Colab / Endpoint externo.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar configuración Open-Source"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-5 overflow-y-auto flex-1">
          {/* Provider Switcher */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setProviderTab("opensource-hf");
                setTestResult(null);
              }}
              className={`py-2 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                providerTab === "opensource-hf"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Hugging Face Space (Token HF)
            </button>
            <button
              type="button"
              onClick={() => {
                setProviderTab("opensource-endpoint");
                setTestResult(null);
              }}
              className={`py-2 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                providerTab === "opensource-endpoint"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Google Colab / Endpoint HTTPS
            </button>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-start gap-2.5 text-xs text-slate-600 leading-relaxed">
            <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <span>
              Tus tokens personales (<span className="font-mono">hf_...</span> o Bearer) se guardan solo en la sesión actual del navegador (<span className="font-mono">sessionStorage</span>) y nunca se escriben en Firestore.
            </span>
          </div>

          {providerTab === "opensource-hf" ? (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-700">
                    Spaces compatibles recomendados
                  </span>
                  <span className="text-[11px] text-slate-500">ZeroGPU · Gratis con límites</span>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {HF_SPACE_PRESETS.map((preset) => {
                    const isSelected = draftConfig.hfSpaceId.trim() === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleSelectPreset(preset.id, preset.family)}
                        className={`text-left px-3.5 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                          isSelected
                            ? "border-blue-600 bg-blue-50/70"
                            : "border-slate-200 bg-white hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900">
                            {preset.label}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500">
                            {preset.id}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 mt-0.5">{preset.summary}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label
                    htmlFor="hf-space-input"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    ID o URL del Space (puedes usar un Space duplicado propio)
                  </label>
                  <input
                    id="hf-space-input"
                    type="text"
                    value={draftConfig.hfSpaceId}
                    onChange={(e) => {
                      setDraftConfig((prev) => ({ ...prev, hfSpaceId: e.target.value }));
                      setTestResult(null);
                    }}
                    placeholder="ResembleAI/Chatterbox-Multilingual-TTS"
                    className="w-full px-3 py-2 text-xs font-mono text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="os-language-hf"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Idioma objetivo
                  </label>
                  <select
                    id="os-language-hf"
                    value={draftConfig.language}
                    onChange={(e) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        language: e.target.value as OpenSourceLanguage,
                      }))
                    }
                    className="w-full px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 cursor-pointer"
                  >
                    <option value="es">Español (es)</option>
                    <option value="en">Inglés (en)</option>
                    <option value="pt">Portugués (pt)</option>
                    <option value="fr">Francés (fr)</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="hf-token-input"
                    className="text-xs font-semibold text-slate-700"
                  >
                    Token HF personal (opcional en Spaces públicos; usa tipo Read para más cuota ZeroGPU)
                  </label>
                  <a
                    href="https://huggingface.co/settings/tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline shrink-0 ml-2"
                  >
                    <span>Crear token HF gratis</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="hf-token-input"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={draftHfToken}
                    onChange={(e) => {
                      setDraftHfToken(e.target.value);
                      setTestResult(null);
                    }}
                    placeholder="Opcional: hf_... (déjalo vacío para acceso público)"
                    className="flex-1 px-3 py-2 text-xs font-mono text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  />
                  {draftHfToken && (
                    <button
                      type="button"
                      onClick={() => {
                        setDraftHfToken("");
                        setTestResult(null);
                      }}
                      aria-label="Limpiar token HF"
                      className="p-2 text-slate-400 hover:text-red-600 border border-slate-200 rounded-lg cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {draftHfToken.trim() && !draftHfToken.trim().startsWith("hf_") && (
                  <p className="mt-1.5 text-[11px] font-medium text-amber-700">
                    El token de Hugging Face debe comenzar por <span className="font-mono">hf_</span>. Si el Space es público, también puedes dejarlo vacío.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="os-endpoint-url"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  URL HTTPS del servidor Gradio o API REST (Google Colab, Cloudflare Tunnel, etc.)
                </label>
                <input
                  id="os-endpoint-url"
                  type="url"
                  value={draftConfig.endpointUrl}
                  onChange={(e) => {
                    setDraftConfig((prev) => ({ ...prev, endpointUrl: e.target.value }));
                    setTestResult(null);
                  }}
                  placeholder="https://1234567890abcdef.gradio.live"
                  className="w-full px-3 py-2 text-xs font-mono text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="os-protocol-select"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Protocolo
                  </label>
                  <select
                    id="os-protocol-select"
                    value={draftConfig.endpointProtocol}
                    onChange={(e) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        endpointProtocol: e.target.value as OpenSourceProtocol,
                      }))
                    }
                    className="w-full px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 cursor-pointer"
                  >
                    <option value="auto">Auto-detectar</option>
                    <option value="gradio">Gradio (.gradio.live)</option>
                    <option value="rest">API REST JSON</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="os-family-select"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Modelo remoto
                  </label>
                  <select
                    id="os-family-select"
                    value={draftConfig.endpointModelFamily}
                    onChange={(e) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        endpointModelFamily: e.target.value as OpenSourceModelFamily,
                      }))
                    }
                    className="w-full px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 cursor-pointer"
                  >
                    <option value="auto">Auto (Chatterbox / F5)</option>
                    <option value="chatterbox">Chatterbox</option>
                    <option value="f5-tts">F5-TTS</option>
                    <option value="xtts">XTTS-v2</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="os-language-ep"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Idioma objetivo
                  </label>
                  <select
                    id="os-language-ep"
                    value={draftConfig.language}
                    onChange={(e) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        language: e.target.value as OpenSourceLanguage,
                      }))
                    }
                    className="w-full px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 cursor-pointer"
                  >
                    <option value="es">Español (es)</option>
                    <option value="en">Inglés (en)</option>
                    <option value="pt">Portugués (pt)</option>
                    <option value="fr">Francés (fr)</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="os-bearer-input"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Token Bearer opcional (si tu endpoint propio exige autenticación)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="os-bearer-input"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={draftEndpointToken}
                    onChange={(e) => setDraftEndpointToken(e.target.value)}
                    placeholder="Opcional..."
                    className="flex-1 px-3 py-2 text-xs font-mono text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  />
                  {draftEndpointToken && (
                    <button
                      type="button"
                      onClick={() => setDraftEndpointToken("")}
                      aria-label="Limpiar token Bearer"
                      className="p-2 text-slate-400 hover:text-red-600 border border-slate-200 rounded-lg cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Ready-to-run Google Colab T4 snippet */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowColabGuide((prev) => !prev)}
                  className="w-full px-4 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center justify-between text-xs font-semibold text-slate-800 transition-colors cursor-pointer"
                >
                  <span className="inline-flex items-center gap-2">
                    <Code2 className="w-4 h-4 text-blue-600" />
                    <span>¿Cómo levantar tu propio motor gratis en Google Colab (GPU T4)?</span>
                  </span>
                  <span className="text-blue-700">
                    {showColabGuide ? "Ocultar" : "Ver código listo"}
                  </span>
                </button>

                {showColabGuide && (
                  <div className="p-4 space-y-3 border-t border-slate-200 bg-white">
                    <ol className="text-xs text-slate-600 space-y-1 list-decimal list-inside leading-relaxed">
                      <li>
                        Abre{" "}
                        <a
                          href="https://colab.research.google.com/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-700 font-medium hover:underline"
                        >
                          Google Colab
                        </a>{" "}
                        y elige{" "}
                        <strong>Entorno de ejecución → Cambiar tipo → GPU T4</strong> (gratis).
                      </li>
                      <li>Pega y ejecuta este bloque Python en una celda.</li>
                      <li>
                        Copia la URL pública <span className="font-mono">https://...gradio.live</span> que aparece en pantalla y pégala arriba.
                      </li>
                    </ol>

                    <div className="relative">
                      <pre className="text-[11px] leading-relaxed font-mono bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto max-h-48">
                        {COLAB_CHATTERBOX_SNIPPET}
                      </pre>
                      <button
                        type="button"
                        onClick={handleCopyColabSnippet}
                        className="absolute top-2 right-2 inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 rounded-md cursor-pointer"
                      >
                        {copiedColab ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>Copiado</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copiar</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Connection test status */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={
                isTesting ||
                (providerTab === "opensource-hf" && !draftConfig.hfSpaceId.trim()) ||
                (providerTab === "opensource-endpoint" && !draftConfig.endpointUrl.trim())
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
            >
              {isTesting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
              ) : (
                <Wifi className="w-3.5 h-3.5 text-blue-600" />
              )}
              <span>{isTesting ? "Probando conexión..." : "Probar conexión"}</span>
            </button>

            {testResult && (
              <span
                className={`text-xs font-medium flex items-center gap-1.5 ${
                  testResult.ok ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {testResult.ok && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                <span>{testResult.message}</span>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
            >
              Guardar y usar este motor
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
