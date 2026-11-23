export type TipoFreelance = 'GENERAL' | 'DESARROLLO_SOFTWARE' | 'DISENO_GRAFICO' | 'FOTOGRAFIA';

export interface IdentidadPortal {
  cliente: { id: string; nombre: string; empresa: string | null };
  estudio: {
    nombre: string;
    logoUrl: string | null;
    colorPrimario: string | null;
    colorSecundario: string | null;
    tipografia: string | null;
    portalMensajeBienvenida?: string | null;
    tipoFreelance?: TipoFreelance | string | null;
  };
}

export interface ProyectoPortal {
  id: string;
  nombre: string;
  descripcion: string | null;
  estado: string;
  fechaInicio: string | null;
  fechaEntrega: string | null;
}

export interface HitoPortal {
  id: string;
  titulo: string;
  descripcion: string | null;
  estado: 'PENDIENTE' | 'EN_PROGRESO' | 'COMPLETADO' | 'VENCIDO';
  orden: number;
  fechaObjetivo: string | null;
  completadoEn: string | null;
}

export interface ArchivoPortal {
  id: string;
  nombre: string;
  descripcion: string | null;
  nombreOriginal: string;
  tipoMime: string;
  tamanoBytes: number;
  tipo: 'ARCHIVO' | 'ENTREGABLE' | 'IMAGEN' | 'DOCUMENTO';
  publicadoEn: string | null;
}

export interface ComentarioPortal {
  id: string;
  autor: 'FREELANCER' | 'CLIENTE';
  contenido: string;
  creadoEn: string;
  usuario: { nombre: string; apellido: string | null } | null;
}

export interface FacturaPortal {
  id: string;
  proyectoId: string | null;
  numero: string;
  concepto: string;
  monto: string | number;
  moneda: string;
  estado: 'ENVIADA' | 'PAGADA' | 'VENCIDA';
  fechaEmision: string;
  fechaVencimiento: string | null;
  pagadaEn: string | null;
}

export interface SesionFotograficaPortal {
  id: string;
  nombre?: string;
  titulo?: string;
  descripcion?: string | null;
  fecha?: string | null;
  fechaSesion?: string | null;
  lugar?: string | null;
  ubicacion?: string | null;
  estado?: string;
  totalFotos?: number;
  cantidadFotos?: number;
  portadaFotoId?: string | null;
  portadaUrl?: string | null;
  creadoEn?: string;
  actualizadoEn?: string;
}

export interface FotoPortal {
  id: string;
  sesionId?: string;
  nombre?: string;
  nombreOriginal?: string;
  titulo?: string;
  descripcion?: string | null;
  tamanoBytes?: number;
  tipoMime?: string;
  orden?: number;
  esPortada?: boolean;
  ancho?: number | null;
  alto?: number | null;
  creadoEn?: string;
}

export interface PaginaFotosPortal {
  items: FotoPortal[];
  total: number;
  pagina: number;
  limite: number;
}
