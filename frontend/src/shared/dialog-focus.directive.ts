import { AfterViewInit, Directive, ElementRef, HostListener, OnDestroy } from '@angular/core';

/** Keeps keyboard navigation inside an active global dialog and returns focus on close. */
@Directive({ selector: '[appDialogFocus]', standalone: true })
export class DialogFocusDirective implements AfterViewInit, OnDestroy {
  private opener: HTMLElement | null = null;
  private readonly selector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

  constructor(private readonly element: ElementRef<HTMLElement>) {}

  ngAfterViewInit(): void {
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    queueMicrotask(() => {
      if (!this.element.nativeElement.isConnected) return;
      (this.element.nativeElement.querySelector<HTMLElement>('[autofocus]') ||
        this.element.nativeElement.querySelector<HTMLElement>(this.selector) ||
        this.element.nativeElement).focus();
    });
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const controls = [...this.element.nativeElement.querySelectorAll<HTMLElement>(this.selector)]
      .filter(el => el.getClientRects().length > 0);
    if (!controls.length) {
      event.preventDefault();
      this.element.nativeElement.focus();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !this.element.nativeElement.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !this.element.nativeElement.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  ngOnDestroy(): void {
    const opener = this.opener;
    queueMicrotask(() => {
      if (opener?.isConnected) opener.focus();
    });
  }
}
