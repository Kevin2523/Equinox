import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { TPipe } from './t.pipe';

@Component({
  selector: 'app-portal-hero',
  standalone: true,
  imports: [CommonModule, TPipe],
  template: `
    <header
      class="portal-hero"
      [class.portal-hero-compact]="compact"
      [attr.aria-label]="'portal.hero.cabeceraAria' | t"
      [style.backgroundColor]="colorSecundario"
      [style.--portal-primary]="colorPrimario"
      [style.--portal-secondary]="colorSecundario"
      [style.--hero-ink]="heroInk"
      [style.--hero-muted]="heroMuted"
    >
      <div class="hero-text-pane">
        <span class="hero-eyebrow">
          <span class="hero-eyebrow-dot" aria-hidden="true"></span>
          {{ (esFotografia ? 'portal.hero.eyebrowFotografia' : 'portal.hero.eyebrowCliente') | t }}
        </span>
        <h1 class="hero-studio-name">{{ nombreEstudio }}</h1>
        <p class="hero-tagline">
          {{ (esFotografia ? 'portal.hero.taglineFotografia' : 'portal.hero.taglineGeneral') | t }}
        </p>
      </div>

      <div class="hero-visual-pane" aria-hidden="true">
        <svg
          *ngIf="esFotografia"
          class="camera-hero-svg"
          viewBox="0 0 540 210"
          preserveAspectRatio="xMidYMid slice"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          [attr.aria-label]="'portal.hero.svgFotografiaAria' | t"
        >
          <defs>
            <linearGradient id="windowGlow" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#64748b" stop-opacity="0.25" />
              <stop offset="50%" stop-color="#374151" stop-opacity="0.1" />
              <stop offset="100%" stop-color="#111215" stop-opacity="0" />
            </linearGradient>
            <linearGradient id="umbrellaShade" x1="0%" y1="0%" x2="100%" y2="80%">
              <stop offset="0%" stop-color="#e2e8f0" stop-opacity="0.85" />
              <stop offset="60%" stop-color="#94a3b8" stop-opacity="0.7" />
              <stop offset="100%" stop-color="#475569" stop-opacity="0.5" />
            </linearGradient>
            <radialGradient id="lensGlass" cx="40%" cy="40%" r="60%">
              <stop offset="0%" stop-color="#93c5fd" stop-opacity="0.8" />
              <stop offset="45%" stop-color="#3b82f6" stop-opacity="0.4" />
              <stop offset="100%" stop-color="#0f172a" stop-opacity="0.95" />
            </radialGradient>
          </defs>

          <g opacity="0.4">
            <rect x="260" y="10" width="270" height="190" fill="url(#windowGlow)" stroke="#374151" stroke-width="1.5" />
            <line x1="395" y1="10" x2="395" y2="200" stroke="#374151" stroke-width="2.5" />
            <line x1="260" y1="90" x2="530" y2="90" stroke="#374151" stroke-width="2.5" />
            <rect x="270" y="20" width="115" height="60" fill="#f3f4f6" fill-opacity="0.04" />
            <rect x="405" y="20" width="115" height="60" fill="#f3f4f6" fill-opacity="0.07" />
            <rect x="270" y="100" width="115" height="90" fill="#f3f4f6" fill-opacity="0.03" />
            <rect x="405" y="100" width="115" height="90" fill="#f3f4f6" fill-opacity="0.06" />
          </g>

          <g transform="translate(425, 20)">
            <path d="M -30,10 Q 75,35 90,135 Q 35,115 -10,95 Q -35,50 -30,10 Z" fill="url(#umbrellaShade)" stroke="#4b5563" stroke-width="1" />
            <path d="M 35,70 Q 15,35 -30,10" stroke="#374151" stroke-width="1.2" fill="none" />
            <path d="M 35,70 Q 60,50 90,135" stroke="#374151" stroke-width="1.2" fill="none" />
            <path d="M 35,70 Q 20,85 -10,95" stroke="#374151" stroke-width="1.2" fill="none" />
            <line x1="35" y1="70" x2="0" y2="105" stroke="#9ca3af" stroke-width="3" stroke-linecap="round" />
            <line x1="0" y1="105" x2="-20" y2="210" stroke="#1f2937" stroke-width="3.5" />
          </g>

          <g stroke="#1e2229" stroke-linecap="round">
            <line x1="345" y1="120" x2="345" y2="155" stroke-width="6" />
            <rect x="339" y="145" width="12" height="12" rx="2" fill="#2d323c" />
            <line x1="340" y1="150" x2="285" y2="230" stroke-width="4.5" stroke="#252a34" />
            <line x1="340" y1="150" x2="285" y2="230" stroke-width="2.5" stroke="#3b4252" />
            <line x1="345" y1="150" x2="345" y2="230" stroke-width="4.5" stroke="#1e2229" />
            <line x1="350" y1="150" x2="415" y2="230" stroke-width="4.5" stroke="#252a34" />
            <line x1="350" y1="150" x2="415" y2="230" stroke-width="2.5" stroke="#3b4252" />
          </g>

          <g>
            <rect x="337" y="125" width="16" height="8" rx="2" fill="#323846" />
            <circle cx="345" cy="120" r="7" fill="#475164" />
            <rect x="332" y="110" width="26" height="6" rx="1.5" fill="#282d38" stroke="#475164" stroke-width="0.8" />
            <rect x="360" y="117" width="6" height="5" rx="1" fill="#64748b" />
          </g>

          <g>
            <rect x="312" y="65" width="66" height="45" rx="4" fill="#181b22" stroke="#2b313d" stroke-width="1.2" />
            <path d="M 368,69 Q 384,80 380,105 L 368,107 Z" fill="#12141a" stroke="#2b313d" stroke-width="1" />
            <rect x="372" y="75" width="7" height="24" rx="2" fill="#21252f" opacity="0.7" />
            <polygon points="334,65 342,50 358,50 366,65" fill="#1c2028" stroke="#2b313d" stroke-width="1" />
            <rect x="345" y="47" width="10" height="3" rx="0.5" fill="#475164" />
            <rect x="343" y="52" width="14" height="10" rx="2" fill="#0f1115" stroke="#333a48" stroke-width="0.8" />
            <rect x="318" y="59" width="10" height="6" rx="1" fill="#333a48" />
            <rect x="370" y="62" width="8" height="3" rx="0.5" fill="#475164" />
            <rect x="372" y="58" width="5" height="3" rx="1" fill="#94a3b8" />
          </g>

          <g>
            <rect x="306" y="73" width="7" height="30" rx="1" fill="#64748b" />
            <rect x="278" y="71" width="29" height="34" rx="2" fill="#181b22" stroke="#2b313d" stroke-width="1" />
            <rect x="281" y="72" width="14" height="32" fill="#111318" />
            <line x1="284" y1="73" x2="284" y2="103" stroke="#374151" stroke-width="1" />
            <line x1="288" y1="73" x2="288" y2="103" stroke="#374151" stroke-width="1" />
            <line x1="292" y1="73" x2="292" y2="103" stroke="#374151" stroke-width="1" />
            <rect x="296" y="74" width="8" height="5" rx="1" fill="#0f172a" stroke="#475164" stroke-width="0.5" />
            <rect x="246" y="74" width="33" height="28" rx="2" fill="#15171e" stroke="#2b313d" stroke-width="1" />
            <rect x="252" y="75" width="12" height="26" fill="#0f1115" />
            <line x1="255" y1="76" x2="255" y2="100" stroke="#374151" stroke-width="1" />
            <line x1="258" y1="76" x2="258" y2="100" stroke="#374151" stroke-width="1" />
            <line x1="261" y1="76" x2="261" y2="100" stroke="#374151" stroke-width="1" />
            <rect x="244" y="73.5" width="2.5" height="29" [attr.fill]="colorPrimario" opacity="0.9" />
            <path d="M 244,73 L 230,68 L 230,108 L 244,103 Z" fill="#12141a" stroke="#2b313d" stroke-width="1" />
            <ellipse cx="230" cy="88" rx="3" ry="19" fill="url(#lensGlass)" stroke="#38bdf8" stroke-width="0.8" stroke-opacity="0.6" />
            <circle cx="231" cy="84" r="2" fill="#ffffff" fill-opacity="0.7" />
          </g>
        </svg>

        <svg
          *ngIf="!esFotografia"
          class="camera-hero-svg"
          viewBox="0 0 540 210"
          preserveAspectRatio="xMidYMid slice"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          [attr.aria-label]="'portal.hero.svgGeneralAria' | t"
        >
          <g opacity="0.45" transform="translate(260, 25)">
            <rect x="40" y="10" width="200" height="135" rx="8" fill="#1e2229" stroke="#374151" stroke-width="1.5" />
            <rect x="52" y="24" width="176" height="106" rx="4" fill="#13161c" />
            <line x1="65" y1="45" x2="140" y2="45" [attr.stroke]="colorPrimario" stroke-width="2.5" stroke-linecap="round" />
            <line x1="65" y1="62" x2="185" y2="62" stroke="#4b5563" stroke-width="2" stroke-linecap="round" />
            <line x1="65" y1="78" x2="160" y2="78" stroke="#4b5563" stroke-width="2" stroke-linecap="round" />
            <rect x="65" y="92" width="45" height="24" rx="4" [attr.fill]="colorPrimario" fill-opacity="0.32" [attr.stroke]="colorPrimario" stroke-width="1.2" />
            <rect x="118" y="92" width="45" height="24" rx="4" fill="#10b981" fill-opacity="0.25" stroke="#10b981" stroke-width="1" />
            <line x1="140" y1="145" x2="140" y2="165" stroke="#374151" stroke-width="6" stroke-linecap="round" />
            <line x1="105" y1="165" x2="175" y2="165" stroke="#374151" stroke-width="3" stroke-linecap="round" />
          </g>
        </svg>
      </div>
    </header>
  `,
  styles: [`
    .portal-hero {
      position: relative;
      min-height: 200px;
      border-radius: 18px;
      background-color: var(--portal-secondary, #0f172a);
      overflow: hidden;
      display: flex;
      align-items: stretch;
      justify-content: space-between;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
      transition: background-color 0.2s ease;
    }

    .portal-hero-compact {
      min-height: 156px;
      border-radius: 14px;
    }

    .hero-text-pane {
      position: relative;
      z-index: 2;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 38px 42px;
      max-width: 620px;
      min-width: 0;
    }

    .portal-hero-compact .hero-text-pane {
      padding: 24px 22px;
    }

    .hero-eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--hero-muted, #9ca3af);
      margin-bottom: 8px;
    }

    .hero-eyebrow-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--portal-primary, #2563eb);
      flex-shrink: 0;
    }

    .hero-studio-name {
      font-size: clamp(26px, 4vw, 42px);
      font-weight: 800;
      color: var(--hero-ink, #ffffff);
      margin: 0 0 10px 0;
      letter-spacing: -0.03em;
      line-height: 1.15;
      overflow-wrap: anywhere;
    }

    .portal-hero-compact .hero-studio-name {
      font-size: 26px;
    }

    .hero-tagline {
      font-size: 15px;
      color: var(--hero-muted, #d1d5db);
      margin: 0;
      line-height: 1.45;
    }

    .portal-hero-compact .hero-tagline {
      font-size: 13.5px;
    }

    .hero-visual-pane {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      width: 55%;
      max-width: 560px;
      pointer-events: none;
      -webkit-mask-image: linear-gradient(to right, transparent 0%, rgba(0, 0, 0, 0.85) 55%);
      mask-image: linear-gradient(to right, transparent 0%, rgba(0, 0, 0, 0.85) 55%);
    }

    .camera-hero-svg {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    @media (max-width: 760px) {
      .portal-hero {
        min-height: 156px;
      }
      .hero-text-pane {
        padding: 26px 22px;
      }
      .hero-visual-pane {
        width: 48%;
        opacity: 0.4;
      }
    }
  `],
})
export class PortalHeroComponent {
  @Input() nombreEstudio = '';
  @Input() esFotografia = false;
  @Input() colorPrimario = '#2563EB';
  @Input() colorSecundario = '#0F172A';
  @Input() heroInk = '#FFFFFF';
  @Input() heroMuted = '#CBD5E1';
  @Input() compact = false;
}
