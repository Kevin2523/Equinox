import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import type { Request, Response } from "express";
import { hooksPruebas, estanHooksHabilitados } from "../utilidades/hooks-pruebas.js";

export interface EntradaRateLimit {
  cuenta: number;
  expiraEn: number;
}

export interface ResultadoIncrementoRateLimit {
  permitido: boolean;
  cuenta: number;
  expiraEn: number;
}

export interface AlmacenRateLimit {
  incrementar(clave: string, ventanaMs: number, limiteMax: number, capacidadMax: number): Promise<ResultadoIncrementoRateLimit> | ResultadoIncrementoRateLimit;
  consultar(clave: string): Promise<EntradaRateLimit | null> | EntradaRateLimit | null;
  reiniciarClave(clave: string): Promise<void> | void;
  reiniciarTodo(): Promise<void> | void;
  tamano(): number;
  detener(): void;
}

/**
 * Almacén acotado en memoria por proceso.
 */
export class AlmacenMemoriaRateLimit implements AlmacenRateLimit {
  private almacenes = new Map<string, EntradaRateLimit>();
  private intervaloLimpieza: NodeJS.Timeout | null = null;

  constructor() {
    this.intervaloLimpieza = setInterval(() => {
      this.limpiarExpiradas();
    }, 60000);
    this.intervaloLimpieza.unref();
  }

  limpiarExpiradas(): void {
    const ahora = hooksPruebas.obtenerAhora().getTime();
    for (const [clave, entrada] of this.almacenes.entries()) {
      if (entrada.expiraEn <= ahora) {
        this.almacenes.delete(clave);
      }
    }
  }

  detener(): void {
    if (this.intervaloLimpieza) {
      clearInterval(this.intervaloLimpieza);
      this.intervaloLimpieza = null;
    }
  }

  tamano(): number {
    return this.almacenes.size;
  }

  reiniciarClave(clave: string): void {
    this.almacenes.delete(clave);
  }

  reiniciarTodo(): void {
    this.almacenes.clear();
  }

  consultar(clave: string): EntradaRateLimit | null {
    const ahora = hooksPruebas.obtenerAhora().getTime();
    const entrada = this.almacenes.get(clave);
    if (!entrada || entrada.expiraEn <= ahora) {
      if (entrada) this.almacenes.delete(clave);
      return null;
    }
    return entrada;
  }

  incrementar(
    clave: string,
    ventanaMs: number,
    limiteMax: number,
    capacidadMax: number
  ): ResultadoIncrementoRateLimit {
    const ahora = hooksPruebas.obtenerAhora().getTime();
    let entrada = this.almacenes.get(clave);

    if (!entrada || entrada.expiraEn <= ahora) {
      if (this.almacenes.size >= capacidadMax) {
        this.limpiarExpiradas();
      }
      if (this.almacenes.size >= capacidadMax) {
        let primeraExpiracion = ahora + ventanaMs;
        for (const vigente of this.almacenes.values()) {
          primeraExpiracion = Math.min(primeraExpiracion, vigente.expiraEn);
        }
        return { permitido: false, cuenta: limiteMax + 1, expiraEn: primeraExpiracion };
      }

      entrada = { cuenta: 1, expiraEn: ahora + ventanaMs };
      this.almacenes.set(clave, entrada);
      return { permitido: true, cuenta: 1, expiraEn: entrada.expiraEn };
    }

    if (entrada.cuenta >= limiteMax) {
      return { permitido: false, cuenta: entrada.cuenta, expiraEn: entrada.expiraEn };
    }

    entrada.cuenta++;
    return { permitido: true, cuenta: entrada.cuenta, expiraEn: entrada.expiraEn };
  }
}

/**
 * Almacén distribuido opcional sobre Redis/Valkey (RESP2 sin dependencias externas).
 * Se activa cuando `REDIS_URL` está definida en el entorno.
 */
export class AlmacenRedisRateLimit implements AlmacenRateLimit {
  private readonly url: URL;
  private readonly prefijo: string;

  constructor(redisUrl: string, prefijo = "equinox:rl:") {
    this.url = new URL(redisUrl);
    this.prefijo = prefijo;
  }

