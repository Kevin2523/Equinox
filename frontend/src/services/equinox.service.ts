import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  Cliente,
  Proyecto,
  Tarea,
  Factura,
  ConfiguracionEstudio,
  Notificacion,
  Comentario,
  Archivo
} from '../models/equinox.model';

const STORAGE_KEY = 'equinox_state_v1';

@Injectable({
  providedIn: 'root'
})
export class EquinoxService {
  private clientesSubject = new BehaviorSubject<Cliente[]>([]);
  private proyectosSubject = new BehaviorSubject<Proyecto[]>([]);
  private configuracionSubject = new BehaviorSubject<ConfiguracionEstudio>({
    nombreEstudio: 'Mena Studios',
    nombreFreelancer: 'Kevin Mena',
    correo: 'kevin@menastudios.pa',
    telefono: '+507 6890-4421',
    ruc: '8-834-1928 DV 44',
    moneda: 'B/. (PAB)',
    colorPrimario: '#3568f6',
    colorSecundario: '#09142e',
    tipografia: 'DM Sans',
    mensajeBienvenida: 'Ideas claras. Resultados reales. Bienvenidos a tu portal exclusivo de entregables.'
  });
  private notificacionesSubject = new BehaviorSubject<Notificacion[]>([]);
  private proyectoSeleccionadoSubject = new BehaviorSubject<Proyecto | null>(null);
  private toastSubject = new BehaviorSubject<string>('');

  clientes$ = this.clientesSubject.asObservable();
  proyectos$ = this.proyectosSubject.asObservable();
  configuracion$ = this.configuracionSubject.asObservable();
  notificaciones$ = this.notificacionesSubject.asObservable();
  proyectoSeleccionado$ = this.proyectoSeleccionadoSubject.asObservable();
  toast$ = this.toastSubject.asObservable();

  constructor() {
    this.cargarDatosIniciales();
  }

  get clientes(): Cliente[] {
    return this.clientesSubject.getValue();
  }

  get proyectos(): Proyecto[] {
    return this.proyectosSubject.getValue();
  }

  get configuracion(): ConfiguracionEstudio {
    return this.configuracionSubject.getValue();
  }

  get notificaciones(): Notificacion[] {
    return this.notificacionesSubject.getValue();
  }

  get proyectoSeleccionado(): Proyecto | null {
    return this.proyectoSeleccionadoSubject.getValue();
  }

