import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiStateService } from '../state/ui-state.service';

@Component({
  selector: 'app-work-map',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './work-map.component.html'
})
export class WorkMapComponent {
  constructor(public state: UiStateService) {}
}
