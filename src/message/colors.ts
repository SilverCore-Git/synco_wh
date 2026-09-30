import type { ColorName } from './types.js';

export const Colors: Readonly<Record<ColorName, string>> = Object.freeze({
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#3b82f6',
  neutral: '#64748b',
});

/**
 * Ramène une couleur au seul format accepté par synco_api (`#rrggbb`).
 * Une valeur non reconnue est renvoyée telle quelle, pour que la validation
 * la signale avec son chemin plutôt que de la faire disparaître.
 */
export function normalizeColor(color: string | number): string {
  if (typeof color === 'number') {
    if (Number.isInteger(color) && color >= 0 && color <= 0xffffff) {
      return `#${color.toString(16).padStart(6, '0')}`;
    }
    return String(color);
  }

  const value = color.trim();
  if (value in Colors) return Colors[value as ColorName];

  const hex = value.startsWith('#') ? value.slice(1) : value;
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return `#${[...hex.toLowerCase()].map(c => c + c).join('')}`;
  }
  return color;
}
