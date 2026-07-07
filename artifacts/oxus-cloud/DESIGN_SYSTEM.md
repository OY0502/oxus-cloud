# OXUS Cloud Design System

Reference for colors, typography, spacing, and UI patterns used in the app. All tokens live in [`src/index.css`](src/index.css). Components are built on **shadcn/ui** (New York style) with **Tailwind CSS v4**.

---

## Stack

| Layer | Choice |
|-------|--------|
| CSS framework | Tailwind CSS v4 (`@import "tailwindcss"`) |
| Component library | shadcn/ui — `new-york` style, CSS variables enabled |
| Primitives | Radix UI |
| Variants | `class-variance-authority` (CVA) |
| Icons | [Lucide React](https://lucide.dev/) (`lucide-react`) |
| Animation | `tw-animate-css`, Framer Motion (page transitions) |
| Charts | Recharts via `@/components/ui/chart` |
| Prose | `@tailwindcss/typography` plugin |

---

## Typography

### Font families

Loaded from Google Fonts in `index.css`:

| Token | Family | Usage |
|-------|--------|--------|
| `font-sans` | **Outfit** (300–700) | Default body UI — labels, buttons, tables, nav |
| `font-serif` | **Jost** (400–700) | Display / marketing headlines (e.g. login hero) |
| `font-mono` | Menlo, monospace | Code, keyboard hints (`Kbd`) |

```css
--app-font-sans: 'Outfit', sans-serif;
--app-font-serif: 'Jost', sans-serif;
--app-font-mono: Menlo, monospace;
```

`body` applies `font-sans antialiased`.

### Type scale (conventions)

Tailwind defaults are used consistently across pages:

| Role | Classes | Example |
|------|---------|---------|
| Page title | `text-3xl font-bold tracking-tight` | `PageHeader` |
| Section title | `text-base` / `text-sm font-semibold` | PM panels, accordions |
| Card title | `font-semibold leading-none tracking-tight` | `CardTitle` |
| Body | `text-sm` (inputs use `md:text-sm`) | Most content |
| Meta / caption | `text-xs text-muted-foreground` | Timestamps, hints |
| Section label | `text-xs font-medium uppercase tracking-wider text-muted-foreground` | Team detail cards |
| Hero (auth) | `text-4xl font-serif font-bold` | Login left panel |
| Top bar page name | `text-lg font-medium` | `TopBar` |

### Brand wordmark

`BrandLogo` uses hard-coded logo blue `#D1E8FF` for sidebar text, with **OXUS** bold and **| Cloud** regular at `text-xl tracking-wide`.

---

## Color palette

Colors are defined as **HSL components** (no `hsl()` wrapper) in `:root` and `.dark`, then exposed to Tailwind via `@theme inline` as `hsl(var(--token))`.

### Brand anchors

| Name | Hex (approx.) | HSL | CSS variable | Tailwind class |
|------|---------------|-----|--------------|----------------|
| Navy | `#0B1A33` | `217 64% 12%` | `--foreground`, `--primary`, `--sidebar` | `bg-primary`, `text-foreground`, `bg-sidebar` |
| Logo blue | `#D1E8FF` | `210 100% 91%` | `--logo-blue` | `bg-logo-blue`, `text-logo-blue` |
| Magenta | — | `316 70% 50%` | `--magenta` | `bg-magenta` — CTAs (e.g. New Quote) |
| Mint | — | `175 60% 50%` | `--mint` | `bg-mint` |
| Soft green | — | `130 50% 60%` | `--soft-green` | `bg-soft-green` — success |
| Warm yellow | — | `45 90% 60%` | `--warm-yellow` | `bg-warm-yellow` — warning |
| Soft red | — | `0 70% 65%` | `--soft-red` | `bg-soft-red` — danger |

### Semantic tokens (light mode)

| Token | HSL | Purpose |
|-------|-----|---------|
| `--background` | `210 20% 98%` | App canvas |
| `--foreground` | `217 64% 12%` | Primary text (navy) |
| `--card` | `0 0% 100%` | Card surfaces |
| `--border` | `214 32% 91%` | Default borders |
| `--primary` | `217 64% 12%` | Primary actions |
| `--primary-foreground` | `0 0% 100%` | Text on primary |
| `--secondary` | `210 40% 96.1%` | Secondary surfaces |
| `--muted` | `210 40% 96.1%` | Muted backgrounds |
| `--muted-foreground` | `215.4 16.3% 46.9%` | Secondary text |
| `--accent` | `214 40% 94%` | Hover / highlight fills |
| `--destructive` | `0 84.2% 60.2%` | Errors, destructive actions |
| `--input` | `214.3 31.8% 91.4%` | Input borders |
| `--ring` | `217 64% 12%` | Focus rings |

### Sidebar tokens

The fixed left nav and top bar share the navy sidebar theme:

| Token | Light value | Usage |
|-------|-------------|--------|
| `--sidebar` | `217 64% 12%` | `bg-sidebar` |
| `--sidebar-foreground` | `210 100% 91%` | Nav labels |
| `--sidebar-border` | `217 64% 16%` | Dividers |
| `--sidebar-accent` | `217 64% 18%` | Active / hover nav item |
| `--sidebar-accent-foreground` | `0 0% 100%` | Active nav text |
| `--sidebar-primary` | `210 100% 91%` | Accent on sidebar |
| `--sidebar-ring` | `210 100% 91%` | Focus ring |

### Chart colors

Mapped to brand accents (`--chart-1` … `--chart-5`):

1. Magenta  
2. Mint  
3. Soft green  
4. Warm yellow  
5. Soft red  

Use `text-chart-1` … `text-chart-5` or pass via `ChartConfig` in `@/components/ui/chart`.

### Dark mode

`.dark` class on an ancestor flips the palette: navy background, logo-blue foreground, inverted primary. Dark tokens are defined in `index.css` but **no app-wide theme toggle is wired yet** (`next-themes` is installed; only Sonner reads it). Components use `dark:` variants in a few places (amber warnings, input groups).

---

## Border radius

Base radius: `--radius: 0.75rem` (12px).

| Token | Value |
|-------|-------|
| `rounded-sm` | `calc(var(--radius) - 4px)` → 8px |
| `rounded-md` | `calc(var(--radius) - 2px)` → 10px |
| `rounded-lg` / default | `var(--radius)` → 12px |
| `rounded-xl` | `calc(var(--radius) + 4px)` → 16px — cards, tables, panels |

Cards use `rounded-xl`; buttons and inputs use `rounded-md`.

---

## Shadows & surfaces

Custom utilities in `@layer utilities`:

| Class | Effect |
|-------|--------|
| `shadow-soft` | `0 8px 30px rgba(11, 26, 51, 0.05)` — cards, tables, metric tiles |
| `shadow-layered` | Soft + deeper layer — hover elevation, calendar detail |
| `hover-elevate` | `transition-all duration-300`; on hover: `translateY(-4px)` + `shadow-layered` |
| `glass` | `bg-white/70 backdrop-blur-md` (dark: `bg-black/50`) + soft shadow |
| `paper` | Card background + subtle SVG noise texture + `border-card-border` |

Buttons and badges also reference `hover-elevate` for interactive lift.

---

## Layout

| Pattern | Value |
|---------|-------|
| App shell | `flex min-h-screen`; sidebar `w-64 fixed`; main `ml-64` |
| Content padding | `p-8` in main area |
| Header height | `h-16` (sidebar header + top bar) |
| Page sections | `space-y-8` typical vertical rhythm |
| Page header margin | `mb-8` (`PageHeader`) |

Page transitions: Framer Motion fade + 10px vertical slide (`duration: 0.2`, `easeOut`).

---

## Components

### Buttons (`@/components/ui/button`)

| Variant | Appearance |
|---------|------------|
| `default` | `bg-primary text-primary-foreground` + border |
| `destructive` | Red fill |
| `outline` | Border using `--button-outline`, `shadow-xs` |
| `secondary` | Muted fill + border |
| `ghost` | Transparent border |
| `link` | Underlined primary text |

| Size | Height |
|------|--------|
| `default` | `min-h-9` |
| `sm` | `min-h-8`, `text-xs` |
| `lg` | `min-h-10` |
| `icon` | `h-9 w-9` |

**Product CTAs:** primary navy (`bg-primary`) for general actions; **magenta** (`bg-magenta hover:bg-magenta/90 shadow-soft`) for high-intent creates (e.g. New Quote).

### Badges

- **shadcn `Badge`:** `default`, `secondary`, `destructive`, `outline`
- **`StatusBadge`:** semantic status colors with 15% tint backgrounds:

| Variant | Colors |
|---------|--------|
| `success` | soft-green |
| `warning` | warm-yellow |
| `danger` | soft-red |
| `info` | logo-blue + primary text |
| `default` | primary/10 |
| `neutral` | muted |

`ProjectHealthBadge` maps on-track / at-risk / off-track → success / warning / danger.

### Cards

`rounded-xl border bg-card shadow` — often combined with `shadow-soft` and `border-border` in feature components (`MetricCard`, `ChartCard`, `DataTable` wrapper).

### Forms

- Inputs: `h-9`, `rounded-md`, `border-input`, `focus-visible:ring-1 ring-ring`
- Labels: `@/components/ui/label`
- Form layout: `FormKit` (`Field`, `TextField`, etc.)

### Data display

- **`DataTable`:** card wrapper with `rounded-xl shadow-soft`
- **`MetricCard`:** `hover-elevate` on hover
- **`QueryStates`:** skeleton, empty, and error patterns

### Icons

- Size: `w-4 h-4` in nav/buttons; `w-5 h-5` in top bar
- Color: inherit or `text-muted-foreground`; notification dot uses `bg-magenta`

---

## Status & semantic color usage

| Meaning | Color token | Examples |
|---------|-------------|----------|
| Success / active / paid | `soft-green` | StatusBadge, dashboard activity dots |
| Warning / pending | `warm-yellow` | StatusBadge, at-risk health |
| Danger / overdue | `soft-red` | StatusBadge, off-track health |
| Info / new / proposal | `logo-blue` | StatusBadge, activity dots |
| Primary action | `primary` (navy) | Create Project, Team add |
| Accent CTA | `magenta` | New Quote |
| Inline warnings | Tailwind `amber-*` with `dark:` overrides | Notes cards, Slack/PM alerts |

---

## Auth & marketing surfaces

Login/signup split layout:

- **Left panel (lg+):** `bg-sidebar`, logo-blue gradient overlay, decorative circles, `font-serif` hero headline
- **Right panel:** `bg-background`, `text-3xl font-bold` form title, standard form components

---

## Extending the system

1. **New color:** add HSL components to `:root` / `.dark`, map in `@theme inline`, use as `bg-{name}` or `text-{name}`.
2. **New component:** follow shadcn patterns in `src/components/ui/`; use semantic tokens (`bg-card`, `text-muted-foreground`) rather than raw hex.
3. **Status colors:** prefer `StatusBadge` variants or chart tokens over one-off colors.
4. **Dark mode:** when adding a theme toggle, wrap the app with `ThemeProvider` from `next-themes` and set `class` strategy to match `@custom-variant dark (&:is(.dark *))`.

---

## File reference

| File | Role |
|------|------|
| `src/index.css` | All design tokens, utilities, fonts |
| `components.json` | shadcn config (style, aliases) |
| `src/components/ui/*` | Primitive components |
| `src/components/StatusBadge.tsx` | Domain status styling |
| `src/components/PageHeader.tsx` | Page title pattern |
| `src/components/BrandLogo.tsx` | Brand mark |
| `src/components/AppShell.tsx` | Layout shell |
