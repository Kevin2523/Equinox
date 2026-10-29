import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { UiStateService } from '../state/ui-state.service';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './topbar.component.html'
})
export class TopbarComponent {
  constructor(public state: UiStateService, public auth: AuthService) {}
}
