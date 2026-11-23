import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { UiStateService } from '../state/ui-state.service';
import { ClientesProyectosApiService, ProyectoApi } from '../services/clientes-proyectos-api.service';
import { AuthService } from '../auth/auth.service';
import { obtenerBaseApi } from '../auth/api.config';
import { Router } from '@angular/router';

export interface ProyectoVisual extends ProyectoApi {
  indexStr: string;
  tabNum: string;
  variant: 'blue' | 'kraft' | 'cream' | 'lime';
  previewStyle: 'editorial' | 'blueprint' | 'craft' | 'monochrome';
  statusDisplay: string;
  categoryDisplay: string;
  initials: string;
  formattedDate: string;
  posX: number;
  posY: number;
  connX: number;
  connY: number;
  tiltDeg: number;
  curvePath: string;
}

@Component({
  selector: 'app-work-map',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './work-map.component.html',
  styleUrls: ['./work-map.component.css']
})
export class WorkMapComponent implements OnInit, AfterViewInit, OnDestroy {
  cargando = false;
  error = '';

  // Canvas Pan & Zoom
  zoomLevel = 80;
  panX = 0;
  panY = 0;
  isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragMoved = false;
  private lastDragEndTime = 0;
  private pinchStartDist = 0;
  private pinchStartZoom = 80;
  private userAdjustedView = false;
  private containerWidth = 0;
  private containerHeight = 0;
  private resizeObserver: ResizeObserver | null = null;

  // Caching / memoization to avoid re-rendering and identity churn on every change detection
  private cachedProyectosVisuales: ProyectoVisual[] = [];
  private lastProyectosRef: ProyectoApi[] | null = null;
  private lastSeleccionadoId: string | null = null;
  private lastStudioName = '';
  private lastViewportBucket: 'xs' | 'sm' | 'md' | 'desktop' = 'desktop';
  private lastResponsiveBand: 'xs' | 'sm' | 'md' | 'stacked' | 'tablet-2col' | 'desktop' = 'desktop';

  // Studio and Hub identity
  studioName = 'EQUINOX';
  hubLine1 = 'MI';
  hubLine2 = 'ESTUDIO';

  stageWidth = 1000;
  stageHeight = 760;
  hubX = 500;
  hubY = 390;

  private readonly variantsOrder: Array<'cream' | 'lime' | 'kraft'> = ['cream', 'cream', 'lime', 'kraft'];
  private readonly previewStylesOrder: Array<'editorial' | 'blueprint' | 'craft' | 'monochrome'> = [
    'editorial',
    'blueprint',
    'craft',
    'monochrome'
  ];
  private readonly tiltsOrder = [-0.8, 0.8, 1.1, -1.1, 0.5, -0.5];

  constructor(
    public state: UiStateService,
    public api: ClientesProyectosApiService,
    private http: HttpClient,
    private router: Router,
    private auth: AuthService,
    private ngZone: NgZone,
    private hostElement: ElementRef<HTMLElement>
  ) {}

  ngOnInit(): void {
    this.lastResponsiveBand = this.obtenerResponsiveBand();
    this.zoomLevel = this.obtenerZoomInicial();
    void this.cargar();
    void this.cargarDatosOrganizacion();
  }

