import { CommonModule } from '@angular/common';
import { Component, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiStateService } from '../state/ui-state.service';
import { DialogFocusDirective } from '../shared/dialog-focus.directive';

@Component({
  selector: 'app-finanzas',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogFocusDirective],
  templateUrl: './finanzas.component.html',
  styleUrl: './finanzas.component.css'
})
export class FinanzasComponent {
  @HostListener('document:keydown.escape')
  cerrarPagoConEscape(): void {
    if (this.state.pagoModalOpen) this.state.cerrarModalPago();
  }
  constructor(public state: UiStateService) {}
}
