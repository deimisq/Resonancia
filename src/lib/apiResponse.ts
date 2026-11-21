export class ProxySessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProxySessionExpiredError";
  }
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  if (!raw.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    const looksLikeHtml = /^\s*</.test(raw);
    if (looksLikeHtml) {
      if (
        response.url.includes("__cookie_check") ||
        raw.includes("<title>Cookie check</title>")
      ) {
        throw new ProxySessionExpiredError(
          "La sesión de vista previa de AI Studio necesita refrescar las cookies del navegador. Recarga la página o abre la aplicación en una pestaña nueva."
        );
      }
      if (raw.includes("<title>Starting Server...</title>")) {
        throw new Error(
          "El servidor se está iniciando. Espera unos segundos e inténtalo nuevamente."
        );
      }
      const titleMatch = raw.match(/<title>([^<]+)<\/title>/i);
      const pageHint = titleMatch?.[1]?.trim() ? ` (${titleMatch[1].trim()})` : "";
      throw new Error(
        `El servidor devolvió una página HTML en lugar de JSON${pageHint} (HTTP ${response.status}). Recarga la página e inténtalo de nuevo.`
      );
    }
    throw new Error(`Respuesta inesperada del servidor (HTTP ${response.status}).`);
  }
}
