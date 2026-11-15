import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiStateService } from '../state/ui-state.service';

@Component({
  selector: 'app-configuracion',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './configuracion.component.html'
})
export class ConfiguracionComponent implements OnInit {
  constructor(public state: UiStateService) {}

  ngOnInit(): void {
    if (!this.state.configuracion?.nombreEstudio) {
      void this.state.cargarOrganizacion();
    }
  }
}
