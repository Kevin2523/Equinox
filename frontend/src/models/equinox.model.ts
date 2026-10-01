export interface Cliente {
  id: string;
  nombre: string;
  empresa: string;
  correo: string;
  telefono: string;
  estado: 'ACTIVO' | 'PROSPECTO' | 'INACTIVO';
  notas?: string;
  proyectosCount?: number;
  totalFacturado?: number;
  avatarColor?: string;
}

export interface Tarea {
  id: string;
  proyectoId: string;
  proyectoNombre?: string;
  titulo: string;
  estado: 'PENDIENTE' | 'EN_PROGRESO' | 'COMPLETADA';
  prioridad: 'BAJA' | 'MEDIA' | 'ALTA' | 'URGENTE';
  fechaVencimiento: string;
  asignadoA?: string;
}

export interface Hito {
  id: string;
  titulo: string;
  estado: 'COMPLETADO' | 'ACTUAL' | 'PENDIENTE';
  fechaObjetivo?: string;
}

export interface Archivo {
  id: string;
  proyectoId: string;
  nombre: string;
  tamano: string;
  tipo: string;
  previewClass: 'brand-file' | 'leaf-file' | 'box-file' | 'doc-file' | 'code-file';
  previewIcon: string;
  fecha: string;
}

export interface Factura {
  id: string;
  numero: string;
  concepto: string;
  clienteId: string;
  clienteNombre: string;
  proyectoId?: string;
  proyectoNombre?: string;
  monto: number;
  montoPendiente: number;
  estado: 'PENDIENTE' | 'PAGADA' | 'VENCIDA' | 'BORRADOR';
  fechaEmision: string;
  fechaVencimiento: string;
  pagadaEn?: string;
}

export interface Comentario {
  id: string;
  proyectoId: string;
  autor: 'FREELANCER' | 'CLIENTE';
  nombreAutor: string;
  avatar: string;
  contenido: string;
  fecha: string;
}

export interface Proyecto {
  id: string;
  key: string;
  nombre: string;
  clienteId: string;
  clienteNombre: string;
  tipo: string;
  descripcion: string;
  progreso: number;
  estado: 'En revisión' | 'En progreso' | 'Por aprobar' | 'Planificación' | 'Completado';
  estadoBadgeClass: 'revision' | 'progreso' | 'aprobar' | 'planificacion' | 'completado';
  presupuesto: number;
  fechaEntrega: string;
  tag: string;
  color: string;
  x: number; // Porcentaje x en el mapa (0 a 100)
  y: number; // Porcentaje y en el mapa (0 a 100)
  visualClass: string; // ej: photo-cafe, visual-building, visual-bahia, etc.
  imagenUrl?: string;
  participantes: { iniciales: string; color?: string }[];
  tareas: Tarea[];
  hitos: Hito[];
  archivos: Archivo[];
  facturas: Factura[];
  comentarios: Comentario[];
  entregaDestacada: {
    fecha: string;
    descripcion: string;
  };
}

export interface Notificacion {
  id: string;
  titulo: string;
  descripcion: string;
  tiempo: string;
  leida: boolean;
  tipo: 'feedback' | 'pago' | 'tarea' | 'proyecto';
}

export interface ConfiguracionEstudio {
  nombreEstudio: string;
  nombreFreelancer: string;
  correo: string;
  telefono: string;
  ruc: string;
  moneda: string;
  colorPrimario: string;
  colorSecundario: string;
  tipografia: string;
  mensajeBienvenida: string;
}
