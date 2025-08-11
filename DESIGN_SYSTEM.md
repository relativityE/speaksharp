# SpeakSharp Design System

**Version**: 1.0
**Last Updated**: 2025-08-10

## 1. Philosophy
This design system aims to create a modern, professional, and encouraging user experience for SpeakSharp. The design should be clean, consistent, and focused on helping the user achieve their goal of becoming a more confident speaker. It draws inspiration from top-tier SaaS products like Notion, Linear, and Duolingo.

---

## 2. Color Palette

| Role | Color | Hex Code | Usage |
|---|---|---|---|
| **Primary Action** | Green | `#10B981` | Primary CTAs (e.g., "Start Session"), success states. |
| **Primary Brand** | Purple | `#8B5CF6` | Accents, links, highlights, chart lines. |
| **Background** | Dark Blue/Purple | `#0D0C1D` | Main page and component backgrounds. |
| **Component BG** | Lighter Dark | `#1A192D` | Card backgrounds to create depth. |
| **Border** | Subtle Dark | `#2A293D` | Borders for cards and components. |
| **Text (Headlines)**| White | `#FFFFFF` | Main headlines (`h1`, `h2`). |
| **Text (Body)** | Light Gray | `#A0A0B0` | Body text, paragraphs, muted text. |
| **Destructive** | Red | `#EF4444` | Destructive actions (e.g., "End Session"). |

---

## 3. Typography

*   **Font Family**: **Inter**, with a fallback to `sans-serif`.
*   **Base Font Size**: 16px.

### Typographic Scale
| Element | Font Size | Font Weight | Notes |
|---|---|---|---|
| `h1` | 48px | Bold (700) | Main page titles. |
| `h2` | 36px | Bold (700) | Section titles. |
| `h3` | 24px | Semi-bold (600) | Card titles, sub-sections. |
| Body | 16px | Regular (400) | Paragraphs, main content. |
| Small / Muted | 14px | Regular (400) | Helper text, captions. |

---

## 4. Component Library

### Buttons
*   **Primary Button (`.btn-primary`)**:
    *   **Background**: Primary Action Green (`#10B981`).
    *   **Text Color**: White.
    *   **Hover State**: Subtle glow or lift effect.
    *   **Usage**: For the most important action on a page.

*   **Secondary Button (`.btn-secondary`)**:
    *   **Background**: Transparent.
    *   **Text Color**: Primary Brand Purple (`#8B5CF6`).
    *   **Border**: 1px solid Primary Brand Purple.
    *   **Usage**: For secondary actions.

*   **Tertiary Button / Link (`.btn-tertiary`)**:
    *   **Background**: Transparent.
    *   **Text Color**: Primary Brand Purple (`#8B5CF6`).
    *   **Border**: None.
    *   **Usage**: For less important actions, like links in footers or navigation.

### Cards
*   **Default Card (`.card`)**:
    *   **Background**: Component BG (`#1A192D`).
    *   **Border**: 1px solid Border color (`#2A293D`).
    *   **Border Radius**: 12px.
    *   **Padding**: 24px.

*   **Metric Card (`.card-metric`)**:
    *   A variation of the default card for displaying key stats.
    *   May have a subtle gradient or a different background color to stand out.

### Form Inputs
*   **Default Input (`.input`)**:
    *   **Background**: Component BG (`#1A192D`).
    *   **Border**: 1px solid Border color (`#2A293D`).
    *   **Text Color**: White.
    *   **Focus State**: A glowing ring using the Primary Brand Purple color.

---

## 5. Spacing & Layout
*   **Base Unit**: 8px.
*   **Common Spacing**: Use multiples of the base unit (8px, 16px, 24px, 32px, etc.) for margins, padding, and gaps to ensure consistency.
*   **Layout**: The application uses a centered, max-width container for most pages. The session page uses a two-panel layout. The design should be mobile-first and responsive.

---

## 6. Accessibility
*   **Contrast**: All text and UI elements should meet WCAG AA contrast ratios. The chosen color palette has been designed with this in mind.
*   **Font Size**: The base font size of 16px is accessible.
*   **ARIA Labels**: All interactive elements (buttons, links) should have clear and descriptive `aria-label` attributes where necessary.
*   **Focus States**: All interactive elements must have a clear and visible focus state.
