import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

async function validarAcceso(tipo: 'ORGANIZACION' | 'CLIENTE' | 'PUBLICO') {
  const auth = inject(AuthService);
  const router = inject(Router);
  try {
    await auth.restaurar();
  } catch {
    // Un fallo de red conserva el token para un nuevo intento de validación.
    return tipo === 'PUBLICO' ? true : router.parseUrl('/inicio-sesion');
  }
  if (tipo === 'PUBLICO') return auth.sesion ? router.parseUrl(auth.rutaInicial()) : true;
  if (!auth.sesion) return router.parseUrl('/inicio-sesion');
  if (auth.sesion.contexto.tipoAcceso !== tipo) return router.parseUrl(auth.rutaInicial());
  return true;
}

export const guardOrganizacion: CanActivateFn = () => validarAcceso('ORGANIZACION');
export const guardCliente: CanActivateFn = () => validarAcceso('CLIENTE');
export const guardPublico: CanActivateFn = () => validarAcceso('PUBLICO');
