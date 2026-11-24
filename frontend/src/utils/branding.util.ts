export type TipografiaPortal = 'Inter' | 'DM Sans' | 'Manrope';

export interface OpcionTipografiaPortal {
  id: TipografiaPortal;
  label: string;
  descripcion: string;
  descripcionKey: string;
  stack: string;
}

export const TIPOGRAFIAS_PORTAL: OpcionTipografiaPortal[] = [
  {
    id: 'Inter',
    label: 'Inter',
    descripcion: 'Limpia y técnica',
    descripcionKey: 'publico.branding.tipografia.inter',
    stack: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  {
    id: 'DM Sans',
    label: 'DM Sans',
    descripcion: 'Editorial y moderna',
    descripcionKey: 'publico.branding.tipografia.dmSans',
    stack: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  {
    id: 'Manrope',
    label: 'Manrope',
    descripcion: 'Geométrica y expresiva',
    descripcionKey: 'publico.branding.tipografia.manrope',
    stack: "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
];

export const TIPOGRAFIA_PRODUCTO_STACK =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export const COLOR_PRIMARIO_DEFECTO = '#2563EB';
export const COLOR_SECUNDARIO_DEFECTO = '#0F172A';

export function obtenerFontStack(_tipografia?: string | null): string {
  // Tipografía fija del producto independientemente de valores legados en BD.
  return TIPOGRAFIA_PRODUCTO_STACK;
}

export function esHexValido(valor: string | null | undefined): boolean {
  return typeof valor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(valor.trim());
}

export function normalizarHex(valor: string | null | undefined): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  const conHash = limpio.startsWith('#') ? limpio : `#${limpio}`;
  if (!/^#[0-9A-Fa-f]{6}$/.test(conHash)) return null;
  return conHash.toUpperCase();
}

function hexARgb(hex: string): [number, number, number] {
  const limpio = hex.replace('#', '');
  return [
    parseInt(limpio.slice(0, 2), 16),
    parseInt(limpio.slice(2, 4), 16),
    parseInt(limpio.slice(4, 6), 16),
  ];
}

function canalLineal(canal: number): number {
  const srgb = canal / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
}

export function calcularLuminanciaRelativa(hex: string): number {
  const [r, g, b] = hexARgb(hex);
  return 0.2126 * canalLineal(r) + 0.7152 * canalLineal(g) + 0.0722 * canalLineal(b);
}

export function calcularRatioContraste(hexA: string, hexB: string): number {
  const l1 = calcularLuminanciaRelativa(hexA);
  const l2 = calcularLuminanciaRelativa(hexB);
  const mayor = Math.max(l1, l2);
  const menor = Math.min(l1, l2);
  return (mayor + 0.05) / (menor + 0.05);
}

export function colorTextoContraste(fondoHex: string): '#FFFFFF' | '#0F172A' {
  const seguro = normalizarHex(fondoHex) ?? COLOR_SECUNDARIO_DEFECTO;
  const contrasteBlanco = calcularRatioContraste(seguro, '#FFFFFF');
  const contrasteOscuro = calcularRatioContraste(seguro, '#0F172A');
  return contrasteBlanco >= contrasteOscuro ? '#FFFFFF' : '#0F172A';
}

export function colorTextoSecundarioSobreFondo(fondoHex: string): string {
  const principal = colorTextoContraste(fondoHex);
  return principal === '#FFFFFF' ? '#CBD5E1' : '#334155';
}

function rgbAHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

export function ajustarAcentoSobreClaro(primarioHex: string): string {
  const seguro = normalizarHex(primarioHex) ?? COLOR_PRIMARIO_DEFECTO;
  if (calcularRatioContraste(seguro, '#FFFFFF') >= 4.5) {
    return seguro;
  }
  const [r, g, b] = hexARgb(seguro);
  for (let factor = 0.85; factor >= 0.25; factor -= 0.1) {
    const candidato = rgbAHex(r * factor, g * factor, b * factor);
    if (calcularRatioContraste(candidato, '#FFFFFF') >= 4.5) {
      return candidato;
    }
  }
  return '#0F172A';
}

export interface EvaluacionContrastePaleta {
  textoSobrePrimario: '#FFFFFF' | '#0F172A';
  textoPrimarioSobreClaro: string;
  fondoSuavePrimario: string;
  bordeSuavePrimario: string;
  textoSobreSecundario: '#FFFFFF' | '#0F172A';
  textoMutedSobreSecundario: string;
  contrastePrimarioSobreBlanco: number;
  contrasteSecundarioTexto: number;
  advertencias: string[];
}

export function evaluarContrastePaleta(
  primario: string,
  secundario: string,
  traducir?: (key: string) => string
): EvaluacionContrastePaleta {
  const prim = normalizarHex(primario) ?? COLOR_PRIMARIO_DEFECTO;
  const sec = normalizarHex(secundario) ?? COLOR_SECUNDARIO_DEFECTO;
  const [pr, pg, pb] = hexARgb(prim);

  const textoSobrePrimario = colorTextoContraste(prim);
  const textoPrimarioSobreClaro = ajustarAcentoSobreClaro(prim);
  const fondoSuavePrimario = `rgba(${pr}, ${pg}, ${pb}, 0.11)`;
  const bordeSuavePrimario = `rgba(${pr}, ${pg}, ${pb}, 0.28)`;
  const textoSobreSecundario = colorTextoContraste(sec);
  const textoMutedSobreSecundario = colorTextoSecundarioSobreFondo(sec);

  const contrastePrimarioSobreBlanco = calcularRatioContraste(prim, '#FFFFFF');
  const contrasteSecundarioTexto = calcularRatioContraste(sec, textoSobreSecundario);

  const advertencias: string[] = [];
  if (contrastePrimarioSobreBlanco < 3) {
    advertencias.push(
      traducir
        ? traducir('publico.branding.contrastePrimario')
        : 'El color primario es muy claro frente a tarjetas blancas; los indicadores y botones ajustarán su contraste automáticamente.'
    );
  }
  if (contrasteSecundarioTexto < 4.5) {
    advertencias.push(
      traducir
        ? traducir('publico.branding.contrasteSecundario')
        : 'El color secundario tiene contraste ajustado; se seleccionó el tono de texto con mayor legibilidad.'
    );
  }

  return {
    textoSobrePrimario,
    textoPrimarioSobreClaro,
    fondoSuavePrimario,
    bordeSuavePrimario,
    textoSobreSecundario,
    textoMutedSobreSecundario,
    contrastePrimarioSobreBlanco,
    contrasteSecundarioTexto,
    advertencias,
  };
}
