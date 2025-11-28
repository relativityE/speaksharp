# Design Token Usage Guidelines

**Last Updated:** 2025-11-28  
**Purpose:** Single source of truth for SpeakSharp design tokens and their usage

---

## Overview

SpeakSharp uses a **token-based design system** defined in `frontend/tailwind.config.ts`. All visual properties (colors, shadows, animations) are abstracted as CSS custom properties and exposed via Tailwind utilities.

**Why design tokens?**
- ✅ Centralized theming (dark/light mode support)
- ✅ Consistency across components
- ✅ Easy refactoring (change once, apply everywhere)
- ✅ Better maintainability

---

## Color Tokens

All colors use HSL format via CSS custom properties (`hsl(var(--token-name))`).

### Semantic Colors

| Token | Tailwind Class | Usage | Example |
|-------|---------------|-------|---------|
| `--background` | `bg-background` | Page/container backgrounds | Background of main content areas |
| `--foreground` | `text-foreground` | Primary text color | Body text, headings |
| `--border` | `border-border` | Standard borders | Input borders, dividers |
| `--input` | `bg-input` | Input field backgrounds | Form inputs |
| `--ring` | `ring-ring` | Focus ring color | Focus states on interactive elements |

### Brand Colors

#### Primary (Main brand color)
| Token | Tailwind Class | Usage |
|-------|---------------|-------|
| `--primary` | `bg-primary`, `text-primary` | Primary buttons, CTAs |
| `--primary-foreground` | `text-primary-foreground` | Text on primary backgrounds |
| `--primary-light` | `bg-primary-light` | Hover states, accents |
| `--primary-dark` | `bg-primary-dark` | Active/pressed states |

#### Secondary
| Token | Tailwind Class | Usage |
|-------|---------------|-------|
| `--secondary` | `bg-secondary` | Secondary buttons, less prominent CTAs |
| `--secondary-foreground` | `text-secondary-foreground` | Text on secondary backgrounds |

#### Accent
| Token | Tailwind Class | Usage |
|-------|---------------|-------|
| `--accent` | `bg-accent` | Highlights, badges, notifications |
| `--accent-foreground` | `text-accent-foreground` | Text on accent backgrounds |

### Feedback Colors

| Token | Tailwind Class | Usage |
|-------|---------------|-------|
| `--destructive` | `bg-destructive` | Error states, delete actions |
| `--destructive-foreground` | `text-destructive-foreground` | Text on destructive backgrounds |
| `--muted` | `bg-muted` | Disabled states, subtle backgrounds |
| `--muted-foreground` | `text-muted-foreground` | Secondary/helper text |

### Component-Specific Colors

#### Card
| Token | Tailwind Class | Usage |
|-------|---------------|-------|
| `--card` | `bg-card` | Card backgrounds |
| `--card-foreground` | `text-card-foreground` | Text on cards |

#### Popover
| Token | Tailwind Class | Usage |
|-------|---------------|-------|
| `--popover` | `bg-popover` | Dropdown/dialog backgrounds |
| `--popover-foreground` | `text-popover-foreground` | Text in dropdowns/dialogs |

---

## Gradient Tokens

All gradients are defined as CSS custom properties and accessed via `bg-gradient-*` utilities.

| Token | Tailwind Class | Usage | Applied To |
|-------|---------------|-------|-----------|
| `--gradient-primary` | `bg-gradient-primary` | Primary CTAs, hero sections | Buttons, banners |
| `--gradient-secondary` | `bg-gradient-secondary` | Secondary highlights | Badge variants |
| `--gradient-accent` | `bg-gradient-accent` | Accent elements | Special callouts |
| `--gradient-hero` | `bg-gradient-hero` | Landing page hero | Hero section background |
| `--gradient-subtle` | `bg-gradient-subtle` | Subtle overlays | Loading states, overlays |

**Example:**
```tsx
<button className="bg-gradient-primary text-primary-foreground">
  Get Started
</button>
```

---

## Shadow Tokens

