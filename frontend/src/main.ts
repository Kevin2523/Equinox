import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app.component';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './auth/auth.interceptor';

bootstrapApplication(AppComponent, { providers: [provideRouter(routes), provideHttpClient(withInterceptors([authInterceptor]))] })
  .catch(() => console.error('No se pudo iniciar Equinox'));
