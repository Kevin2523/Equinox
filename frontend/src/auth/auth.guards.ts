import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { OrganizacionService } from './organizacion.service';

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

export const guardAdminGlobal: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const teniaToken = !!auth.token;
  try {
    await auth.restaurar();
  } catch (error: any) {
    if (error?.status === 401 && teniaToken) {
      return router.createUrlTree(['/admin/acceso'], { queryParams: { motivo: 'sesion-vencida' } });
    }
    return router.parseUrl('/admin/acceso');
  }
  if (!auth.sesion) {
    return teniaToken
      ? router.createUrlTree(['/admin/acceso'], { queryParams: { motivo: 'sesion-vencida' } })
      : router.parseUrl('/admin/acceso');
  }
  if (!auth.esAdminGlobal) {
    return router.parseUrl('/admin/sin-acceso');
  }
  return true;
};

export const guardPublicoAdmin: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  try {
    await auth.restaurar();
  } catch {
    return true;
  }
  if (auth.esAdminGlobal) {
    return router.parseUrl('/admin');
  }
  return true;
};

export const guardNoFotografia: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const orgService = inject(OrganizacionService);
  const router = inject(Router);

  try {
    await auth.restaurar();
  } catch {
    return router.parseUrl('/inicio-sesion');
  }

  if (!auth.sesion || auth.sesion.contexto.tipoAcceso !== 'ORGANIZACION') {
    return router.parseUrl(auth.rutaInicial());
  }

  await orgService.asegurarCargado();
  if (orgService.tipoFreelance === 'FOTOGRAFIA') {
    return router.parseUrl('/clientes');
  }

  return true;
};
