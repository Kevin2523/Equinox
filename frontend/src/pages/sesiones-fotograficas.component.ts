import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { DialogFocusDirective } from '../shared/dialog-focus.directive';
import { ClienteApi } from '../services/clientes-proyectos-api.service';
import {
  EstadoSesion,
  FotoSesionApi,
  FotografiaApiService,
  PaginaFotosApi,
  SesionFotograficaApi
} from '../services/fotografia-api.service';

@Component({
  selector: 'app-sesiones-fotograficas',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogFocusDirective],
  templateUrl: './sesiones-fotograficas.component.html',
  styleUrl: './sesiones-fotograficas.component.css'
})
export class SesionesFotograficasComponent implements OnInit, OnChanges, OnDestroy {
  @Input() cliente: ClienteApi | null = null;
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  sesiones: SesionFotograficaApi[] = [];
  cargandoSesiones = false;
  errorSesiones = '';

  sesionSeleccionada: SesionFotograficaApi | null = null;

  // Formulario de creación / edición de sesión
  modalSesion = false;
  guardandoSesion = false;
  errorGuardarSesion = '';
  editandoSesionId: string | null = null;
  formularioSesion = {
    nombre: '',
    fecha: '',
    descripcion: ''
  };

  // Fotos de la sesión seleccionada
  fotos: FotoSesionApi[] = [];
  cargandoFotos = false;
  errorFotos = '';
  paginaFotos = 1;
  limiteFotos = 48;
  totalFotos = 0;
  totalPaginasFotos = 1;

  // Cache local de URLs para miniaturas Blob
  urlsMiniaturas = new Map<string, string>();
  cargandoMiniatura = new Set<string>();

  // Subida de archivos por lote
  subiendoFotos = false;
  progresoSubida = {
    actual: 0,
    total: 0,
    porcentaje: 0,
    nombreArchivo: ''
  };
  errorSubida = '';
  archivosRechazados: string[] = [];

  // Diálogos de confirmación
  confirmacionPublicar: { abierta: boolean; sesion: SesionFotograficaApi | null; nuevoEstado: EstadoSesion | null; procesando: boolean } = {
    abierta: false,
    sesion: null,
    nuevoEstado: null,
    procesando: false
  };

  confirmacionEliminarSesion: { abierta: boolean; sesion: SesionFotograficaApi | null; procesando: boolean; error: string } = {
    abierta: false,
    sesion: null,
    procesando: false,
    error: ''
  };

  confirmacionEliminarFoto: { abierta: boolean; foto: FotoSesionApi | null; procesando: boolean; error: string } = {
    abierta: false,
    foto: null,
    procesando: false,
    error: ''
  };

  // Visor de foto ampliada
  fotoAmpliada: FotoSesionApi | null = null;
  urlFotoAmpliada: string | null = null;
  cargandoFotoAmpliada = false;

  private versionPeticionSesiones = 0;
  private versionPeticionFotos = 0;

  constructor(
    public fotografiaApi: FotografiaApiService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    if (this.cliente) {
      void this.cargarSesiones();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['cliente']) {
      this.sesionSeleccionada = null;
      this.limpiarFotosYMiniaturas();
      if (this.cliente) {
        void this.cargarSesiones();
      } else {
        this.sesiones = [];
      }
    }
  }

