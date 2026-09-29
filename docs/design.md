# RxPlus design

The look, and where it's defined. Reference: the Groupsy by Photobucket site (photobucket.com, studied 2026-09-29), in a **tempered** version suited to health information. RxPlus borrows the visual language (palette, type pairing, shapes); it doesn't copy Groupsy's name, logo, imagery, copy or page layouts.

## Where it lives

| What                                                                                | File                                  |
| ----------------------------------------------------------------------------------- | ------------------------------------- |
| Colors, radii, focus ring (PrimeNG preset; also Tailwind `primary-*` / `surface-*`) | `src/app/theme/rxplus-preset.ts`      |
| Fonts, page background, headings, `rx-*` classes, gradient buttons                  | `src/styles.css`                      |
| Font loading (Google Fonts)                                                         | `index.html`                          |
| Line icons (capsule, interactions, arrow)                                           | `src/app/shared/ui/icon.component.ts` |

## Tokens

- **Primary:** violet, `primary-600` `#7c18ff` (text on white 6.1:1). Dark mode uses `primary-400` `#b27aff` (5.9:1 on the dark surfaces).
- **Brand gradient:** 135°, `#7c18ff` → `#d6105a`. The reference ends on `#ff2d6b`; RxPlus darkens it so white text stays at 5.2:1. In dark mode, gradient _text_ uses `#c79bff` → `#ff8fb1` (8:1 or better).
- **Surfaces:** violet-tinted neutrals. The page is `primary-50` (lavender); content sits on white cards. Muted text (`surface-500`) is 5.4:1 on white.
- **Type:** Bricolage Grotesque for `h1`–`h3` (page titles 3xl, bold); DM Sans for everything else. Both are free on Google Fonts; the reference's "Polymath" fonts are licensed and not used.
- **Shape:** buttons and tags are pills; cards have 20 px corners (`rx-card`); fields 12 px; dialogs 20 px.

## Patterns

- **`rx-card`:** every content block (a medication, an interaction, a drug-page section, a digest, an empty state) is a white card on the lavender page. No bare sections on the background.
- **`rx-icon-tile`:** a 40 px gradient tile with a white line icon, next to a card's title (medication cards, dashboard links). Icons are decorative (`aria-hidden`).
- **Primary buttons** carry the gradient and a soft violet glow; secondary, text, outlined, link and severity buttons stay flat. One primary action per view.
- **Whole-card links** (dashboard) show a hover border and the 2 px violet focus ring.
- **Severity** (Major, Moderate…) keeps its own colors and always says its level in words.

## Light and dark

The sun/moon button in the header (and on the login page) switches themes. Until someone uses it, RxPlus follows the OS setting; after that the choice is saved in the browser (`localStorage` key `rxplus-theme`) and wins over the OS.

Everything styles from one class, `app-dark` on `<html>`: PrimeNG (`darkModeSelector`), Tailwind's `dark:` variant (`@custom-variant` in `styles.css`), `color-scheme` (which drives the theme's `light-dark()` colors), and the `rx-*` classes. A small script in `index.html` sets the class before first paint, so server-rendered pages don't flash the wrong theme; `src/app/core/theme.ts` keeps it in step afterwards.

## Rejected from the reference

Dark hero bands, 900-weight display headlines, gradient page backgrounds (except the login page), and marketing copy. RxPlus is a tool people open to check a medication; calm and legible wins over loud.