  private cargarDatosIniciales() {
    const guardado = localStorage.getItem(STORAGE_KEY);
    if (guardado) {
      try {
        const datos = JSON.parse(guardado);
        if (datos.proyectos && datos.clientes) {
          this.clientesSubject.next(datos.clientes);
          this.proyectosSubject.next(datos.proyectos);
          if (datos.configuracion) this.configuracionSubject.next(datos.configuracion);
          if (datos.notificaciones) this.notificacionesSubject.next(datos.notificaciones);
          const sel = datos.proyectos.find((p: Proyecto) => p.key === 'cafe') || datos.proyectos[0];
          this.proyectoSeleccionadoSubject.next(sel);
          return;
        }
      } catch (e) {
        console.warn('Error al leer caché local de Equinox', e);
      }
    }

    // Datos maestros iniciales fieles al prototipo y a la realidad panameña
    const clientesIniciales: Cliente[] = [
      {
        id: 'c-1',
        nombre: 'Ana Rodríguez',
        empresa: 'Café Unido S.A.',
        correo: 'ana.rodriguez@cafeunido.com',
        telefono: '+507 6231-8910',
        estado: 'ACTIVO',
        notas: 'Cliente clave para expansión de franquicias en Casco Antiguo y Costa del Este.',
        proyectosCount: 1,
        totalFacturado: 4500,
        avatarColor: '#b48c62'
      },
      {
        id: 'c-2',
        nombre: 'Carlos Castillo',
        empresa: 'Istmo Digital Corp',
        correo: 'carlos@istmodigital.pa',
        telefono: '+507 6412-3390',
        estado: 'ACTIVO',
        notas: 'Agencia de software aliada. Requerimientos de arquitectura web.',
        proyectosCount: 1,
        totalFacturado: 2800,
        avatarColor: '#53647a'
      },
      {
        id: 'c-3',
        nombre: 'Sofía González',
        empresa: 'Studio Bahía Arquitectura',
        correo: 'sgonzalez@studiobahia.com',
        telefono: '+507 6789-0123',
        estado: 'ACTIVO',
        notas: 'Rebranding completo e identidad visual para portafolio de lujo.',
        proyectosCount: 1,
        totalFacturado: 3400,
        avatarColor: '#96c6d5'
      },
      {
        id: 'c-4',
        nombre: 'Juan Pérez',
        empresa: 'Taller Pacora Repuestos',
        correo: 'juan.perez@tallerpacora.pa',
        telefono: '+507 6554-1298',
        estado: 'ACTIVO',
        notas: 'Estrategia y pauta de redes sociales para repuestos automotrices.',
        proyectosCount: 1,
        totalFacturado: 1200,
        avatarColor: '#7b8792'
      },
      {
        id: 'c-5',
        nombre: 'María Bernal',
        empresa: 'Brisa Marina Lifestyle',
        correo: 'mbernal@brisamarina.pa',
        telefono: '+507 6901-4472',
        estado: 'ACTIVO',
        notas: 'Campaña de temporada de verano y piezas para pauta digital.',
        proyectosCount: 1,
        totalFacturado: 1950,
        avatarColor: '#23608a'
      },
      {
        id: 'c-6',
        nombre: 'Daniel Vega',
        empresa: 'Nómada Labs',
        correo: 'dvega@nomadalabs.tech',
        telefono: '+507 6382-7711',
        estado: 'PROSPECTO',
        notas: 'Consultoría estratégica de producto digital y descubrimiento.',
        proyectosCount: 1,
        totalFacturado: 1600,
        avatarColor: '#5b8667'
      },
      {
        id: 'c-7',
        nombre: 'Valeria Ruiz',
        empresa: 'Mercado Local Panamá',
        correo: 'vruiz@mercadolocal.pa',
        telefono: '+507 6112-9904',
        estado: 'ACTIVO',
        notas: 'Plataforma e-commerce para productores locales panameños.',
        proyectosCount: 1,
        totalFacturado: 2200,
        avatarColor: '#9c7355'
      },
      {
        id: 'c-8',
        nombre: 'Carmen Guerra',
        empresa: 'Selva Viva Expeditions',
        correo: 'carmen@selvaviva.pa',
        telefono: '+507 6445-8820',
        estado: 'ACTIVO',
        notas: 'Ecoturismo en Darién y Bocas del Toro. Producción de contenido editorial.',
        proyectosCount: 1,
        totalFacturado: 1500,
        avatarColor: '#24543b'
      }
    ];

    const proyectosIniciales: Proyecto[] = [
      {
        id: 'p-1',
        key: 'cafe',
        nombre: 'Café Unido',
        clienteId: 'c-1',
        clienteNombre: 'Ana Rodríguez',
        tipo: 'Branding & Web',
        descripcion: 'Rediseño integral de la identidad corporativa y portal web interactivo para las sucursales de Panamá.',
        progreso: 72,
        estado: 'En revisión',
        estadoBadgeClass: 'revision',
        presupuesto: 4500,
        fechaEntrega: '15 de abril de 2026',
        tag: 'CU',
        color: '#b48c62',
        x: 45,
        y: 40,
        visualClass: 'photo-cafe',
        imagenUrl: 'assets/cafe-unido.png',
        participantes: [
          { iniciales: 'KM', color: '#273559' },
          { iniciales: 'AR', color: '#7a55d8' },
          { iniciales: 'SG', color: '#ed7b4f' }
        ],
        tareas: [
          { id: 't-1', proyectoId: 'p-1', proyectoNombre: 'Café Unido', titulo: 'Aprobar estructura del sitio', estado: 'PENDIENTE', prioridad: 'ALTA', fechaVencimiento: '10 abr 2026' },
          { id: 't-2', proyectoId: 'p-1', proyectoNombre: 'Café Unido', titulo: 'Preparar prototipo de inicio', estado: 'COMPLETADA', prioridad: 'MEDIA', fechaVencimiento: '8 abr 2026' },
          { id: 't-3', proyectoId: 'p-1', proyectoNombre: 'Café Unido', titulo: 'Revisar textos finales en español', estado: 'PENDIENTE', prioridad: 'URGENTE', fechaVencimiento: '12 abr 2026' },
          { id: 't-4', proyectoId: 'p-1', proyectoNombre: 'Café Unido', titulo: 'Optimizar imágenes del menú gastronómico', estado: 'PENDIENTE', prioridad: 'MEDIA', fechaVencimiento: '14 abr 2026' }
        ],
        hitos: [
          { id: 'h-1', titulo: 'Estrategia de marca', estado: 'COMPLETADO' },
          { id: 'h-2', titulo: 'Dirección creativa', estado: 'COMPLETADO' },
          { id: 'h-3', titulo: 'Diseño web', estado: 'ACTUAL' },
          { id: 'h-4', titulo: 'Lanzamiento', estado: 'PENDIENTE' }
        ],
        archivos: [
          { id: 'a-1', proyectoId: 'p-1', nombre: 'Identidad.pdf', tamano: '2.4 MB', tipo: 'PDF', previewClass: 'brand-file', previewIcon: 'CU', fecha: '28 mar' },
          { id: 'a-2', proyectoId: 'p-1', nombre: 'Homepage.fig', tamano: '12.1 MB', tipo: 'Figma', previewClass: 'leaf-file', previewIcon: '✦', fecha: '02 abr' },
          { id: 'a-3', proyectoId: 'p-1', nombre: 'Mockups.zip', tamano: '8.7 MB', tipo: 'ZIP', previewClass: 'box-file', previewIcon: '▣', fecha: '04 abr' },
          { id: 'a-4', proyectoId: 'p-1', nombre: 'Propuesta_v3.pdf', tamano: '1.1 MB', tipo: 'PDF', previewClass: 'doc-file', previewIcon: '≡', fecha: '05 abr' }
        ],
        facturas: [
          {
            id: 'f-1',
            numero: 'INV-2026-001',
            concepto: 'Anticipo 50% Branding y Arquitectura Web Café Unido',
            clienteId: 'c-1',
            clienteNombre: 'Ana Rodríguez',
            proyectoId: 'p-1',
            proyectoNombre: 'Café Unido',
            monto: 2250,
            montoPendiente: 0,
            estado: 'PAGADA',
            fechaEmision: '15 mar 2026',
            fechaVencimiento: '30 mar 2026',
            pagadaEn: '25 mar 2026'
          },
          {
            id: 'f-2',
            numero: 'INV-2026-002',
            concepto: 'Saldo final 50% Entrega y Puesta en Producción',
            clienteId: 'c-1',
            clienteNombre: 'Ana Rodríguez',
            proyectoId: 'p-1',
            proyectoNombre: 'Café Unido',
            monto: 2250,
            montoPendiente: 1250,
            estado: 'PENDIENTE',
            fechaEmision: '01 abr 2026',
            fechaVencimiento: '18 abr 2026'
          }
        ],
        comentarios: [
          {
            id: 'cm-1',
            proyectoId: 'p-1',
            autor: 'CLIENTE',
            nombreAutor: 'Ana Rodríguez',
            avatar: 'AR',
            contenido: 'Nos encanta la paleta de colores café y crema. Quedamos atentos al prototipo móvil interactivo.',
            fecha: 'Hace 12 minutos'
          },
          {
            id: 'cm-2',
            proyectoId: 'p-1',
            autor: 'FREELANCER',
            nombreAutor: 'Kevin Mena',
            avatar: 'KM',
            contenido: '¡Excelente! Acabamos de subir los mockups actualizados en la pestaña de archivos para su revisión.',
            fecha: 'Hace 5 minutos'
          }
        ],
        entregaDestacada: {
          fecha: '15 de abril de 2026',
          descripcion: 'Entrega de propuesta final y manual de estilo'
        }
      },
      {
        id: 'p-2',
        key: 'istmo',
        nombre: 'Istmo Digital',
        clienteId: 'c-2',
        clienteNombre: 'Carlos Castillo',
        tipo: 'Sitio web',
        descripcion: 'Portal institucional y sistema de captación B2B para consultoría de transformación tecnológica.',
        progreso: 54,
        estado: 'En progreso',
        estadoBadgeClass: 'progreso',
        presupuesto: 2800,
        fechaEntrega: '22 de abril de 2026',
        tag: 'ID',
        color: '#637a91',
        x: 16,
        y: 17,
        visualClass: 'visual-building',
        participantes: [
          { iniciales: 'ID', color: '#09142e' },
          { iniciales: 'AC', color: '#3568f6' },
          { iniciales: '+1', color: '#536078' }
        ],
        tareas: [
          { id: 't-5', proyectoId: 'p-2', proyectoNombre: 'Istmo Digital', titulo: 'Definir arquitectura de micro-servicios', estado: 'COMPLETADA', prioridad: 'ALTA', fechaVencimiento: '02 abr 2026' },
          { id: 't-6', proyectoId: 'p-2', proyectoNombre: 'Istmo Digital', titulo: 'Crear sistema visual de componentes', estado: 'PENDIENTE', prioridad: 'URGENTE', fechaVencimiento: '14 abr 2026' },
          { id: 't-7', proyectoId: 'p-2', proyectoNombre: 'Istmo Digital', titulo: 'Conectar formulario con API de CRM', estado: 'PENDIENTE', prioridad: 'MEDIA', fechaVencimiento: '20 abr 2026' }
        ],
        hitos: [
          { id: 'h-5', titulo: 'Estructura técnica', estado: 'COMPLETADO' },
          { id: 'h-6', titulo: 'Wireframes UX', estado: 'COMPLETADO' },
          { id: 'h-7', titulo: 'Desarrollo frontend', estado: 'ACTUAL' },
          { id: 'h-8', titulo: 'Despliegue QA', estado: 'PENDIENTE' }
        ],
        archivos: [
          { id: 'a-5', proyectoId: 'p-2', nombre: 'Brief_Istmo.pdf', tamano: '1.8 MB', tipo: 'PDF', previewClass: 'doc-file', previewIcon: '≡', fecha: '20 mar' },
          { id: 'a-6', proyectoId: 'p-2', nombre: 'Wireframes.fig', tamano: '14.5 MB', tipo: 'Figma', previewClass: 'leaf-file', previewIcon: '✦', fecha: '29 mar' }
        ],
        facturas: [
          {
            id: 'f-3',
            numero: 'INV-2026-003',
            concepto: 'Desarrollo Web Istmo Digital - Hito 1',
            clienteId: 'c-2',
            clienteNombre: 'Carlos Castillo',
            proyectoId: 'p-2',
            proyectoNombre: 'Istmo Digital',
            monto: 1400,
            montoPendiente: 0,
            estado: 'PAGADA',
            fechaEmision: '20 mar 2026',
            fechaVencimiento: '05 abr 2026',
            pagadaEn: '02 abr 2026'
          }
        ],
        comentarios: [
          {
            id: 'cm-3',
            proyectoId: 'p-2',
            autor: 'CLIENTE',
            nombreAutor: 'Carlos Castillo',
            avatar: 'CC',
            contenido: 'Los wireframes lucen muy sólidos. Por favor validar la velocidad de carga en móvil.',
            fecha: 'Ayer a las 4:30 pm'
          }
        ],
        entregaDestacada: {
          fecha: '22 de abril de 2026',
          descripcion: 'Entrega de versión beta con CMS conectado'
        }
      },
      {
        id: 'p-3',
        key: 'bahia',
        nombre: 'Studio Bahía',
        clienteId: 'c-3',
        clienteNombre: 'Sofía González',
        tipo: 'Identidad visual',
        descripcion: 'Sistema de marca arquitectónica de alto standing en Punta Pacífica y Santa María.',
        progreso: 81,
        estado: 'Por aprobar',
        estadoBadgeClass: 'aprobar',
        presupuesto: 3400,
        fechaEntrega: '18 de abril de 2026',
        tag: 'SB',
        color: '#79b7ca',
        x: 87,
        y: 15,
        visualClass: 'visual-bahia',
        participantes: [
          { iniciales: 'SG', color: '#7a55d8' },
          { iniciales: 'LM', color: '#38bb83' },
          { iniciales: '+2', color: '#536078' }
        ],
        tareas: [
          { id: 't-8', proyectoId: 'p-3', proyectoNombre: 'Studio Bahía', titulo: 'Enviar arte final para papelería corporativa', estado: 'COMPLETADA', prioridad: 'ALTA', fechaVencimiento: '05 abr 2026' },
          { id: 't-9', proyectoId: 'p-3', proyectoNombre: 'Studio Bahía', titulo: 'Registrar aprobación de junta directiva', estado: 'PENDIENTE', prioridad: 'URGENTE', fechaVencimiento: '18 abr 2026' }
        ],
        hitos: [
          { id: 'h-9', titulo: 'Moodboard y concepto', estado: 'COMPLETADO' },
          { id: 'h-10', titulo: 'Diseño de logotipo', estado: 'COMPLETADO' },
          { id: 'h-11', titulo: 'Aplicaciones de marca', estado: 'ACTUAL' },
          { id: 'h-12', titulo: 'Manual de marca final', estado: 'PENDIENTE' }
        ],
        archivos: [
          { id: 'a-7', proyectoId: 'p-3', nombre: 'Logo_Vectorial.svg', tamano: '840 KB', tipo: 'SVG', previewClass: 'brand-file', previewIcon: 'SB', fecha: '25 mar' },
          { id: 'a-8', proyectoId: 'p-3', nombre: 'Manual_Identidad.pdf', tamano: '19.2 MB', tipo: 'PDF', previewClass: 'doc-file', previewIcon: '≡', fecha: '04 abr' }
        ],
        facturas: [
          {
            id: 'f-4',
            numero: 'INV-2026-004',
            concepto: 'Fase 2 Identidad Visual Studio Bahía',
            clienteId: 'c-3',
            clienteNombre: 'Sofía González',
            proyectoId: 'p-3',
            proyectoNombre: 'Studio Bahía',
            monto: 1700,
            montoPendiente: 1700,
            estado: 'PENDIENTE',
            fechaEmision: '01 abr 2026',
            fechaVencimiento: '20 abr 2026'
          }
        ],
        comentarios: [
          {
            id: 'cm-4',
            proyectoId: 'p-3',
            autor: 'CLIENTE',
            nombreAutor: 'Sofía González',
            avatar: 'SG',
            contenido: '¡Quedó espectacular la tipografía con remates finos! Mañana lo presentamos a socios.',
            fecha: 'Hace 2 horas'
          }
        ],
        entregaDestacada: {
          fecha: '18 de abril de 2026',
          descripcion: 'Firma de aprobación de manual y entrega de vectoriales'
        }
      },
      {
        id: 'p-4',
        key: 'taller',
        nombre: 'Taller Pacora',
        clienteId: 'c-4',
        clienteNombre: 'Juan Pérez',
        tipo: 'Redes sociales',
        descripcion: 'Parrilla mensual de contenidos, reels de servicio técnico y pauta en Meta Ads.',
        progreso: 38,
        estado: 'En progreso',
        estadoBadgeClass: 'progreso',
        presupuesto: 1200,
        fechaEntrega: '30 de abril de 2026',
        tag: 'TP',
        color: '#7b8792',
        x: 5,
        y: 47,
        visualClass: 'visual-taller',
        participantes: [{ iniciales: 'JP', color: '#09142e' }],
        tareas: [
          { id: 't-10', proyectoId: 'p-4', proyectoNombre: 'Taller Pacora', titulo: 'Calendario de contenidos del mes de mayo', estado: 'PENDIENTE', prioridad: 'ALTA', fechaVencimiento: '16 abr 2026' },
          { id: 't-11', proyectoId: 'p-4', proyectoNombre: 'Taller Pacora', titulo: 'Diseño de carruseles de mantenimiento preventivo', estado: 'PENDIENTE', prioridad: 'MEDIA', fechaVencimiento: '24 abr 2026' }
        ],
        hitos: [
          { id: 'h-13', titulo: 'Estrategia mensual', estado: 'COMPLETADO' },
          { id: 'h-14', titulo: 'Producción de piezas', estado: 'ACTUAL' },
          { id: 'h-15', titulo: 'Lanzamiento de pauta', estado: 'PENDIENTE' }
        ],
        archivos: [
          { id: 'a-9', proyectoId: 'p-4', nombre: 'Calendario_Mayo.xlsx', tamano: '450 KB', tipo: 'XLSX', previewClass: 'box-file', previewIcon: '▣', fecha: '01 abr' }
        ],
        facturas: [
          {
            id: 'f-5',
            numero: 'INV-2026-005',
            concepto: 'Fee mensual Gestión Social Media Taller Pacora',
            clienteId: 'c-4',
            clienteNombre: 'Juan Pérez',
            proyectoId: 'p-4',
            proyectoNombre: 'Taller Pacora',
            monto: 600,
            montoPendiente: 600,
            estado: 'PENDIENTE',
            fechaEmision: '01 abr 2026',
            fechaVencimiento: '15 abr 2026'
          }
        ],
        comentarios: [],
        entregaDestacada: {
          fecha: '30 de abril de 2026',
          descripcion: 'Reporte de métricas mensuales y alcance'
        }
      },
      {
        id: 'p-5',
        key: 'brisa',
        nombre: 'Brisa Marina',
        clienteId: 'c-5',
        clienteNombre: 'María Bernal',
        tipo: 'Campaña',
        descripcion: 'Campaña publicitaria multicanal de verano: vallas en Vía España y anuncios digitales.',
        progreso: 64,
        estado: 'En revisión',
        estadoBadgeClass: 'revision',
        presupuesto: 1950,
        fechaEntrega: '25 de abril de 2026',
        tag: 'BM',
        color: '#23608a',
        x: 17,
        y: 82,
        visualClass: 'visual-ocean',
        participantes: [
          { iniciales: 'MB', color: '#23608a' },
          { iniciales: 'AR', color: '#7a55d8' }
        ],
        tareas: [
          { id: 't-12', proyectoId: 'p-5', proyectoNombre: 'Brisa Marina', titulo: 'Ajustar piezas de pauta para Instagram Stories', estado: 'COMPLETADA', prioridad: 'ALTA', fechaVencimiento: '04 abr 2026' },
          { id: 't-13', proyectoId: 'p-5', proyectoNombre: 'Brisa Marina', titulo: 'Entregar originales a imprenta de gran formato', estado: 'PENDIENTE', prioridad: 'URGENTE', fechaVencimiento: '11 abr 2026' }
        ],
        hitos: [
          { id: 'h-16', titulo: 'Concepto publicitario', estado: 'COMPLETADO' },
          { id: 'h-17', titulo: 'Adaptaciones gráficas', estado: 'ACTUAL' },
          { id: 'h-18', titulo: 'Revisión con medios', estado: 'PENDIENTE' }
        ],
        archivos: [
          { id: 'a-10', proyectoId: 'p-5', nombre: 'Artes_Campana.pdf', tamano: '28.4 MB', tipo: 'PDF', previewClass: 'doc-file', previewIcon: '≡', fecha: '03 abr' }
        ],
        facturas: [],
        comentarios: [
          {
            id: 'cm-5',
            proyectoId: 'p-5',
            autor: 'CLIENTE',
            nombreAutor: 'María Bernal',
            avatar: 'MB',
            contenido: 'Los colores del mar resaltan excelente en la prueba de color.',
            fecha: 'Hace 3 días'
          }
        ],
        entregaDestacada: {
          fecha: '25 de abril de 2026',
          descripcion: 'Entrega de material a central de medios'
        }
      },
      {
        id: 'p-6',
        key: 'nomada',
        nombre: 'Nómada Labs',
        clienteId: 'c-6',
        clienteNombre: 'Daniel Vega',
        tipo: 'Estrategia',
        descripcion: 'Definición de propuesta de valor y modelo de monetización SaaS para nómadas digitales.',
        progreso: 43,
        estado: 'Planificación',
        estadoBadgeClass: 'planificacion',
        presupuesto: 1600,
        fechaEntrega: '2 de mayo de 2026',
        tag: 'NL',
        color: '#668970',
        x: 92,
        y: 43,
        visualClass: 'visual-plant',
        participantes: [{ iniciales: 'DV', color: '#5b8667' }],
        tareas: [
          { id: 't-14', proyectoId: 'p-6', proyectoNombre: 'Nómada Labs', titulo: 'Agendar taller de descubrimiento con fundadores', estado: 'PENDIENTE', prioridad: 'MEDIA', fechaVencimiento: '09 abr 2026' }
        ],
        hitos: [
          { id: 'h-19', titulo: 'Research de mercado', estado: 'COMPLETADO' },
          { id: 'h-20', titulo: 'Blueprint de producto', estado: 'ACTUAL' }
        ],
        archivos: [
          { id: 'a-11', proyectoId: 'p-6', nombre: 'Alcance_Nomada.pdf', tamano: '3.1 MB', tipo: 'PDF', previewClass: 'doc-file', previewIcon: '≡', fecha: '27 mar' }
        ],
        facturas: [],
        comentarios: [],
        entregaDestacada: {
          fecha: '2 de mayo de 2026',
          descripcion: 'Presentación ejecutiva del Roadmap 2026'
        }
      },
      {
        id: 'p-7',
        key: 'mercado',
        nombre: 'Mercado Local',
        clienteId: 'c-7',
        clienteNombre: 'Valeria Ruiz',
        tipo: 'E-commerce',
        descripcion: 'Tienda virtual con integración de pasarela de pagos local (Yappy, Cuanto, Visa/Mastercard).',
        progreso: 26,
        estado: 'En progreso',
        estadoBadgeClass: 'progreso',
        presupuesto: 2200,
        fechaEntrega: '12 de mayo de 2026',
        tag: 'ML',
        color: '#a57c5b',
        x: 88,
        y: 82,
        visualClass: 'visual-market',
        participantes: [{ iniciales: 'VR', color: '#9c7355' }],
        tareas: [
          { id: 't-15', proyectoId: 'p-7', proyectoNombre: 'Mercado Local', titulo: 'Auditar catálogo inicial de productos', estado: 'PENDIENTE', prioridad: 'ALTA', fechaVencimiento: '15 abr 2026' },
          { id: 't-16', proyectoId: 'p-7', proyectoNombre: 'Mercado Local', titulo: 'Configurar pasarela de pagos Yappy Comercial', estado: 'PENDIENTE', prioridad: 'URGENTE', fechaVencimiento: '22 abr 2026' }
        ],
        hitos: [
          { id: 'h-21', titulo: 'Definición de checkout', estado: 'COMPLETADO' },
          { id: 'h-22', titulo: 'Maquetación de catálogo', estado: 'ACTUAL' }
        ],
        archivos: [
          { id: 'a-12', proyectoId: 'p-7', nombre: 'Inventario_Base.csv', tamano: '620 KB', tipo: 'CSV', previewClass: 'box-file', previewIcon: '▣', fecha: '28 mar' }
        ],
        facturas: [
          {
            id: 'f-6',
            numero: 'INV-2026-006',
            concepto: 'Configuración E-Commerce Mercado Local (Hito 1)',
            clienteId: 'c-7',
            clienteNombre: 'Valeria Ruiz',
            proyectoId: 'p-7',
            proyectoNombre: 'Mercado Local',
            monto: 1100,
            montoPendiente: 1100,
            estado: 'PENDIENTE',
            fechaEmision: '03 abr 2026',
            fechaVencimiento: '17 abr 2026'
          }
        ],
        comentarios: [],
        entregaDestacada: {
          fecha: '12 de mayo de 2026',
          descripcion: 'Pruebas de cobro en sandbox y pase a producción'
        }
      },
      {
        id: 'p-8',
        key: 'selva',
        nombre: 'Selva Viva',
        clienteId: 'c-8',
        clienteNombre: 'Carmen Guerra',
        tipo: 'Contenido',
        descripcion: 'Estrategia editorial y storytelling visual para expediciones sostenibles en Panamá.',
        progreso: 60,
        estado: 'En progreso',
        estadoBadgeClass: 'progreso',
        presupuesto: 1500,
        fechaEntrega: '28 de abril de 2026',
        tag: 'SV',
        color: '#24543b',
        x: 61,
        y: 88,
        visualClass: 'visual-selva',
        participantes: [{ iniciales: 'CG', color: '#24543b' }],
        tareas: [
          { id: 't-17', proyectoId: 'p-8', proyectoNombre: 'Selva Viva', titulo: 'Redactar artículos de expedición en Darién', estado: 'PENDIENTE', prioridad: 'MEDIA', fechaVencimiento: '14 abr 2026' }
        ],
        hitos: [
          { id: 'h-23', titulo: 'Eje temático', estado: 'COMPLETADO' },
          { id: 'h-24', titulo: 'Edición fotográfica', estado: 'ACTUAL' }
        ],
        archivos: [],
        facturas: [],
        comentarios: [],
        entregaDestacada: {
          fecha: '28 de abril de 2026',
          descripcion: 'Publicación del magazine digital Selva Viva'
        }
      }
    ];

    const notificacionesIniciales: Notificacion[] = [
      {
        id: 'n-1',
        titulo: 'Nuevo feedback de Café Unido',
        descripcion: 'Ana Rodríguez comentó: "Nos encanta la paleta de colores café y crema..."',
        tiempo: 'Hace 12 min',
        leida: false,
        tipo: 'feedback'
      },
      {
        id: 'n-2',
        titulo: 'Pago registrado con éxito',
        descripcion: 'Carlos Castillo completó el pago de INV-2026-003 por B/. 1,400.00',
        tiempo: 'Ayer',
        leida: false,
        tipo: 'pago'
      },
      {
        id: 'n-3',
        titulo: 'Entrega próxima: Studio Bahía',
        descripcion: 'La firma de aprobación de manual vence el 18 de abril.',
        tiempo: 'Hace 2 días',
        leida: true,
        tipo: 'proyecto'
      }
    ];

    this.clientesSubject.next(clientesIniciales);
    this.proyectosSubject.next(proyectosIniciales);
    this.notificacionesSubject.next(notificacionesIniciales);
    this.proyectoSeleccionadoSubject.next(proyectosIniciales[0]);
    this.guardarEnStorage();
  }

