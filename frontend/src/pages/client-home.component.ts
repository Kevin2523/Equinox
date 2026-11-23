import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../auth/auth.service';
import {
  ArchivoPortal,
  ComentarioPortal,
  FacturaPortal,
  FotoPortal,
  HitoPortal,
  IdentidadPortal,
  ProyectoPortal,
  SesionFotograficaPortal
} from '../models/portal.model';
import { PortalApiService } from '../services/portal-api.service';
import { PortalHeroComponent } from '../shared/portal-hero.component';
import { DialogFocusDirective } from '../shared/dialog-focus.directive';
import { ArchivosApiService } from '../services/archivos-api.service';
import {
  evaluarContrastePaleta,
  normalizarHex,
  obtenerFontStack
} from '../utils/branding.util';

@Component({
  selector: 'app-client-home', standalone: true, imports: [CommonModule, FormsModule, PortalHeroComponent, DialogFocusDirective],
  templateUrl: './client-home.component.html', styleUrls: ['./client-home.component.css', '../shared/portal-editorial.css']
})
export class ClientHomeComponent implements OnInit, OnDestroy {
  identidad: IdentidadPortal | null = null;
  proyectos: ProyectoPortal[] = [];
  proyecto: ProyectoPortal | null = null;
  hitos: HitoPortal[] = [];
  archivos: ArchivoPortal[] = [];
  comentarios: ComentarioPortal[] = [];
  facturas: FacturaPortal[] = [];
  proyectoId: string | null = null;
  cargandoIdentidad = false;
  cargandoProyectos = false;
  cargandoDetalle = false;
  cargandoFacturas = false;
  enviandoComentario = false;
  errorIdentidad = '';
  errorProyectos = '';
  errorDetalle = '';
  errorFacturas = '';
  errorComentario = '';
  errorDescarga = '';
  descargandoId: string | null = null;
  comentario = '';
  logoFallido = false;
  esColaboradorSinAcceso = false;

  // Estado para el portal de fotografía
  sesiones: SesionFotograficaPortal[] = [];
  sesionId: string | null = null;
  sesionSeleccionada: SesionFotograficaPortal | null = null;
  fotos: FotoPortal[] = [];
  totalFotos = 0;
  paginaFotos = 1;
  readonly limiteFotos = 12;
  cargandoSesiones = false;
  cargandoFotos = false;
  errorSesiones = '';
  errorFotos = '';

  // Miniaturas y URLs temporales (revocables)
  miniaturasUrls = new Map<string, string>();
  cargandoMiniatura = new Map<string, boolean>();
  errorMiniatura = new Map<string, boolean>();
  portadasSesionesUrls = new Map<string, string>();

  // Visor ampliado accesible (Lightbox)
  fotoSeleccionada: FotoPortal | null = null;
  indiceFotoSeleccionada = -1;
  fotoOriginalUrl: string | null = null;
  cargandoFotoOriginal = false;
  errorFotoOriginal = '';

  private solicitudDetalle = 0;
  private solicitudProyectos = 0;
  private solicitudFacturas = 0;
  private solicitudSesiones = 0;
  private solicitudFotos = 0;
  private solicitudFotoOriginal = 0;
  private listenerTeclado = (evento: KeyboardEvent) => this.manejarTeclado(evento);

  constructor(private api: PortalApiService, public auth: AuthService, private archivosApi: ArchivosApiService) {}

  get esFotografia(): boolean {
    return this.identidad?.estudio?.tipoFreelance?.toUpperCase() === 'FOTOGRAFIA';
  }

  get esColaborador(): boolean {
    const sesion = this.auth?.sesion;
    if (sesion?.contexto?.tipoAcceso === 'CLIENTE') {
      return sesion.contexto.rolCliente === 'COLABORADOR';
    }
    return false;
  }

  get finanzasDesactivadas(): boolean {
    return Boolean((this.api as any)?.finanzasDesactivadas);
  }

  get nombreCliente(): string {
    return this.identidad?.cliente?.nombre?.trim() || this.auth.sesion?.usuario?.nombre?.trim() || 'Cliente';
  }

  get nombreEstudio(): string {
    return this.identidad?.estudio?.nombre?.trim() || 'Jose FOTOS';
  }

  get colorPrimarioPortal(): string {
    return normalizarHex(this.identidad?.estudio?.colorPrimario) ?? '#3568F6';
  }

