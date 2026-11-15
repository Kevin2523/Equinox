import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { esPeticionApiPropia } from './api.config';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = esPeticionApiPropia(req.url) ? auth.token : null;
  const peticion = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(peticion).pipe(catchError((error) => {
    // El cierre maneja sus errores en la pantalla actual y ofrece reintento o salida local.
    const esCierre = req.url.endsWith('/api/autenticacion/cerrar-sesion');
    if (token && error?.status === 401 && !esCierre) auth.limpiarPor401(token);
    return throwError(() => error);
  }));
};
