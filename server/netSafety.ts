import dns from "dns/promises";
import dnsCb from "dns";
import net from "net";
import { Agent, setGlobalDispatcher } from "undici";

export function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && parts[2] === 0) return true;
  if (a >= 224) return true; // multicast / reserved
  return false;
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const clean = ip.trim().toLowerCase();
  const ver = net.isIP(clean);
  if (ver === 4) {
    return isPrivateOrReservedIpv4(clean);
  }
  if (ver === 6) {
    if (clean === "::" || clean === "::1") return true;
    if (clean.startsWith("fc") || clean.startsWith("fd")) return true; // ULA
    if (clean.startsWith("fe8") || clean.startsWith("fe9") || clean.startsWith("fea") || clean.startsWith("feb")) {
      return true; // link-local
    }
    if (clean.startsWith("::ffff:")) {
      const mapped = clean.slice(7);
      if (net.isIP(mapped) === 4) {
        return isPrivateOrReservedIpv4(mapped);
      }
      // Hex form, e.g. ::ffff:7f00:1 == 127.0.0.1
      const hex = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (hex) {
        const hi = parseInt(hex[1], 16);
        const lo = parseInt(hex[2], 16);
        return isPrivateOrReservedIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
      return true;
    }
    if (clean.startsWith("64:ff9b:")) return true; // NAT64: can embed private IPv4
    return false;
  }
  return true;
}

export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error(
      "Falta la URL del endpoint. Pégala en el campo, o usa la pestaña «Hugging Face Space» si no tienes un endpoint propio."
    );
  }
  if (trimmed.length > 500) {
    throw new Error("La URL del endpoint Open-Source es demasiado larga (máximo 500 caracteres).");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Formato de URL inválido. Debe comenzar por https://");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Por seguridad, solo se permiten endpoints externos con HTTPS (https://...).");
  }

  if (parsed.username || parsed.password) {
    throw new Error("La URL del endpoint no debe incluir credenciales incrustadas.");
  }

  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
    throw new Error("No se permiten direcciones locales ni internas como endpoint.");
  }

  if (net.isIP(host) !== 0) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error("No se permiten direcciones IP privadas o locales.");
    }
    return parsed;
  }

  let records: Array<{ address: string }>;
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    throw new Error("No se pudo resolver el dominio del endpoint indicado. Verifica que la URL siga activa.");
  }

  if (!records || records.length === 0 || records.some((r) => isPrivateOrReservedIp(r.address))) {
    throw new Error("El dominio del endpoint resuelve a una dirección no permitida.");
  }

  return parsed;
}

export async function safeFetchPublic(
  rawUrl: string,
  init: RequestInit & { signal?: AbortSignal } = {},
  maxRedirects = 2
): Promise<globalThis.Response> {
  let currentUrl = await assertSafePublicUrl(rawUrl);
  const initialOrigin = currentUrl.origin;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const nextHeaders = new Headers(init.headers);
    if (currentUrl.origin !== initialOrigin) {
      nextHeaders.delete("authorization");
    }

    const resp = await fetch(currentUrl.toString(), {
      ...init,
      headers: nextHeaders,
      redirect: "manual",
    });

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (!location || hop === maxRedirects) {
        throw new Error("El endpoint devolvió una redirección no permitida.");
      }
      const resolved = new URL(location, currentUrl).toString();
      currentUrl = await assertSafePublicUrl(resolved);
      continue;
    }

    return resp;
  }

  throw new Error("Demasiadas redirecciones en el endpoint externo.");
}

// Resolves and rejects private/reserved addresses at connect time, so DNS rebinding
// between our check and the actual connection (or inside redirects) cannot reach internal hosts.
export function safeLookup(
  hostname: string,
  options: dnsCb.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address?: string | dnsCb.LookupAddress[], family?: number) => void
): void {
  dnsCb.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as dnsCb.LookupAddress[];
    if (list.length === 0 || list.some((a) => isPrivateOrReservedIp(a.address))) {
      return callback(new Error("El dominio resuelve a una dirección no permitida."));
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

// Applies safeLookup to every outbound fetch in the process, including @gradio/client's.
export function installOutboundGuard(): void {
  setGlobalDispatcher(new Agent({ connect: { lookup: safeLookup as never } }));
}
