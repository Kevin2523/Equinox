import { isDevMode } from '@angular/core';

declare global {
  interface Window { __EQUINOX_API_ORIGIN__?: string }
}

function esHostLocalDesarrollo(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.local')) {
    return true;
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function esOrigenHttpPermitido(url: URL, protocoloPagina?: string): boolean {
  if (url.protocol !== 'http:') return false;
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]') {
    return true;
  }
  return protocoloPagina !== 'https:' && esHostLocalDesarrollo(url.hostname);
}

// En despliegues, el host define window.__EQUINOX_API_ORIGIN__ antes del bundle Angular (vía /assets/env.js).
export function resolverOrigenApi(
  host: string,
  configurado?: string,
  protocoloPagina: string | undefined = typeof window !== 'undefined' ? window.location?.protocol : undefined
): string | null {
  if (configurado?.trim()) {
    try {
      const url = new URL(configurado);
      const protocoloValido = url.protocol === 'https:' || esOrigenHttpPermitido(url, protocoloPagina);
      if (!protocoloValido || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        return null;
      }
      return url.origin;
    } catch { return null; }
  }
  if (host === 'localhost') return 'http://localhost:3000';
  return isDevMode() && esHostLocalDesarrollo(host) ? `http://${host}:3000` : null;
}

export const API_ORIGIN = resolverOrigenApi(window.location.hostname, window.__EQUINOX_API_ORIGIN__);

export function obtenerBaseApi(): string {
  if (!API_ORIGIN) throw new Error('API_ORIGIN_NO_CONFIGURADO');
  return `${API_ORIGIN}/api`;
}

export function esPeticionDelOrigenApi(url: string, origenApi: string | null, origenAplicacion: string): boolean {
  if (!origenApi) return false;
  try {
    const destino = new URL(url, origenAplicacion);
    return destino.origin === origenApi && (destino.pathname === '/api' || destino.pathname.startsWith('/api/'));
  } catch { return false; }
}

export function esPeticionApiPropia(url: string): boolean {
  return esPeticionDelOrigenApi(url, API_ORIGIN, window.location.origin);
}
