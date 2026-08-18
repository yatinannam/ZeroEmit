---
name: ZeroEmit Core
colors:
  surface: '#f1fdec'
  surface-dim: '#d1ddcd'
  surface-bright: '#f1fdec'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#ebf7e7'
  surface-container: '#e5f1e1'
  surface-container-high: '#e0ecdb'
  surface-container-highest: '#dae6d6'
  on-surface: '#141e14'
  on-surface-variant: '#40493d'
  inverse-surface: '#293328'
  inverse-on-surface: '#e8f4e4'
  outline: '#707a6c'
  outline-variant: '#bfcaba'
  surface-tint: '#1b6d24'
  primary: '#0d631b'
  on-primary: '#ffffff'
  primary-container: '#2e7d32'
  on-primary-container: '#cbffc2'
  inverse-primary: '#88d982'
  secondary: '#006e1c'
  on-secondary: '#ffffff'
  secondary-container: '#91f78e'
  on-secondary-container: '#00731e'
  tertiary: '#4d5950'
  on-tertiary: '#ffffff'
  tertiary-container: '#657167'
  on-tertiary-container: '#e8f5e9'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#a3f69c'
  primary-fixed-dim: '#88d982'
  on-primary-fixed: '#002204'
  on-primary-fixed-variant: '#005312'
  secondary-fixed: '#94f990'
  secondary-fixed-dim: '#78dc77'
  on-secondary-fixed: '#002204'
  on-secondary-fixed-variant: '#005313'
  tertiary-fixed: '#d9e6da'
  tertiary-fixed-dim: '#bdcabe'
  on-tertiary-fixed: '#131e17'
  on-tertiary-fixed-variant: '#3e4a41'
  background: '#f1fdec'
  on-background: '#141e14'
  surface-variant: '#dae6d6'
typography:
  display-metrics:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  container-padding: 20px
  touch-target-min: 44px
---

## Brand & Style
The design system embodies a "Climate-Tech Premium" aesthetic, merging the meticulous precision of high-end hardware interfaces with the accessibility of a modern service app. The brand personality is authoritative yet encouraging, positioning itself as a sophisticated tool for environmental stewardship.

The visual style is **Modern Corporate** with a heavy influence from **Minimalism**. It prioritizes high-density information through clear hierarchy, vast whitespace, and a "soft-tech" feel. The interface should feel breathable and calm, reducing the cognitive load of energy management. Motion should be fluid and intentional, mirroring the quiet efficiency of an electric drivetrain.

## Colors
The palette is rooted in a "Deep Forest" spectrum to evoke stability and growth. 
- **Primary Green (#2E7D32)** is reserved for the most critical actions and primary brand touchpoints.
- **Secondary Green (#4CAF50)** acts as a functional accent for "success" states, active charging indicators, and positive data trends.
- **Light Green (#E8F5E9)** serves as a soft container background to differentiate sections without the harshness of borders.
- **Neutral/Text (#172117)** is a high-contrast charcoal-green, providing better readability and a more premium feel than pure black.
- **Warning (#D97706)** is used sparingly for high-grid-intensity periods or low-battery alerts.

## Typography
The system uses **Inter** exclusively to maintain a functional, systematic appearance. 
- **Metrics & Data:** Use the `display-metrics` role for carbon savings, battery percentages, and cost. These should always be bold and slightly tracked-in to feel "heavy" and impactful.
- **Hierarchy:** Section headers use `headline-md`. Support text uses `body-sm` in the secondary text color to create a clear visual distinction between data and labels.
- **Readability:** Maintain a minimum 1.5x line height for body text to ensure legibility during mobile use (e.g., while walking to a vehicle).

## Layout & Spacing
This is a **mobile-first fluid design**. The layout relies on a 4-column grid for mobile with 20px side margins and 16px gutters.

- **Rhythm:** Use an 8px base unit for all spatial relationships. 
- **Vertical Flow:** Stack cards with 16px spacing. Group related data points within cards using 8px spacing.
- **Touch Areas:** All interactive elements (buttons, toggles, chips) must adhere to a minimum 44px height/width to ensure accessibility in a mobile environment.
- **Safe Areas:** Ensure content respects the "Notch" and "Home Indicator" areas on modern mobile devices by utilizing bottom-padding on the navigation bar.

## Elevation & Depth
Depth is conveyed through **Tonal Layers** and extremely **Ambient Shadows**. 
- **Level 0 (Base):** Background (#F7FBF7).
- **Level 1 (Cards):** Pure White (#FFFFFF) surfaces with a subtle, highly diffused shadow (0px 4px 20px rgba(23, 33, 23, 0.04)).
- **Level 2 (Overlays/Modals):** Pure White with a more pronounced shadow (0px 10px 30px rgba(23, 33, 23, 0.08)) and a backdrop blur of 10px.

Avoid harsh borders. Use subtle 1px inner-strokes in `tertiary_green` for containers if extra definition is required against the white background.

## Shapes
The shape language is friendly and modern.
- **Standard Cards/Containers:** 16px radius (`rounded-lg`) is the default for all metric cards and input groups.
- **Buttons:** Use 12px radius for a sophisticated, slightly "softer" look than sharp corners, but more professional than full pills.
- **Achievement Badges:** 100% circular or 24px+ radius to differentiate "rewards" from "data".
- **Selection Indicators:** Use pill-shaped (full radius) for segmented controls and tags.

## Components
- **Primary Buttons:** Solid `primary_color_hex` with white text. 16px padding horizontal, 48px height.
- **Secondary Buttons:** `tertiary_color_hex` background with `primary_color_hex` text. No border.
- **Metric Cards:** White background, 16px padding. Title in `label-caps` (secondary text), main value in `display-metrics` (primary text), and a small trend indicator at the bottom.
- **Forecast Charts:** Use a smoothed area chart. The "Green Energy" fill should use a gradient from `secondary_color_hex` (30% opacity) to transparent.
- **Bottom Navigation:** Fixed height 84px (including safe area). Use active state icons in `primary_color_hex` with a 4px circular dot indicator beneath the active icon.
- **Input Fields:** 12px rounded corners, 1px stroke in `text_secondary_hex` at 20% opacity. Label sits above the field in `label-caps`.
- **Achievement Badges:** Circular containers with 10% opacity `primary_color_hex` background and centered 24px icons.