  tamano(): number {
    return 0;
  }

  detener(): void {
    // Conexiones efímeras por comando o bajo demanda; sin timers persistentes
  }

  private async ejecutarComandos(comandos: string[][]): Promise<Array<string | number | null>> {
    const puerto = Number(this.url.port || (this.url.protocol === "rediss:" ? 6380 : 6379));
    const host = this.url.hostname || "127.0.0.1";
    const password = this.url.password ? decodeURIComponent(this.url.password) : "";
    const username = this.url.username ? decodeURIComponent(this.url.username) : "";

    const todos: string[][] = [];
    if (password) {
      todos.push(username ? ["AUTH", username, password] : ["AUTH", password]);
    }
    todos.push(...comandos);

    const payload = todos
      .map((cmd) => `*${cmd.length}\r\n${cmd.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join("")}`)
      .join("");

    return new Promise((resolve, reject) => {
      const socket =
        this.url.protocol === "rediss:"
          ? tlsConnect({ host, port: puerto })
          : netConnect({ host, port: puerto });

      let buffer = "";
      const resultados: Array<string | number | null> = [];
      let resuelto = false;

      const timer = setTimeout(() => {
        if (!resuelto) {
          resuelto = true;
          socket.destroy();
          reject(new Error("Timeout al conectar con Redis para rate limit"));
        }
      }, 2000);

      socket.on("connect", () => {
        socket.write(payload);
      });

      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const lineas = buffer.split("\r\n");
        while (resultados.length < todos.length && lineas.length > 1) {
          const linea = lineas.shift()!;
          if (linea.startsWith("+")) {
            resultados.push(linea.slice(1));
          } else if (linea.startsWith(":")) {
            resultados.push(Number(linea.slice(1)));
          } else if (linea.startsWith("$-1")) {
            resultados.push(null);
          } else if (linea.startsWith("$")) {
            const len = Number(linea.slice(1));
            const valor = lineas.shift();
            if (valor === undefined) {
              lineas.unshift(linea);
              break;
            }
            resultados.push(valor.slice(0, len));
          } else if (linea.startsWith("-")) {
            clearTimeout(timer);
            resuelto = true;
            socket.destroy();
            reject(new Error(`Error Redis: ${linea.slice(1)}`));
            return;
          }
        }
        buffer = lineas.join("\r\n");

        if (resultados.length >= todos.length && !resuelto) {
          clearTimeout(timer);
          resuelto = true;
          socket.end();
          resolve(password ? resultados.slice(1) : resultados);
        }
      });

      socket.on("error", (err) => {
        if (!resuelto) {
          clearTimeout(timer);
          resuelto = true;
          reject(err);
        }
      });
    });
  }

  async consultar(clave: string): Promise<EntradaRateLimit | null> {
    const k = `${this.prefijo}${clave}`;
    const [val, ttl] = await this.ejecutarComandos([
      ["GET", k],
      ["PTTL", k],
    ]);
    if (!val) return null;
    const cuenta = Number(val);
    const ttlMs = typeof ttl === "number" && ttl > 0 ? ttl : 60000;
    return { cuenta, expiraEn: Date.now() + ttlMs };
  }

  async reiniciarClave(clave: string): Promise<void> {
    await this.ejecutarComandos([["DEL", `${this.prefijo}${clave}`]]);
  }

  async reiniciarTodo(): Promise<void> {
    // En Redis no ejecutamos FLUSHDB por seguridad; solo las claves conocidas se reinician por clave.
  }

  async incrementar(
    clave: string,
    ventanaMs: number,
    limiteMax: number,
    _capacidadMax: number
  ): Promise<ResultadoIncrementoRateLimit> {
    const k = `${this.prefijo}${clave}`;
    const [cuentaRaw, ttlRaw] = await this.ejecutarComandos([
      ["INCR", k],
      ["PTTL", k],
    ]);
    const cuenta = Number(cuentaRaw || 1);
    let ttlMs = typeof ttlRaw === "number" ? ttlRaw : -1;
    if (cuenta === 1 || ttlMs < 0) {
      await this.ejecutarComandos([["PEXPIRE", k, String(ventanaMs)]]);
      ttlMs = ventanaMs;
    }
    const ahora = Date.now();
    return {
      permitido: cuenta <= limiteMax,
      cuenta,
      expiraEn: ahora + Math.max(1, ttlMs),
    };
  }
}

