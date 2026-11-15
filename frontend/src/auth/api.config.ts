declare global {
  interface Window { __EQUINOX_API_ORIGIN__?: string }
}

// En despliegues, el host define window.__EQUINOX_API_ORIGIN__ antes del bundle Angular.
// Este repositorio no configura un proxy de mismo origen ni un origen de producción.
export function resolverOrigenApi(host: string, configurado?: string): string | null {
  if (configurado?.trim()) {
    try {
      const url = new URL(configurado);
      if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) ||
          url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
      return url.origin;
    } catch { return null; }
  }
  return host === 'localhost' ? 'http://localhost:3000' : null;
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
