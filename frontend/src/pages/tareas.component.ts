import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiStateService } from '../state/ui-state.service';

@Component({
  selector: 'app-tareas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tareas.component.html'
})
export class TareasComponent {
  constructor(public state: UiStateService) {}
}