export function crearAlmacenRateLimitPredeterminado(prefijo = "equinox:rl:"): AlmacenRateLimit {
  const redisUrl = (process.env.REDIS_URL || "").trim();
  if (redisUrl && process.env.NODE_ENV !== "test") {
    return new AlmacenRedisRateLimit(redisUrl, prefijo);
  }
  return new AlmacenMemoriaRateLimit();
}

export class LimitadorMemoria {
  private readonly almacen: AlmacenRateLimit;
  private capacidadPrueba: number | null = null;

  constructor(
    private readonly ventanaMs: number,
    private readonly limiteMax: number,
    private readonly mensajeError: string = "Demasiadas solicitudes. Por favor intente más tarde.",
    private readonly maxClaves: number = 5000,
    private readonly identificador?: string,
    almacenPersonalizado?: AlmacenRateLimit
  ) {
    this.almacen = almacenPersonalizado ?? crearAlmacenRateLimitPredeterminado(
      identificador ? `equinox:rl:${identificador}:` : "equinox:rl:"
    );
  }

  limpiarExpiradas(): void {
    if (this.almacen instanceof AlmacenMemoriaRateLimit) {
      this.almacen.limpiarExpiradas();
    }
  }

  detener(): void {
    this.almacen.detener();
  }

  tamano(): number {
    return this.almacen.tamano();
  }

  reiniciar(): void {
    if (estanHooksHabilitados()) {
      void this.almacen.reiniciarTodo();
    }
  }

  async reiniciarClave(clave: string): Promise<void> {
    await this.almacen.reiniciarClave(clave);
  }

  configurarCapacidadPrueba(capacidad: number | null): void {
    if (!estanHooksHabilitados()) return;
    if (capacidad !== null && (!Number.isInteger(capacidad) || capacidad < 1 || capacidad > this.maxClaves)) {
      throw new Error("Capacidad de prueba inválida");
    }
    this.capacidadPrueba = capacidad;
  }

  private obtenerCapacidad(): number {
    return estanHooksHabilitados() ? this.capacidadPrueba ?? this.maxClaves : this.maxClaves;
  }

  async verificarBloqueado(clave: string): Promise<{ bloqueado: boolean; retryAfterSeg?: number }> {
    const entrada = await this.almacen.consultar(clave);
    const ahora = hooksPruebas.obtenerAhora().getTime();
    if (!entrada || entrada.expiraEn <= ahora) {
      return { bloqueado: false };
    }
    if (entrada.cuenta >= this.limiteMax) {
      return {
        bloqueado: true,
        retryAfterSeg: Math.max(1, Math.ceil((entrada.expiraEn - ahora) / 1000)),
      };
    }
    return { bloqueado: false };
  }

  async registrarIntento(clave: string): Promise<ResultadoIncrementoRateLimit> {
    return this.almacen.incrementar(clave, this.ventanaMs, this.limiteMax, this.obtenerCapacidad());
  }

  private rechazar(res: Response, expiraEn: number, ahora: number) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((expiraEn - ahora) / 1000))));
    if (this.identificador && estanHooksHabilitados()) {
      res.setHeader("X-RateLimit-Id", this.identificador);
    }
    return res.status(429).json({ error: this.mensajeError });
  }

  limitar(generarClave: (req: Request) => string) {
    return async (req: Request, res: Response, next: () => void) => {
      try {
        const clave = generarClave(req);
        const ahora = hooksPruebas.obtenerAhora().getTime();
        const resultado = await this.almacen.incrementar(
          clave,
          this.ventanaMs,
          this.limiteMax,
          this.obtenerCapacidad()
        );
        if (!resultado.permitido) {
          return this.rechazar(res, resultado.expiraEn, ahora);
        }
        next();
      } catch (err) {
        console.error("[RATE_LIMIT] Error en almacén de rate limit:", err);
        next();
      }
    };
  }
}