  get colorSecundarioPortal(): string {
    return normalizarHex(this.identidad?.estudio?.colorSecundario) ?? '#111215';
  }

  get fontFamilyPortal(): string {
    return obtenerFontStack();
  }

  get contrastePortal() {
    return evaluarContrastePaleta(this.colorPrimarioPortal, this.colorSecundarioPortal);
  }

  get mensajeContextual(): string {
    const personalizado = this.identidad?.estudio?.portalMensajeBienvenida?.trim();
    if (personalizado) {
      return personalizado;
    }
    const estudio = this.nombreEstudio;
    if (this.esFotografia) {
      return `Aquí encontrarás las sesiones y documentos que ${estudio} comparta contigo.`;
    }
    return `Aquí encontrarás los proyectos, documentos y facturas que ${estudio} comparta contigo.`;
  }

  ngOnInit(): void {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', this.listenerTeclado);
    }
    void this.inicializar();
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('keydown', this.listenerTeclado);
    }
    this.revocarMiniaturas();
    this.revocarFotoOriginal();
  }

  async inicializar(): Promise<void> {
    void this.cargarFacturas();
    await this.cargarIdentidad();
    if (this.esFotografia) {
      void this.cargarSesiones();
    } else {
      void this.cargarProyectos();
    }
  }

  async cargarIdentidad(): Promise<void> {
    this.cargandoIdentidad = true;
    this.errorIdentidad = '';
    try {
      this.identidad = await this.api.identidad();
      this.logoFallido = false;
    } catch {
      this.errorIdentidad = 'No se pudo cargar la identidad del portal.';
    } finally {
      this.cargandoIdentidad = false;
    }
  }

  async reintentarIdentidad(): Promise<void> {
    await this.cargarIdentidad();
    if (this.identidad) {
      if (this.esFotografia) {
        if (!this.sesiones.length && !this.cargandoSesiones) void this.cargarSesiones();
      } else {
        if (!this.proyectos.length && !this.cargandoProyectos) void this.cargarProyectos();
      }
    }
  }

  // --- MÉTODOS PARA PORTAL DE PROYECTOS GENERAL ---

  async cargarProyectos(): Promise<void> {
    const solicitud = ++this.solicitudProyectos;
    this.cargandoProyectos = true;
    this.errorProyectos = '';
    try {
      const proyectos = await this.api.proyectos();
      if (solicitud !== this.solicitudProyectos) return;
      this.proyectos = proyectos;
      if (!this.proyectos.some((proyecto) => proyecto.id === this.proyectoId)) {
        ++this.solicitudDetalle;
        this.proyectoId = null;
        this.proyecto = null;
        this.cargandoDetalle = false;
        this.limpiarDetalle();
        if (this.proyectos.length) await this.seleccionarProyecto(this.proyectos[0].id);
      }
    } catch {
      if (solicitud === this.solicitudProyectos) this.errorProyectos = 'No se pudieron cargar tus proyectos.';
    } finally {
      if (solicitud === this.solicitudProyectos) this.cargandoProyectos = false;
    }
  }

  async seleccionarProyecto(id: string): Promise<void> {
    this.proyectoId = id;
    const solicitud = ++this.solicitudDetalle;
    this.proyecto = null;
    this.comentario = '';
    this.errorComentario = '';
    this.errorDescarga = '';
    this.limpiarDetalle();
    this.cargandoDetalle = true;
    this.errorDetalle = '';
    try {
      const [proyecto, hitos, archivos, comentarios] = await Promise.all([
        this.api.proyecto(id), this.api.hitos(id), this.api.archivos(id), this.api.comentarios(id)
      ]);
      if (solicitud !== this.solicitudDetalle) return;
      this.proyecto = proyecto;
      this.hitos = hitos;
      this.archivos = archivos;
      this.comentarios = comentarios;
    } catch {
      if (solicitud === this.solicitudDetalle) this.errorDetalle = 'No se pudo cargar el detalle. Comprueba la conexión e inténtalo de nuevo.';
    } finally {
      if (solicitud === this.solicitudDetalle) this.cargandoDetalle = false;
    }
  }

  async reintentarDetalle(): Promise<void> {
    if (this.proyectoId) await this.seleccionarProyecto(this.proyectoId);
  }

  async cargarFacturas(): Promise<void> {
    if (this.esColaborador) {
      this.esColaboradorSinAcceso = true;
      this.facturas = [];
      this.cargandoFacturas = false;
      return;
    }
    const solicitud = ++this.solicitudFacturas;
    this.cargandoFacturas = true;
    this.errorFacturas = '';
    this.esColaboradorSinAcceso = false;
    try {
      const facturas = await this.api.facturas();
      if (solicitud !== this.solicitudFacturas) return;
      this.facturas = Array.isArray(facturas) ? facturas : [];
    } catch (err: any) {
      if (solicitud !== this.solicitudFacturas) return;
      if (err?.status === 403 || this.esColaborador) {
        this.esColaboradorSinAcceso = true;
        this.facturas = [];
      } else {
        this.errorFacturas = 'No se pudieron cargar las facturas autorizadas.';
      }
    } finally {
      if (solicitud === this.solicitudFacturas) this.cargandoFacturas = false;
    }
  }

  async enviarComentario(): Promise<void> {
    const contenido = this.comentario.trim();
    this.errorComentario = '';
    if (!contenido || contenido.length > 2000) {
      this.errorComentario = 'Escribe un comentario de entre 1 y 2000 caracteres.';
      return;
    }
    if (!this.proyectoId || this.enviandoComentario) return;
    const proyectoId = this.proyectoId;
    this.enviandoComentario = true;
    try {
      const nuevo = await this.api.enviarComentario(proyectoId, contenido);
      if (this.proyectoId === proyectoId) {
        this.comentarios = [...this.comentarios, nuevo];
        this.comentario = '';
      }
    } catch (error: any) {
      this.errorComentario = error?.status === 422
        ? 'El comentario no cumple el formato permitido.'
        : 'No se pudo enviar el comentario. Puedes reintentarlo.';
    } finally {
      this.enviandoComentario = false;
    }
  }

  async descargarArchivo(archivo: ArchivoPortal): Promise<void> {
    if (!this.proyectoId || this.descargandoId) return;
    const proyectoId = this.proyectoId;
    this.descargandoId = archivo.id; this.errorDescarga = '';
    try { await this.archivosApi.guardarDescarga(proyectoId, archivo, true); }
    catch { if (this.proyectoId === proyectoId) this.errorDescarga = 'No se pudo descargar el archivo. Reintenta.'; }
    finally { this.descargandoId = null; }
  }

  get avanceHitos(): number | null {
    if (!this.hitos.length) return null;
    return Math.round(this.hitos.filter((hito) => hito.estado === 'COMPLETADO').length / this.hitos.length * 100);
  }

  estadoHito(estado: HitoPortal['estado']): string {
    return { PENDIENTE: 'Pendiente', EN_PROGRESO: 'En progreso', COMPLETADO: 'Completado', VENCIDO: 'Vencido' }[estado];
  }

  autorComentario(comentario: ComentarioPortal): string {
    if (comentario.autor === 'CLIENTE') return 'Tú';
    const nombre = [comentario.usuario?.nombre, comentario.usuario?.apellido].filter(Boolean).join(' ');
    return nombre || this.identidad?.estudio.nombre || 'Equipo';
  }

  tamanoArchivo(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private limpiarDetalle(): void {
    this.hitos = [];
    this.archivos = [];
    this.comentarios = [];
    this.errorDetalle = '';
  }

  // --- MÉTODOS PARA PORTAL DE FOTOGRAFÍA ---

  async cargarSesiones(): Promise<void> {
    const solicitud = ++this.solicitudSesiones;
    this.cargandoSesiones = true;
    this.errorSesiones = '';
    try {
      const sesiones = await this.api.sesionesFotograficas();
      if (solicitud !== this.solicitudSesiones) return;
      this.sesiones = Array.isArray(sesiones) ? sesiones : [];

      // Cargar miniaturas de portadas seguras de cada sesión
      for (const sesion of this.sesiones) {
        if (sesion.portadaFotoId && !this.portadasSesionesUrls.has(sesion.id)) {
          void this.cargarPortadaSesion(sesion.id, sesion.portadaFotoId);
        }
      }

      if (!this.sesiones.some((s) => s.id === this.sesionId)) {
        this.sesionId = null;
        this.sesionSeleccionada = null;
        this.limpiarFotos();
        if (this.sesiones.length > 0) {
          await this.seleccionarSesion(this.sesiones[0].id);
        }
      } else {
        this.sesionSeleccionada = this.sesiones.find((s) => s.id === this.sesionId) || null;
      }
    } catch {
      if (solicitud === this.solicitudSesiones) {
        this.errorSesiones = 'No se pudieron cargar tus sesiones fotográficas.';
      }
    } finally {
      if (solicitud === this.solicitudSesiones) {
        this.cargandoSesiones = false;
      }
    }
  }

  async cargarPortadaSesion(sesionId: string, fotoId: string): Promise<void> {
    try {
      const blob = await this.api.obtenerContenidoFoto(sesionId, fotoId, 'miniatura');
      const url = URL.createObjectURL(blob);
      this.portadasSesionesUrls.set(sesionId, url);
    } catch {
      // Si falla, se muestra el ícono representativo seguro
    }
  }

  async seleccionarSesion(id: string): Promise<void> {
    this.sesionId = id;
    this.sesionSeleccionada = this.sesiones.find((s) => s.id === id) || null;
    this.paginaFotos = 1;
    this.limpiarFotos();
    await this.cargarFotos(id, 1);
  }

  async reintentarFotos(): Promise<void> {
    if (this.sesionId) {
      await this.cargarFotos(this.sesionId, this.paginaFotos);
    }
  }

  async cargarFotos(sesionId: string, pagina = 1): Promise<void> {
    const solicitud = ++this.solicitudFotos;
    this.cargandoFotos = true;
    this.errorFotos = '';
    this.paginaFotos = pagina;
    this.revocarMiniaturas();

    try {
      const respuesta = await this.api.fotosSesion(sesionId, pagina, this.limiteFotos);
      if (solicitud !== this.solicitudFotos) return;

      const items = Array.isArray(respuesta) ? respuesta : (respuesta?.items ?? []);
      const total = Array.isArray(respuesta) ? respuesta.length : (respuesta?.total ?? items.length);

      this.fotos = items;
      this.totalFotos = total;

      void this.cargarMiniaturas(sesionId, this.fotos, solicitud);
    } catch {
      if (solicitud === this.solicitudFotos) {
        this.errorFotos = 'No se pudieron cargar las fotos de esta sesión. Comprueba la conexión e inténtalo de nuevo.';
      }
    } finally {
      if (solicitud === this.solicitudFotos) {
        this.cargandoFotos = false;
      }
    }
  }

  private async cargarMiniaturas(sesionId: string, fotos: FotoPortal[], solicitud: number): Promise<void> {
    for (const foto of fotos) {
      if (solicitud !== this.solicitudFotos) return;
      this.cargandoMiniatura.set(foto.id, true);
      try {
        const blob = await this.api.obtenerContenidoFoto(sesionId, foto.id, 'miniatura');
        if (solicitud !== this.solicitudFotos) return;
        const objectUrl = URL.createObjectURL(blob);
        this.miniaturasUrls.set(foto.id, objectUrl);
      } catch {
        if (solicitud === this.solicitudFotos) {
          this.errorMiniatura.set(foto.id, true);
        }
      } finally {
        if (solicitud === this.solicitudFotos) {
          this.cargandoMiniatura.set(foto.id, false);
        }
      }
    }
  }

  get totalPaginas(): number {
    return Math.max(1, Math.ceil(this.totalFotos / this.limiteFotos));
  }

  async cambiarPagina(nuevaPagina: number): Promise<void> {
    if (nuevaPagina < 1 || nuevaPagina > this.totalPaginas || nuevaPagina === this.paginaFotos || !this.sesionId) {
      return;
    }
    await this.cargarFotos(this.sesionId, nuevaPagina);
  }

  async paginaAnterior(): Promise<void> {
    if (this.paginaFotos > 1) {
      await this.cambiarPagina(this.paginaFotos - 1);
    }
  }

  async paginaSiguiente(): Promise<void> {
    if (this.paginaFotos < this.totalPaginas) {
      await this.cambiarPagina(this.paginaFotos + 1);
    }
  }

  // --- VISOR AMPLIADO ACCESIBLE (LIGHTBOX MODAL) ---

  async abrirVisor(foto: FotoPortal, indice: number): Promise<void> {
    this.fotoSeleccionada = foto;
    this.indiceFotoSeleccionada = indice;
    this.errorFotoOriginal = '';
    await this.cargarFotoOriginal(foto);
  }

  cerrarVisor(): void {
    this.fotoSeleccionada = null;
    this.indiceFotoSeleccionada = -1;
    this.errorFotoOriginal = '';
    this.cargandoFotoOriginal = false;
    this.revocarFotoOriginal();
  }

  async anteriorFoto(): Promise<void> {
    if (this.indiceFotoSeleccionada > 0) {
      const nuevoIndice = this.indiceFotoSeleccionada - 1;
      const foto = this.fotos[nuevoIndice];
      if (foto) {
        this.fotoSeleccionada = foto;
        this.indiceFotoSeleccionada = nuevoIndice;
        await this.cargarFotoOriginal(foto);
      }
    }
  }

  async siguienteFoto(): Promise<void> {
    if (this.indiceFotoSeleccionada < this.fotos.length - 1) {
      const nuevoIndice = this.indiceFotoSeleccionada + 1;
      const foto = this.fotos[nuevoIndice];
      if (foto) {
        this.fotoSeleccionada = foto;
        this.indiceFotoSeleccionada = nuevoIndice;
        await this.cargarFotoOriginal(foto);
      }
    }
  }

  async cargarFotoOriginal(foto: FotoPortal): Promise<void> {
    if (!this.sesionId) return;
    const sesionId = this.sesionId;
    const solicitud = ++this.solicitudFotoOriginal;
    this.cargandoFotoOriginal = true;
    this.errorFotoOriginal = '';
    this.revocarFotoOriginal();

    try {
      const blob = await this.api.obtenerContenidoFoto(sesionId, foto.id, 'original');
      if (solicitud !== this.solicitudFotoOriginal) return;
      this.fotoOriginalUrl = URL.createObjectURL(blob);
    } catch {
      if (solicitud === this.solicitudFotoOriginal) {
        this.errorFotoOriginal = 'No se pudo cargar la imagen en tamaño completo.';
      }
    } finally {
      if (solicitud === this.solicitudFotoOriginal) {
        this.cargandoFotoOriginal = false;
      }
    }
  }

  manejarTeclado(evento: KeyboardEvent): void {
    if (!this.fotoSeleccionada) return;
    if (evento.key === 'Escape') {
      evento.preventDefault();
      this.cerrarVisor();
    } else if (evento.key === 'ArrowLeft') {
      evento.preventDefault();
      void this.anteriorFoto();
    } else if (evento.key === 'ArrowRight') {
      evento.preventDefault();
      void this.siguienteFoto();
    }
  }

  // --- REVOCACIÓN DE OBJECT URLS Y LIMPIEZA ---

  private revocarMiniaturas(): void {
    for (const url of this.miniaturasUrls.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    }
    this.miniaturasUrls.clear();
    this.cargandoMiniatura.clear();
    this.errorMiniatura.clear();

    for (const url of this.portadasSesionesUrls.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    }
    this.portadasSesionesUrls.clear();
  }

  private revocarFotoOriginal(): void {
    if (this.fotoOriginalUrl) {
      try {
        URL.revokeObjectURL(this.fotoOriginalUrl);
      } catch {}
      this.fotoOriginalUrl = null;
    }
  }

  private limpiarFotos(): void {
    this.revocarMiniaturas();
    this.fotos = [];
    this.totalFotos = 0;
    this.errorFotos = '';
    this.cerrarVisor();
  }

  // --- HELPERS DE TEXTO Y FORMATO ---

  nombreSesion(sesion: SesionFotograficaPortal | null): string {
    if (!sesion) return 'Sesión fotográfica';
    return sesion.nombre || sesion.titulo || 'Sesión fotográfica';
  }

  fechaSesion(sesion: SesionFotograficaPortal | null): string | null {
    if (!sesion) return null;
    return sesion.fechaSesion || sesion.fecha || sesion.creadoEn || null;
  }

  nombreFoto(foto: FotoPortal | null, indice?: number): string {
    if (!foto) return 'Fotografía';
    if (foto.nombreOriginal) return foto.nombreOriginal;
    if (foto.nombre) return foto.nombre;
    if (foto.titulo) return foto.titulo;
    const num = indice !== undefined ? indice + 1 : 1;
    return `Fotografía ${num}`;
  }
}
