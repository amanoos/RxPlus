import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

/**
 * RxPlus look (docs/design.md): violet primary, lavender-tinted neutrals, pill
 * buttons and tags, rounder cards and dialogs. Built on Aura so every PrimeNG
 * component and Tailwind's primary-* and surface-* utilities follow it.
 */
export const RxPlusPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '#f6f1ff',
      100: '#ede8ff',
      200: '#dccbff',
      300: '#c79bff',
      400: '#b27aff',
      500: '#8a33ff',
      600: '#7c18ff',
      700: '#6a0fe0',
      800: '#5710b5',
      900: '#481293',
      950: '#2c0666',
      // Text contrast: 600 on white 6.1:1; 400 on the dark surfaces 5.9:1 (and dark text on it 6.4:1).
      color: 'light-dark({primary.600}, {primary.400})',
      contrastColor: 'light-dark(#ffffff, {surface.950})',
      hoverColor: 'light-dark({primary.700}, {primary.300})',
      activeColor: 'light-dark({primary.800}, {primary.200})',
    },
    // Neutrals with a violet tint. Light 500 (muted text) is 5.4:1 on white.
    surface: {
      0: '#ffffff',
      50: 'light-dark(#faf8fe, #f7f6fb)',
      100: 'light-dark(#f3f0fa, #eeecf5)',
      200: 'light-dark(#e8e3f3, #d9d6e3)',
      300: 'light-dark(#d4cde3, #b9b4c7)',
      400: 'light-dark(#a39cb6, #9791a8)',
      500: 'light-dark(#6b6680, #726c85)',
      600: 'light-dark(#534f63, #55506a)',
      700: 'light-dark(#3d3a4a, #3a3649)',
      800: 'light-dark(#26242f, #26232f)',
      900: 'light-dark(#16161c, #1a1822)',
      950: 'light-dark(#0d0d0d, #111016)',
    },
    focusRing: { width: '2px', style: 'solid', color: '{primary.color}', offset: '2px' },
    formField: { borderRadius: '12px' },
    content: { borderRadius: '14px' },
    overlay: { modal: { borderRadius: '20px' }, popover: { borderRadius: '14px' } },
  },
  components: {
    button: { root: { borderRadius: '9999px', paddingX: '1rem', paddingY: '0.5rem' } },
    tag: { root: { borderRadius: '9999px', padding: '0.125rem 0.5rem' } },
    message: { root: { borderRadius: '14px' } },
  },
});
