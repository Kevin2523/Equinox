export const IDIOMAS_SOPORTADOS = ['es', 'en', 'pt'] as const;

export type IdiomaSoportado = (typeof IDIOMAS_SOPORTADOS)[number];

export type CatalogoTraducciones = Record<string, string>;

export interface MetadataIdioma {
  codigo: IdiomaSoportado;
  nombreNativo: string;
  etiquetaCorta: string;
  bcp47: string;
}

export const METADATA_IDIOMAS: Record<IdiomaSoportado, MetadataIdioma> = {
  es: {
    codigo: 'es',
    nombreNativo: 'Español',
    etiquetaCorta: 'ES',
    bcp47: 'es-PA',
  },
  en: {
    codigo: 'en',
    nombreNativo: 'English',
    etiquetaCorta: 'EN',
    bcp47: 'en-US',
  },
  pt: {
    codigo: 'pt',
    nombreNativo: 'Português',
    etiquetaCorta: 'PT',
    bcp47: 'pt-BR',
  },
};

export function esIdiomaSoportado(valor: unknown): valor is IdiomaSoportado {
  return typeof valor === 'string' && (IDIOMAS_SOPORTADOS as readonly string[]).includes(valor);
}

export function normalizarIdioma(
  valor: unknown,
  fallback: IdiomaSoportado = 'es'
): IdiomaSoportado {
  if (typeof valor !== 'string') return fallback;
  const limpio = valor.trim().toLowerCase();
  if (esIdiomaSoportado(limpio)) return limpio;
  const prefijo = limpio.split(/[-_]/)[0];
  if (esIdiomaSoportado(prefijo)) return prefijo;
  return fallback;
}