  ngAfterViewInit(): void {
    if (typeof window !== 'undefined') window.addEventListener('resize', this.onWindowResize);
    const el = this.hostElement?.nativeElement.querySelector('.map-canvas-container');
    if (!el || typeof ResizeObserver === 'undefined') return;

    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      if (w <= 0 || h <= 0) return;
      if (w === this.containerWidth && h === this.containerHeight) return;

      this.containerWidth = w;
      this.containerHeight = h;
      this.ngZone.run(() => {
        this.sincronizarZoomPorContenedor(false);
      });
    });
    this.resizeObserver.observe(el);
  }

  private obtenerViewportBucket(): 'xs' | 'sm' | 'md' | 'desktop' {
    if (typeof window === 'undefined') return 'desktop';
    if (window.innerWidth <= 360) return 'xs';
    if (window.innerWidth <= 480) return 'sm';
    if (window.innerWidth <= 780) return 'md';
    return 'desktop';
  }

  private obtenerResponsiveBand(): 'xs' | 'sm' | 'md' | 'stacked' | 'tablet-2col' | 'desktop' {
    if (typeof window === 'undefined') return 'desktop';
    const vw = window.innerWidth;
    if (vw <= 360) return 'xs';
    if (vw <= 640) return 'sm';
    if (vw <= 780) return 'md';
    if (vw <= 900) return 'stacked';
    if (vw < 1100) return 'tablet-2col';
    return 'desktop';
  }

  private obtenerZoomInicial(containerW = this.containerWidth, containerH = this.containerHeight): number {
    if (typeof window === 'undefined') return 80;
    const vw = window.innerWidth;
    if (vw <= 360) return 45;
    if (vw <= 640) return 55;
    if (vw <= 780) return 68;
    if (vw <= 900 || vw >= 1100) return 80;

    // 901-1099px (modo dos columnas): adaptar al ancho y alto real del contenedor
    const realW = containerW > 0 ? containerW : Math.max(580, vw - 310);
    const realH = containerH > 0 ? containerH : Math.max(500, window.innerHeight - 64);
    const total = this.api.proyectos.length;
    const contentW = total <= 2 ? 760 : 880;
    const contentH = total <= 2 ? 490 : 690;

    const zoomW = ((realW - 24) / contentW) * 100;
    const zoomH = ((realH - 130) / contentH) * 100;
    const fitted = Math.floor(Math.min(80, zoomW, zoomH));
    return Math.max(52, Math.min(80, fitted));
  }

  private sincronizarZoomPorContenedor(forzarResetPan: boolean): void {
    const band = this.obtenerResponsiveBand();
    const cambioBand = band !== this.lastResponsiveBand;
    this.lastResponsiveBand = band;

    if (cambioBand) {
      this.userAdjustedView = false;
      this.zoomLevel = this.obtenerZoomInicial();
      this.panX = 0;
      this.panY = 0;
      return;
    }

    if (band === 'tablet-2col' && !this.userAdjustedView) {
      this.zoomLevel = this.obtenerZoomInicial();
      if (forzarResetPan) {
        this.panX = 0;
        this.panY = 0;
      }
    }
  }

  private onWindowResize = (): void => {
    this.ngZone.run(() => this.sincronizarZoomPorContenedor(true));
  };

  async cargarDatosOrganizacion(): Promise<void> {
    try {
      const org = await firstValueFrom(this.http.get<{ nombre?: string }>(`${obtenerBaseApi()}/organizacion`));
      if (org?.nombre) {
        this.studioName = org.nombre.toUpperCase();
        const partes = org.nombre.trim().split(/\s+/);
        if (partes.length >= 2) {
          this.hubLine1 = partes[0].toUpperCase();
          this.hubLine2 = partes.slice(1).join(' ').toUpperCase();
        } else {
          this.hubLine1 = org.nombre.toUpperCase();
          this.hubLine2 = 'ESTUDIO';
        }
      } else {
        this.derivarNombreDesdeSesion();
      }
    } catch {
      this.derivarNombreDesdeSesion();
    }
  }

  private derivarNombreDesdeSesion(): void {
    const usuario = this.auth?.sesion?.usuario;
    if (usuario?.nombre) {
      const nom = `${usuario.nombre} ${usuario.apellido || ''}`.trim().toUpperCase();
      this.studioName = `${nom} · ESTUDIO`;
      this.hubLine1 = usuario.nombre.toUpperCase();
      this.hubLine2 = usuario.apellido ? usuario.apellido.toUpperCase() : 'ESTUDIO';
    } else {
      this.studioName = 'EQUINOX ESTUDIO';
      this.hubLine1 = 'EQUINOX';
      this.hubLine2 = 'ESTUDIO';
    }
  }

  async cargar(): Promise<void> {
    this.cargando = true;
    this.error = '';
    try {
      const [proyectos] = await Promise.all([
        this.api.listarProyectos(),
        this.api.listarClientes()
      ]);
      const seleccionado = this.api.proyectoSeleccionado;
      const guardadoId = this.api.obtenerProyectoGuardadoId();
      const idPreferido = seleccionado?.id || guardadoId;

      if (idPreferido && proyectos.some((p) => p.id === idPreferido)) {
        if (seleccionado?.id !== idPreferido) {
          await this.api.seleccionarProyecto(idPreferido);
        }
      } else {
        this.api.limpiarProyectoSeleccionado();
        if (proyectos.length) {
          await this.api.seleccionarProyecto(proyectos[0].id);
        }
      }
    } catch {
      this.error = 'No se pudo cargar el mapa de proyectos.';
    } finally {
      this.cargando = false;
      if (!this.userAdjustedView && this.obtenerResponsiveBand() === 'tablet-2col') {
        this.zoomLevel = this.obtenerZoomInicial();
      }
    }
  }

  get totalActivos(): number {
    return this.api.proyectos.filter((p) => p.estado === 'ACTIVO').length;
  }

  get totalProyectosVisibles(): number {
    return this.proyectosVisuales.length;
  }

  obtenerEstadoLegible(estado?: string): string {
    switch (estado) {
      case 'ACTIVO': return 'En desarrollo';
      case 'COMPLETADO': return 'Completado';
      case 'PAUSADO': return 'En pausa';
      case 'BORRADOR': return 'Borrador';
      case 'CANCELADO': return 'Cancelado';
      default: return estado ? estado.toLowerCase() : 'En desarrollo';
    }
  }

  obtenerInicialesProyecto(nombre: string): string {
    if (!nombre) return 'EQ';
    const partes = nombre.trim().split(/\s+/);
    if (partes.length >= 2) {
      return (partes[0][0] + partes[1][0]).toUpperCase();
    }
    return nombre.substring(0, 2).toUpperCase();
  }

  formatearFechaCorta(d?: Date | null): string {
    if (!d || isNaN(d.getTime())) return '';
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const dia = d.getUTCDate();
    const mes = meses[d.getUTCMonth()];
    return `${dia} ${mes}`;
  }

  private calcularPosicionYConector(idx: number, total: number): {
    posX: number;
    posY: number;
    connX: number;
    connY: number;
    curvePath: string;
  } {
    let offsetX = 0;
    let offsetY = 0;
    const bucket = this.obtenerViewportBucket();

    if (total === 1) {
      if (bucket === 'xs' || bucket === 'sm') {
        offsetX = -125;
        offsetY = 142;
      } else {
        offsetX = 195;
        offsetY = -95;
      }
    } else if (total === 2) {
      const spanX = bucket === 'xs' || bucket === 'sm' ? 168 : bucket === 'md' ? 180 : 195;
      const spanY = bucket === 'xs' || bucket === 'sm' ? 121 : bucket === 'md' ? 126 : 125;
      if (idx === 0) {
        offsetX = -spanX;
        offsetY = spanY;
      } else {
        offsetX = spanX;
        offsetY = -spanY;
      }
    } else if (idx < 6) {
      const angulos = [-150, -30, 30, 150, -90, 90];
      const rad = (angulos[idx] * Math.PI) / 180;
      const rx = bucket === 'xs' ? 235 : bucket === 'sm' ? 255 : bucket === 'md' ? 295 : 340;
      const ry = bucket === 'xs' ? 185 : bucket === 'sm' ? 195 : bucket === 'md' ? 220 : 240;
      offsetX = Math.cos(rad) * rx;
      offsetY = Math.sin(rad) * ry;
    } else {
      // Anillos exteriores para 7+ proyectos sin superposición
      let restante = idx - 6;
      let ring = 1;
      let cap = 10;
      while (restante >= cap) {
        restante -= cap;
        ring++;
        cap = 6 + ring * 4;
      }
      const rx = 340 + ring * 380;
      const ry = 240 + ring * 280;
      const rad = (((restante + 0.5) / cap) * 2 * Math.PI) - Math.PI / 2;
      offsetX = Math.cos(rad) * rx;
      offsetY = Math.sin(rad) * ry;
    }

    const posX = Math.round(this.hubX + offsetX);
    const posY = Math.round(this.hubY + offsetY);

    const dx = posX - this.hubX;
    const dy = posY - this.hubY;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;

    // Borde del círculo central (radio 48px)
    const startX = this.hubX + ux * 48;
    const startY = this.hubY + uy * 48;

    // Intersección exacta con el borde de la tarjeta (260x195 -> semi-ejes 130, 97.5)
    const tx = Math.abs(ux) > 1e-4 ? 130 / Math.abs(ux) : Infinity;
    const ty = Math.abs(uy) > 1e-4 ? 97.5 / Math.abs(uy) : Infinity;
    const t = Math.min(tx, ty);
    const connX = Math.round((posX - ux * t) * 10) / 10;
    const connY = Math.round((posY - uy * t) * 10) / 10;

    const span = Math.hypot(connX - startX, connY - startY);
    const perp = Math.min(20, span * 0.14) * (idx % 2 === 0 ? 1 : -1);
    const c1x = startX + (connX - startX) * 0.35 - uy * perp;
    const c1y = startY + (connY - startY) * 0.35 + ux * perp;
    const c2x = startX + (connX - startX) * 0.72 + uy * perp * 0.45;
    const c2y = startY + (connY - startY) * 0.72 - ux * perp * 0.45;

    const curvePath = `M ${startX.toFixed(1)} ${startY.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${connX} ${connY}`;
    return { posX, posY, connX, connY, curvePath };
  }

  get proyectosVisuales(): ProyectoVisual[] {
    const proyectos = this.api.proyectos;
    const seleccionadoId = this.api.proyectoSeleccionado?.id ?? null;
    const viewportBucket = this.obtenerViewportBucket();

    if (
      this.cachedProyectosVisuales.length === proyectos.length &&
      this.lastProyectosRef === proyectos &&
      this.lastSeleccionadoId === seleccionadoId &&
      this.lastStudioName === this.studioName &&
      this.lastViewportBucket === viewportBucket
    ) {
      return this.cachedProyectosVisuales;
    }

    this.lastProyectosRef = proyectos;
    this.lastSeleccionadoId = seleccionadoId;
    this.lastStudioName = this.studioName;
    this.lastViewportBucket = viewportBucket;

    const total = proyectos.length;
    if (total > 6) {
      let maxRing = 1;
      let rem = total - 6;
      while (rem > 6 + maxRing * 4) {
        rem -= 6 + maxRing * 4;
        maxRing++;
      }
      const rxMax = 340 + maxRing * 380;
      const ryMax = 240 + maxRing * 280;
      this.stageWidth = Math.max(1000, Math.ceil((rxMax + 180) * 2));
      this.stageHeight = Math.max(760, Math.ceil((ryMax + 150) * 2));
    } else {
      this.stageWidth = 1000;
      this.stageHeight = 760;
    }
    this.hubX = Math.round(this.stageWidth / 2);
    if (viewportBucket === 'desktop') {
      this.hubY = Math.round(this.stageHeight / 2) + 10;
    } else if (total === 0) {
      this.hubY = Math.round(this.stageHeight / 2) - 55;
    } else {
      this.hubY = Math.round(this.stageHeight / 2) + 31;
    }

    this.cachedProyectosVisuales = proyectos.map((p, idx) => {
      const tabNum = idx < 9 ? `0${idx + 1}` : `${idx + 1}`;
      const isSelected = p.id === seleccionadoId;
      const defaultVariant = this.variantsOrder[idx % this.variantsOrder.length];
      const variant = isSelected ? 'blue' : defaultVariant;
      const previewStyle = this.previewStylesOrder[idx % this.previewStylesOrder.length];
      const tiltDeg = this.tiltsOrder[idx % this.tiltsOrder.length];

      const statusDisplay = this.obtenerEstadoLegible(p.estado);

      let categoryDisplay = '';
      if (p.cliente?.empresa) {
        categoryDisplay = p.cliente.empresa;
      } else if (p.cliente?.nombre) {
        categoryDisplay = p.cliente.nombre;
      } else if (p.descripcion?.trim()) {
        categoryDisplay = p.descripcion.trim();
      } else {
        categoryDisplay = 'Proyecto en curso';
      }

      if (p.fechaEntrega) {
        const fechaCorta = this.formatearFechaCorta(new Date(p.fechaEntrega));
        if (fechaCorta) {
          categoryDisplay = `${categoryDisplay} · ${fechaCorta}`;
        }
      }

      const initials = this.obtenerInicialesProyecto(p.nombre);
      const formattedDate = p.fechaEntrega ? this.formatearFechaCorta(new Date(p.fechaEntrega)) : '';
      const geom = this.calcularPosicionYConector(idx, total);

      return {
        ...p,
        indexStr: tabNum,
        tabNum,
        variant,
        previewStyle,
        statusDisplay,
        categoryDisplay,
        initials,
        formattedDate,
        posX: geom.posX,
        posY: geom.posY,
        connX: geom.connX,
        connY: geom.connY,
        tiltDeg,
        curvePath: geom.curvePath
      };
    });

    return this.cachedProyectosVisuales;
  }

  trackByProyectoId(_index: number, item: ProyectoVisual): string {
    return item.id;
  }

  async seleccionar(p: ProyectoVisual): Promise<void> {
    if (Date.now() - this.lastDragEndTime < 180) {
      return;
    }
    this.error = '';
    try {
      await this.api.seleccionarProyecto(p.id);
    } catch {
      this.error = 'No se pudieron consultar los datos del proyecto.';
    }
  }

  zoomIn(): void {
    this.userAdjustedView = true;
    this.zoomLevel = Math.min(130, this.zoomLevel + 10);
  }

  zoomOut(): void {
    this.userAdjustedView = true;
    this.zoomLevel = Math.max(45, this.zoomLevel - 10);
  }

  resetZoom(): void {
    this.userAdjustedView = false;
    this.zoomLevel = this.obtenerZoomInicial();
    this.panX = 0;
    this.panY = 0;
  }

  private onDocMouseMove = (e: MouseEvent): void => {
    if (!this.isDragging) return;
    const nextX = e.clientX - this.dragStartX;
    const nextY = e.clientY - this.dragStartY;
    if (Math.hypot(nextX - this.panX, nextY - this.panY) > 3) {
      this.dragMoved = true;
      this.userAdjustedView = true;
    }
    this.panX = nextX;
    this.panY = nextY;
  };

  private onDocMouseUp = (): void => {
    if (this.isDragging) {
      this.isDragging = false;
      if (this.dragMoved) {
        this.lastDragEndTime = Date.now();
      }
      this.dragMoved = false;
      document.removeEventListener('mousemove', this.onDocMouseMove);
      document.removeEventListener('mouseup', this.onDocMouseUp);
    }
  };

  onMouseDown(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (target.closest('.folder-node') || target.closest('.central-hub') || target.closest('.zoom-dock') || target.closest('.command-dock') || target.closest('.empty-map-node') || target.closest('.canvas-header')) {
      return;
    }
    this.isDragging = true;
    this.dragMoved = false;
    this.dragStartX = e.clientX - this.panX;
    this.dragStartY = e.clientY - this.panY;
    document.addEventListener('mousemove', this.onDocMouseMove);
    document.addEventListener('mouseup', this.onDocMouseUp);
  }

  onTouchStart(e: TouchEvent): void {
    const target = e.target as HTMLElement;
    if (target.closest('.folder-node') || target.closest('.central-hub') || target.closest('.zoom-dock') || target.closest('.command-dock') || target.closest('.empty-map-node') || target.closest('.canvas-header')) {
      return;
    }
    if (e.touches && e.touches.length === 2) {
      this.isDragging = false;
      this.pinchStartDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      this.pinchStartZoom = this.zoomLevel;
      return;
    }
    if (e.touches && e.touches.length === 1) {
      this.pinchStartDist = 0;
      this.isDragging = true;
      this.dragMoved = false;
      this.dragStartX = e.touches[0].clientX - this.panX;
      this.dragStartY = e.touches[0].clientY - this.panY;
    }
  }

  onTouchMove(e: TouchEvent): void {
    if (e.touches && e.touches.length === 2 && this.pinchStartDist > 0) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const nextZoom = Math.round(this.pinchStartZoom * (dist / this.pinchStartDist));
      this.userAdjustedView = true;
      this.zoomLevel = Math.max(45, Math.min(130, nextZoom));
      return;
    }
    if (!this.isDragging || !e.touches || e.touches.length !== 1) return;
    const nextX = e.touches[0].clientX - this.dragStartX;
    const nextY = e.touches[0].clientY - this.dragStartY;
    if (Math.hypot(nextX - this.panX, nextY - this.panY) > 3) {
      this.dragMoved = true;
      this.userAdjustedView = true;
    }
    this.panX = nextX;
    this.panY = nextY;
  }

  onTouchEnd(): void {
    this.pinchStartDist = 0;
    if (this.dragMoved) {
      this.lastDragEndTime = Date.now();
    }
    this.isDragging = false;
    this.dragMoved = false;
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (typeof window !== 'undefined') window.removeEventListener('resize', this.onWindowResize);
    document.removeEventListener('mousemove', this.onDocMouseMove);
    document.removeEventListener('mouseup', this.onDocMouseUp);
  }

  abrirProyectos(): void {
    void this.router.navigate(['/proyectos']);
  }
}