Shadows are defined as CSS custom properties for consistent depth hierarchy.

| Token | Tailwind Class | Usage | Example |
|-------|---------------|-------|---------|
| `--shadow-elegant` | `shadow-elegant` | Elevated UI components | Floating action buttons |
| `--shadow-focus` | `shadow-focus` | Focus states | Active input fields |
| `--shadow-card` | `shadow-card` | Card components | Product cards, info panels |

**Example:**
```tsx
<div className="bg-card shadow-card rounded-lg p-6">
  Card content
</div>
```

**❌ Don't:** Use arbitrary shadow values
```tsx
<div className="shadow-[0_4px_20px_-2px_rgba(0,0,0,0.3)]">  {/* Bad */}
```

**✅ Do:** Use shadow tokens
```tsx
<div className="shadow-card">  {/* Good */}
```

---

## Border Radius Tokens

| Token | Tailwind Class | Usage |
|-------|---------------|-------|
| `--radius` | `rounded-lg` | Standard border radius |
| `calc(var(--radius) - 2px)` | `rounded-md` | Nested elements |
| `calc(var(--radius) - 4px)` | `rounded-sm` | Inner nested elements |

---

## Animation Tokens

### Keyframes

| Animation | Tailwind Class | Usage |
|-----------|---------------|-------|
| `accordion-down` | `animate-accordion-down` | Expanding accordions |
| `accordion-up` | `animate-accordion-up` | Collapsing accordions |
| `pulse-ring` | `animate-pulse-ring` | Loading indicators, pulse effects |
| `fade-in-up` | `animate-fade-in-up` | Entrance animations |

### Timing Functions

| Token | Tailwind Class | Usage |
|-------|---------------|-------|
| `cubic-bezier(0.4, 0, 0.2, 1)` | `ease-smooth` | General smooth transitions |
| `cubic-bezier(0.68, -0.55, 0.265, 1.55)` | `ease-bounce` | Playful bounce effects |

---

## Usage with CVA (Class Variance Authority)

Components using CVA **must** reference design tokens, not hardcoded values.

**✅ Correct:**
```typescript
// badge-variants.ts
export const badgeVariants = cva(
  "inline-flex items-center rounded-full",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground",  // Uses tokens
        destructive: "bg-destructive text-destructive-foreground",
      },
    },
  }
);
```

**❌ Incorrect:**
```typescript
variant: {
  primary: "bg-blue-600 text-white",  // Hardcoded colors
}
```

---

## Best Practices

### 1. Use Semantic Tokens Over Direct Colors
**❌ Don't:**
```tsx
<div className="bg-slate-900 text-white">
```

**✅ Do:**
```tsx
<div className="bg-background text-foreground">
```

### 2. Use Design Tokens in Component Variants
All CVA-based components (`Button`, `Badge`, `Card`, `Input`, etc.) should only use tokens.

### 3. Leverage Design Tokens for Theming
Design tokens automatically adapt to theme changes (dark/light mode via `darkMode: "class"`).

### 4. Avoid Arbitrary Values
Use tokens instead of arbitrary Tailwind values whenever possible.

**❌ Don't:**
```tsx
<div className="bg-[#1a1a1a] shadow-[0_2px_8px_rgba(0,0,0,0.2)]">
```

**✅ Do:**
```tsx
<div className="bg-muted shadow-elegant">
```

---

## Reference

**Token Source:** `frontend/tailwind.config.ts`  
**CSS Variables:** Defined in `frontend/src/index.css`  
**Component Audit:** See ROADMAP.md (Design System section) for token usage compliance

---

## Migration Guide

If you find hardcoded values in components:

1. **Identify the semantic purpose** (e.g., "This is a primary action button")
2. **Find the matching token** (e.g., `bg-primary`)
3. **Replace hardcoded value** with token class
4. **Test in both light and dark modes** (when light theme is implemented)

**Example Migration:**
```diff
- <button className="bg-blue-600 hover:bg-blue-700">
+ <button className="bg-primary hover:bg-primary-dark">
```
