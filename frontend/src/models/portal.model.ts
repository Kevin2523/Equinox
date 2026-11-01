export interface IdentidadPortal {
  cliente: { id: string; nombre: string; empresa: string | null };
  estudio: {
    nombre: string;
    logoUrl: string | null;
    colorPrimario: string | null;
    colorSecundario: string | null;
    tipografia: string | null;
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
  url: string;
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