  ngOnDestroy(): void {
    ++this.versionPeticionSesiones;
    ++this.versionPeticionFotos;
    this.limpiarFotosYMiniaturas();
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.fotoAmpliada) {
      this.cerrarFotoAmpliada();
      return;
    }
    if (this.confirmacionEliminarFoto.abierta && !this.confirmacionEliminarFoto.procesando) {
      this.cerrarConfirmacionEliminarFoto();
      return;
    }
    if (this.confirmacionEliminarSesion.abierta && !this.confirmacionEliminarSesion.procesando) {
      this.cerrarConfirmacionEliminarSesion();
      return;
    }
    if (this.confirmacionPublicar.abierta && !this.confirmacionPublicar.procesando) {
      this.cerrarConfirmacionPublicar();
      return;
    }
    if (this.modalSesion && !this.guardandoSesion) {
      this.cerrarModalSesion();
    }
  }

  // =========================================================================
  // GESTIÓN DE SESIONES
  // =========================================================================

  async cargarSesiones(): Promise<void> {
    if (!this.cliente) return;
    const version = ++this.versionPeticionSesiones;
    this.cargandoSesiones = true;
    this.errorSesiones = '';
    this.cdr.markForCheck();

    try {
      const lista = await this.fotografiaApi.listarSesiones(this.cliente.id);
      if (version !== this.versionPeticionSesiones) return;
      this.sesiones = Array.isArray(lista) ? lista : [];

      // Si había una sesión seleccionada, refrescar sus datos
      if (this.sesionSeleccionada) {
        const encontrada = this.sesiones.find((s) => s.id === this.sesionSeleccionada!.id);
        if (encontrada) {
          this.sesionSeleccionada = encontrada;
        }
      }
    } catch {
      if (version === this.versionPeticionSesiones) {
        this.errorSesiones = 'No se pudieron cargar las sesiones fotográficas.';
      }
    } finally {
      if (version === this.versionPeticionSesiones) {
        this.cargandoSesiones = false;
        this.cdr.markForCheck();
      }
    }
  }

  abrirCrearSesion(): void {
    this.editandoSesionId = null;
    this.formularioSesion = {
      nombre: '',
      fecha: '',
      descripcion: ''
    };
    this.errorGuardarSesion = '';
    this.modalSesion = true;
  }

  abrirEditarSesion(sesion: SesionFotograficaApi, event?: Event): void {
    event?.stopPropagation();
    this.editandoSesionId = sesion.id;
    this.formularioSesion = {
      nombre: sesion.nombre,
      fecha: sesion.fecha ? this.formatearFechaInput(sesion.fecha) : '',
      descripcion: sesion.descripcion || ''
    };
    this.errorGuardarSesion = '';
    this.modalSesion = true;
  }

  cerrarModalSesion(): void {
    this.modalSesion = false;
    this.guardandoSesion = false;
    this.errorGuardarSesion = '';
  }

  async guardarSesion(form: NgForm): Promise<void> {
    if (!this.cliente || form.invalid || this.guardandoSesion) return;

    this.guardandoSesion = true;
    this.errorGuardarSesion = '';
    this.cdr.markForCheck();

    const nombre = this.formularioSesion.nombre.trim();
    const fecha = this.formularioSesion.fecha ? this.formularioSesion.fecha : null;
    const descripcion = this.formularioSesion.descripcion.trim() || null;

    try {
      if (this.editandoSesionId) {
        const actualizada = await this.fotografiaApi.actualizarSesion(this.cliente.id, this.editandoSesionId, {
          nombre,
          fecha,
          descripcion
        });
        const index = this.sesiones.findIndex((s) => s.id === this.editandoSesionId);
        if (index !== -1) {
          this.sesiones[index] = { ...this.sesiones[index], ...actualizada };
        }
        if (this.sesionSeleccionada?.id === this.editandoSesionId) {
          this.sesionSeleccionada = { ...this.sesionSeleccionada, ...actualizada };
        }
      } else {
        const nueva = await this.fotografiaApi.crearSesion(this.cliente.id, {
          nombre,
          fecha,
          descripcion
        });
        this.sesiones.unshift(nueva);
        // Abrir automáticamente la sesión recién creada
        this.abrirSesion(nueva);
      }
      this.modalSesion = false;
    } catch (err: any) {
      this.errorGuardarSesion =
        err?.status === 422
          ? 'Por favor revisa los datos de la sesión.'
          : 'No se pudo guardar la sesión fotográfica.';
    } finally {
      this.guardandoSesion = false;
      this.cdr.markForCheck();
    }
  }

  abrirSesion(sesion: SesionFotograficaApi): void {
    this.sesionSeleccionada = sesion;
    this.limpiarFotosYMiniaturas();
    this.paginaFotos = 1;
    void this.cargarFotos(sesion.id);
  }

  volverAListaSesiones(): void {
    this.sesionSeleccionada = null;
    this.limpiarFotosYMiniaturas();
    void this.cargarSesiones();
  }

  // =========================================================================
  // PUBLICACIÓN / DESPUBLICACIÓN CON CONFIRMACIÓN
  // =========================================================================

  solicitarCambioPublicacion(sesion: SesionFotograficaApi, event?: Event): void {
    event?.stopPropagation();
    const nuevoEstado: EstadoSesion = sesion.estado === 'PUBLICADA' ? 'BORRADOR' : 'PUBLICADA';
    this.confirmacionPublicar = {
      abierta: true,
      sesion,
      nuevoEstado,
      procesando: false
    };
  }

  cerrarConfirmacionPublicar(): void {
    this.confirmacionPublicar = {
      abierta: false,
      sesion: null,
      nuevoEstado: null,
      procesando: false
    };
  }

  async confirmarCambioPublicacion(): Promise<void> {
    const { sesion, nuevoEstado } = this.confirmacionPublicar;
    if (!this.cliente || !sesion || !nuevoEstado || this.confirmacionPublicar.procesando) return;

    this.confirmacionPublicar.procesando = true;
    this.cdr.markForCheck();

    try {
      const actualizada = await this.fotografiaApi.actualizarSesion(this.cliente.id, sesion.id, {
        estado: nuevoEstado
      });

      const idx = this.sesiones.findIndex((s) => s.id === sesion.id);
      if (idx !== -1) {
        this.sesiones[idx] = { ...this.sesiones[idx], ...actualizada, estado: nuevoEstado };
      }
      if (this.sesionSeleccionada?.id === sesion.id) {
        this.sesionSeleccionada = { ...this.sesionSeleccionada, ...actualizada, estado: nuevoEstado };
      }
      this.cerrarConfirmacionPublicar();
    } catch {
      // Reintentar o mantener estado
      this.cerrarConfirmacionPublicar();
      this.errorSesiones = 'No se pudo actualizar el estado de publicación de la sesión.';
    } finally {
      this.cdr.markForCheck();
    }
  }

  // =========================================================================
  // ELIMINACIÓN DE SESIÓN CON CONFIRMACIÓN
  // =========================================================================

  solicitarEliminarSesion(sesion: SesionFotograficaApi, event?: Event): void {
    event?.stopPropagation();
    this.confirmacionEliminarSesion = {
      abierta: true,
      sesion,
      procesando: false,
      error: ''
    };
  }

  cerrarConfirmacionEliminarSesion(): void {
    this.confirmacionEliminarSesion = {
      abierta: false,
      sesion: null,
      procesando: false,
      error: ''
    };
  }

  async confirmarEliminarSesion(): Promise<void> {
    const sesion = this.confirmacionEliminarSesion.sesion;
    if (!this.cliente || !sesion || this.confirmacionEliminarSesion.procesando) return;

    this.confirmacionEliminarSesion.procesando = true;
    this.confirmacionEliminarSesion.error = '';
    this.cdr.markForCheck();

    try {
      await this.fotografiaApi.eliminarSesion(this.cliente.id, sesion.id);
      this.sesiones = this.sesiones.filter((s) => s.id !== sesion.id);
      if (this.sesionSeleccionada?.id === sesion.id) {
        this.volverAListaSesiones();
      }
      this.cerrarConfirmacionEliminarSesion();
    } catch {
      this.confirmacionEliminarSesion.error = 'No se pudo eliminar la sesión. Inténtalo de nuevo.';
      this.confirmacionEliminarSesion.procesando = false;
      this.cdr.markForCheck();
    }
  }

  // =========================================================================
  // FOTOS Y SUBIDA EN LOTE
  // =========================================================================

  async cargarFotos(sesionId: string): Promise<void> {
    if (!this.cliente) return;
    const version = ++this.versionPeticionFotos;
    this.cargandoFotos = true;
    this.errorFotos = '';
    this.cdr.markForCheck();

    try {
      const resp: PaginaFotosApi = await this.fotografiaApi.listarFotos(
        this.cliente.id,
        sesionId,
        this.paginaFotos,
        this.limiteFotos
      );

      if (version !== this.versionPeticionFotos) return;

      this.fotos = resp.items || [];
      this.totalFotos = resp.total || this.fotos.length;
      this.paginaFotos = resp.pagina || 1;
      this.limiteFotos = resp.limite || 48;
      this.totalPaginasFotos = Math.max(1, Math.ceil(this.totalFotos / this.limiteFotos));

      // Actualizar contador en la sesión
      if (this.sesionSeleccionada) {
        this.sesionSeleccionada = {
          ...this.sesionSeleccionada,
          cantidadFotos: this.totalFotos
        };
      }

      // Cargar miniaturas de las fotos visibles
      void this.cargarMiniaturasVisibles();
    } catch {
      if (version === this.versionPeticionFotos) {
        this.errorFotos = 'No se pudieron cargar las fotos de la sesión.';
      }
    } finally {
      if (version === this.versionPeticionFotos) {
        this.cargandoFotos = false;
        this.cdr.markForCheck();
      }
    }
  }

  private async cargarMiniaturasVisibles(): Promise<void> {
    if (!this.cliente || !this.sesionSeleccionada) return;
    const clienteId = this.cliente.id;
    const sesionId = this.sesionSeleccionada.id;

    for (const foto of this.fotos) {
      if (!this.urlsMiniaturas.has(foto.id) && !this.cargandoMiniatura.has(foto.id)) {
        this.cargandoMiniatura.add(foto.id);
        void this.fotografiaApi
          .obtenerUrlMiniatura(clienteId, sesionId, foto.id)
          .then((url) => {
            this.urlsMiniaturas.set(foto.id, url);
            this.cargandoMiniatura.delete(foto.id);
            this.cdr.markForCheck();
          })
          .catch(() => {
            this.cargandoMiniatura.delete(foto.id);
          });
      }
    }
  }

  dispararSelectorArchivos(): void {
    if (this.subiendoFotos) return;
    this.fileInput?.nativeElement.click();
  }

  async onArchivosSeleccionados(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0 || !this.cliente || !this.sesionSeleccionada) return;

    const listaArchivos = Array.from(input.files);
    // Limpiar input para permitir seleccionar mismos archivos si es necesario
    input.value = '';

    await this.procesarSubidaLote(listaArchivos);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    if (this.subiendoFotos || !this.cliente || !this.sesionSeleccionada) return;

    const dataTransfer = event.dataTransfer;
    if (dataTransfer?.files && dataTransfer.files.length > 0) {
      const archivos = Array.from(dataTransfer.files).filter((f) => f.type.startsWith('image/'));
      if (archivos.length > 0) {
        await this.procesarSubidaLote(archivos);
      }
    }
  }

  private async procesarSubidaLote(archivos: File[]): Promise<void> {
    if (!this.cliente || !this.sesionSeleccionada) return;
    const clienteId = this.cliente.id;
    const sesionId = this.sesionSeleccionada.id;

    this.subiendoFotos = true;
    this.errorSubida = '';
    this.archivosRechazados = [];
    const total = archivos.length;
    this.progresoSubida = {
      actual: 0,
      total,
      porcentaje: 0,
      nombreArchivo: ''
    };
    this.cdr.markForCheck();

    let subidasExitosas = 0;

    for (let i = 0; i < total; i++) {
      const archivo = archivos[i];
      this.progresoSubida = {
        actual: i + 1,
        total,
        porcentaje: Math.round(((i + 1) / total) * 100),
        nombreArchivo: archivo.name
      };
      this.cdr.markForCheck();

      try {
        await this.fotografiaApi.subirFoto(clienteId, sesionId, archivo);
        subidasExitosas++;
      } catch {
        this.archivosRechazados.push(archivo.name);
      }
    }

    if (this.archivosRechazados.length > 0) {
      this.errorSubida = `${this.archivosRechazados.length} foto(s) no se pudieron subir: ${this.archivosRechazados.slice(0, 3).join(', ')}${this.archivosRechazados.length > 3 ? '...' : ''}`;
    }

    this.subiendoFotos = false;
    this.cdr.markForCheck();

    if (subidasExitosas > 0) {
      await this.cargarFotos(sesionId);
    }
  }

  // =========================================================================
  // ACCIONES SOBRE FOTOS (PORTADA, ORDEN, BORRADO)
  // =========================================================================

  async marcarComoPortada(foto: FotoSesionApi, event?: Event): Promise<void> {
    event?.stopPropagation();
    if (!this.cliente || !this.sesionSeleccionada) return;

    try {
      await this.fotografiaApi.actualizarSesion(this.cliente.id, this.sesionSeleccionada.id, {
        portadaFotoId: foto.id
      });
      this.sesionSeleccionada = {
        ...this.sesionSeleccionada,
        portadaFotoId: foto.id
      };
      this.cdr.markForCheck();
    } catch {
      // Reintentar vía patch foto si el backend soporta esa variante
      try {
        await this.fotografiaApi.actualizarFoto(this.cliente.id, this.sesionSeleccionada.id, foto.id, {
          portada: true
        });
        this.sesionSeleccionada = {
          ...this.sesionSeleccionada,
          portadaFotoId: foto.id
        };
        this.cdr.markForCheck();
      } catch {
        // Falló portada
      }
    }
  }

  esPortada(foto: FotoSesionApi): boolean {
    if (this.sesionSeleccionada?.portadaFotoId) {
      return this.sesionSeleccionada.portadaFotoId === foto.id;
    }
    return !!foto.esPortada;
  }

  async cambiarOrdenFoto(foto: FotoSesionApi, delta: number, event?: Event): Promise<void> {
    event?.stopPropagation();
    if (!this.cliente || !this.sesionSeleccionada) return;
    const indice = this.fotos.findIndex((f) => f.id === foto.id);
    if (indice === -1) return;

    const nuevoIndice = indice + delta;
    if (nuevoIndice < 0 || nuevoIndice >= this.fotos.length) return;

    // Swap local inmediato para UI reactiva
    const temp = this.fotos[indice];
    this.fotos[indice] = this.fotos[nuevoIndice];
    this.fotos[nuevoIndice] = temp;
    this.cdr.markForCheck();

    try {
      await this.fotografiaApi.actualizarFoto(this.cliente.id, this.sesionSeleccionada.id, foto.id, {
        orden: nuevoIndice
      });
    } catch {
      // Si falla, revertir
      this.fotos[nuevoIndice] = this.fotos[indice];
      this.fotos[indice] = temp;
      this.cdr.markForCheck();
    }
  }

  solicitarEliminarFoto(foto: FotoSesionApi, event?: Event): void {
    event?.stopPropagation();
    this.confirmacionEliminarFoto = {
      abierta: true,
      foto,
      procesando: false,
      error: ''
    };
  }

  cerrarConfirmacionEliminarFoto(): void {
    this.confirmacionEliminarFoto = {
      abierta: false,
      foto: null,
      procesando: false,
      error: ''
    };
  }

  async confirmarEliminarFoto(): Promise<void> {
    const foto = this.confirmacionEliminarFoto.foto;
    if (!this.cliente || !this.sesionSeleccionada || !foto || this.confirmacionEliminarFoto.procesando) return;

    this.confirmacionEliminarFoto.procesando = true;
    this.confirmacionEliminarFoto.error = '';
    this.cdr.markForCheck();

    try {
      await this.fotografiaApi.eliminarFoto(this.cliente.id, this.sesionSeleccionada.id, foto.id);
      this.urlsMiniaturas.delete(foto.id);
      this.fotos = this.fotos.filter((f) => f.id !== foto.id);
      this.totalFotos = Math.max(0, this.totalFotos - 1);
      if (this.sesionSeleccionada.portadaFotoId === foto.id) {
        this.sesionSeleccionada = { ...this.sesionSeleccionada, portadaFotoId: null };
      }
      this.cerrarConfirmacionEliminarFoto();
    } catch {
      this.confirmacionEliminarFoto.error = 'No se pudo eliminar la fotografía.';
      this.confirmacionEliminarFoto.procesando = false;
      this.cdr.markForCheck();
    }
  }

  // =========================================================================
  // VISOR DE FOTO AMPLIADA
  // =========================================================================

  async abrirFotoAmpliada(foto: FotoSesionApi): Promise<void> {
    if (!this.cliente || !this.sesionSeleccionada) return;
    this.fotoAmpliada = foto;
    this.urlFotoAmpliada = this.urlsMiniaturas.get(foto.id) || null;
    this.cargandoFotoAmpliada = true;

    try {
      const blob = await this.fotografiaApi.obtenerContenidoBlob(
        this.cliente.id,
        this.sesionSeleccionada.id,
        foto.id,
        'original'
      );
      this.urlFotoAmpliada = URL.createObjectURL(blob);
    } catch {
      // Usa miniatura como fallback si original falla
    } finally {
      this.cargandoFotoAmpliada = false;
      this.cdr.markForCheck();
    }
  }

  cerrarFotoAmpliada(): void {
    if (this.urlFotoAmpliada && !this.urlsMiniaturas.has(this.fotoAmpliada?.id || '')) {
      try {
        URL.revokeObjectURL(this.urlFotoAmpliada);
      } catch {
        // Ignorar
      }
    }
    this.fotoAmpliada = null;
    this.urlFotoAmpliada = null;
    this.cargandoFotoAmpliada = false;
  }

  // =========================================================================
  // PAGINACIÓN DE FOTOS
  // =========================================================================

  cambiarPaginaFotos(nuevaPagina: number): void {
    if (nuevaPagina < 1 || nuevaPagina > this.totalPaginasFotos || nuevaPagina === this.paginaFotos) return;
    this.paginaFotos = nuevaPagina;
    if (this.sesionSeleccionada) {
      void this.cargarFotos(this.sesionSeleccionada.id);
    }
  }

  // =========================================================================
  // UTILIDADES Y FORMATEO
  // =========================================================================

  private limpiarFotosYMiniaturas(): void {
    this.fotos = [];
    this.urlsMiniaturas.clear();
    this.cargandoMiniatura.clear();
    this.fotografiaApi.revocarTodasMiniaturas();
    this.cerrarFotoAmpliada();
  }

  formatearFecha(fechaIso?: string | null): string {
    if (!fechaIso) return 'Sin fecha';
    const fecha = new Date(fechaIso);
    if (isNaN(fecha.getTime())) return 'Sin fecha';
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${fecha.getDate()} ${meses[fecha.getMonth()]} ${fecha.getFullYear()}`;
  }

  private formatearFechaInput(fechaIso: string): string {
    const fecha = new Date(fechaIso);
    if (isNaN(fecha.getTime())) return '';
    return fecha.toISOString().substring(0, 10);
  }

  formatearTamano(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