  private guardarEnStorage() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          clientes: this.clientes,
          proyectos: this.proyectos,
          configuracion: this.configuracion,
          notificaciones: this.notificaciones
        })
      );
    } catch (e) {
      console.warn('No se pudo guardar en almacenamiento local', e);
    }
  }

  seleccionarProyecto(p: Proyecto) {
    this.proyectoSeleccionadoSubject.next(p);
  }

  seleccionarProyectoPorId(id: string) {
    const p = this.proyectos.find((item) => item.id === id || item.key === id);
    if (p) this.seleccionarProyecto(p);
  }

  toggleEstadoTarea(tareaId: string) {
    const proyectos = [...this.proyectos];
    let modificada = false;

    for (const proj of proyectos) {
      const tarea = proj.tareas.find((t) => t.id === tareaId);
      if (tarea) {
        tarea.estado = tarea.estado === 'COMPLETADA' ? 'PENDIENTE' : 'COMPLETADA';
        // Recalcular progreso proporcional del proyecto
        const total = proj.tareas.length;
        const completadas = proj.tareas.filter((t) => t.estado === 'COMPLETADA').length;
        if (total > 0) {
          proj.progreso = Math.min(100, Math.round((completadas / total) * 100));
        }
        modificada = true;
        this.mostrarToast(
          tarea.estado === 'COMPLETADA'
            ? `Tarea "${tarea.titulo}" completada`
            : `Tarea "${tarea.titulo}" reabierta`
        );
        break;
      }
    }

    if (modificada) {
      this.proyectosSubject.next(proyectos);
      const sel = this.proyectoSeleccionado;
      if (sel) {
        const actualizado = proyectos.find((p) => p.id === sel.id);
        if (actualizado) this.proyectoSeleccionadoSubject.next(actualizado);
      }
      this.guardarEnStorage();
    }
  }

  agregarTarea(proyectoId: string, titulo: string, prioridad: 'BAJA' | 'MEDIA' | 'ALTA' | 'URGENTE', fecha: string) {
    const proyectos = [...this.proyectos];
    const proj = proyectos.find((p) => p.id === proyectoId);
    if (!proj) return;

    const nuevaTarea: Tarea = {
      id: 't-' + Date.now(),
      proyectoId: proj.id,
      proyectoNombre: proj.nombre,
      titulo,
      estado: 'PENDIENTE',
      prioridad,
      fechaVencimiento: fecha || 'Por definir'
    };

    proj.tareas.unshift(nuevaTarea);
    this.proyectosSubject.next(proyectos);
    if (this.proyectoSeleccionado?.id === proj.id) {
      this.proyectoSeleccionadoSubject.next(proj);
    }
    this.guardarEnStorage();
    this.mostrarToast(`Tarea agregada a ${proj.nombre}`);
  }

  agregarComentario(proyectoId: string, contenido: string, autor: 'FREELANCER' | 'CLIENTE' = 'FREELANCER') {
    const proyectos = [...this.proyectos];
    const proj = proyectos.find((p) => p.id === proyectoId);
    if (!proj) return;

    const nuevoComentario: Comentario = {
      id: 'cm-' + Date.now(),
      proyectoId: proj.id,
      autor,
      nombreAutor: autor === 'FREELANCER' ? this.configuracion.nombreFreelancer : proj.clienteNombre,
      avatar: autor === 'FREELANCER' ? 'KM' : proj.tag,
      contenido,
      fecha: 'Ahora mismo'
    };

    proj.comentarios.push(nuevoComentario);
    this.proyectosSubject.next(proyectos);
    if (this.proyectoSeleccionado?.id === proj.id) {
      this.proyectoSeleccionadoSubject.next(proj);
    }
    this.guardarEnStorage();
    this.mostrarToast('Mensaje enviado correctamente');
  }

  agregarArchivo(proyectoId: string, nombre: string, tamano: string, previewClass: any = 'doc-file', previewIcon = '≡') {
    const proyectos = [...this.proyectos];
    const proj = proyectos.find((p) => p.id === proyectoId);
    if (!proj) return;

    const nuevoArchivo: Archivo = {
      id: 'a-' + Date.now(),
      proyectoId: proj.id,
      nombre,
      tamano,
      tipo: nombre.split('.').pop()?.toUpperCase() || 'DOC',
      previewClass,
      previewIcon,
      fecha: 'Hoy'
    };

    proj.archivos.unshift(nuevoArchivo);
    this.proyectosSubject.next(proyectos);
    if (this.proyectoSeleccionado?.id === proj.id) {
      this.proyectoSeleccionadoSubject.next(proj);
    }
    this.guardarEnStorage();
    this.mostrarToast(`Archivo ${nombre} agregado al proyecto`);
  }

  crearCliente(datos: { nombre: string; empresa: string; correo: string; telefono: string; estado?: 'ACTIVO' | 'PROSPECTO'; notas?: string }): Cliente {
    const clientes = [...this.clientes];
    const nuevo: Cliente = {
      id: 'c-' + Date.now(),
      nombre: datos.nombre,
      empresa: datos.empresa || datos.nombre,
      correo: datos.correo,
      telefono: datos.telefono,
      estado: datos.estado || 'ACTIVO',
      notas: datos.notas || '',
      proyectosCount: 0,
      totalFacturado: 0,
      avatarColor: '#3568f6'
    };

    clientes.unshift(nuevo);
    this.clientesSubject.next(clientes);
    this.guardarEnStorage();
    this.mostrarToast(`Cliente ${nuevo.nombre} registrado`);
    return nuevo;
  }

  crearProyecto(datos: {
    nombre: string;
    clienteId: string;
    tipo: string;
    descripcion?: string;
    presupuesto?: number;
    fechaEntrega: string;
    color?: string;
  }): Proyecto {
    const clientes = this.clientes;
    const cliente = clientes.find((c) => c.id === datos.clienteId) || clientes[0];

    // Asignar posición visual disponible
    const posiciones = [
      { x: 30, y: 30 },
      { x: 70, y: 35 },
      { x: 40, y: 75 },
      { x: 75, y: 65 },
      { x: 20, y: 60 }
    ];
    const pos = posiciones[this.proyectos.length % posiciones.length];

    const iniciales = datos.nombre
      .split(' ')
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

    const nuevo: Proyecto = {
      id: 'p-' + Date.now(),
      key: 'proj-' + Date.now(),
      nombre: datos.nombre,
      clienteId: cliente.id,
      clienteNombre: cliente.nombre,
      tipo: datos.tipo || 'General',
      descripcion: datos.descripcion || 'Nuevo proyecto creado en Equinox',
      progreso: 0,
      estado: 'Planificación',
      estadoBadgeClass: 'planificacion',
      presupuesto: datos.presupuesto || 1000,
      fechaEntrega: datos.fechaEntrega || 'Por definir',
      tag: iniciales || 'PR',
      color: datos.color || '#3568f6',
      x: pos.x,
      y: pos.y,
      visualClass: 'visual-building',
      participantes: [{ iniciales: 'KM', color: '#273559' }],
      tareas: [
        {
          id: 't-' + Date.now(),
          proyectoId: '',
          proyectoNombre: datos.nombre,
          titulo: 'Kickoff inicial y requerimientos',
          estado: 'PENDIENTE',
          prioridad: 'ALTA',
          fechaVencimiento: datos.fechaEntrega || 'Próxima semana'
        }
      ],
      hitos: [
        { id: 'h-1', titulo: 'Kickoff y definición', estado: 'ACTUAL' },
        { id: 'h-2', titulo: 'Entrega final', estado: 'PENDIENTE' }
      ],
      archivos: [],
      facturas: [],
      comentarios: [],
      entregaDestacada: {
        fecha: datos.fechaEntrega || 'Próximamente',
        descripcion: 'Entrega del alcance inicial acordado'
      }
    };
    nuevo.tareas[0].proyectoId = nuevo.id;

    cliente.proyectosCount = (cliente.proyectosCount || 0) + 1;
    this.clientesSubject.next([...clientes]);

    const proyectos = [nuevo, ...this.proyectos];
    this.proyectosSubject.next(proyectos);
    this.seleccionarProyecto(nuevo);
    this.guardarEnStorage();
    this.mostrarToast(`Proyecto ${nuevo.nombre} creado con éxito`);
    return nuevo;
  }

  crearFactura(datos: {
    clienteId: string;
    proyectoId?: string;
    concepto: string;
    monto: number;
    fechaVencimiento: string;
  }): Factura {
    const cliente = this.clientes.find((c) => c.id === datos.clienteId);
    const proyecto = this.proyectos.find((p) => p.id === datos.proyectoId);

    const correlativo = String(Math.floor(Math.random() * 900) + 100);
    const nueva: Factura = {
      id: 'f-' + Date.now(),
      numero: `INV-2026-${correlativo}`,
      concepto: datos.concepto,
      clienteId: cliente?.id || 'c-1',
      clienteNombre: cliente?.nombre || 'Cliente general',
      proyectoId: proyecto?.id,
      proyectoNombre: proyecto?.nombre,
      monto: Number(datos.monto) || 500,
      montoPendiente: Number(datos.monto) || 500,
      estado: 'PENDIENTE',
      fechaEmision: new Date().toLocaleDateString('es-PA', { day: '2-digit', month: 'short', year: 'numeric' }),
      fechaVencimiento: datos.fechaVencimiento || '15 días'
    };

    if (proyecto) {
      const proyectos = [...this.proyectos];
      const p = proyectos.find((item) => item.id === proyecto.id);
      if (p) {
        p.facturas.unshift(nueva);
        this.proyectosSubject.next(proyectos);
        if (this.proyectoSeleccionado?.id === p.id) {
          this.proyectoSeleccionadoSubject.next(p);
        }
      }
    }

    this.guardarEnStorage();
    this.mostrarToast(`Factura ${nueva.numero} generada`);
    return nueva;
  }

  marcarFacturaPagada(facturaId: string) {
    const proyectos = [...this.proyectos];
    let marcada = false;

    for (const proj of proyectos) {
      const f = proj.facturas.find((item) => item.id === facturaId);
      if (f) {
        f.estado = 'PAGADA';
        f.montoPendiente = 0;
        f.pagadaEn = new Date().toLocaleDateString('es-PA', { day: '2-digit', month: 'short', year: 'numeric' });
        marcada = true;
        this.mostrarToast(`Factura ${f.numero} marcada como pagada`);
        break;
      }
    }

    if (marcada) {
      this.proyectosSubject.next(proyectos);
      const sel = this.proyectoSeleccionado;
      if (sel) {
        const act = proyectos.find((p) => p.id === sel.id);
        if (act) this.proyectoSeleccionadoSubject.next(act);
      }
      this.guardarEnStorage();
    }
  }

  todasLasFacturas(): Factura[] {
    const facturas: Factura[] = [];
    for (const p of this.proyectos) {
      if (p.facturas) {
        facturas.push(...p.facturas);
      }
    }
    return facturas;
  }

  todasLasTareas(): Tarea[] {
    const tareas: Tarea[] = [];
    for (const p of this.proyectos) {
      if (p.tareas) {
        tareas.push(...p.tareas);
      }
    }
    return tareas;
  }

  actualizarConfiguracion(datos: Partial<ConfiguracionEstudio>) {
    const actualizada = { ...this.configuracion, ...datos };
    this.configuracionSubject.next(actualizada);
    this.guardarEnStorage();
    this.mostrarToast('Configuración del estudio actualizada');
  }

  marcarNotificacionesLeidas() {
    const notifs = this.notificaciones.map((n) => ({ ...n, leida: true }));
    this.notificacionesSubject.next(notifs);
    this.guardarEnStorage();
  }

  mostrarToast(mensaje: string) {
    this.toastSubject.next(mensaje);
    setTimeout(() => {
      if (this.toastSubject.getValue() === mensaje) {
        this.toastSubject.next('');
      }
    }, 2800);
  }
}
