# SkipTray Design Philosophy

This document outlines the core design philosophy, typography, color palette, and other key UI/UX aspects used in the **SkipTray** application.

## 1. Core Design Philosophy

The application follows a **modern, clean, and highly tactile card-based design**. It aims for a "premium yet friendly" aesthetic, leveraging subtle depths, generous border radiuses, and high-contrast elements to make the interface incredibly intuitive and easy to scan—which is especially critical for a fast-paced environment like a canteen order dashboard.

## 2. Typography (Hierarchy & Spacing)

We use a highly structured approach to typography with Tailwind's default **sans-serif** stack, relying heavily on font weights and letter spacing to create visual hierarchy rather than just size.

* **Weights**: Heavy usage of robust weights (`font-black`, `font-extrabold`, `font-bold`) for numbers, statuses, and primary headings to make data instantly readable from a glance. 
* **Tracking & Leading**: 
  * Large headings use tight spacing (`tracking-tight`, `leading-tight`) for a sleek, modern look.
  * Metadata and small utility text (like "Total Active", "ID: X") use uppercase with wide spacing (`uppercase`, `tracking-wider`, `tracking-widest`, `text-[10px]`/`text-[11px]`) to look clean and technical without competing with primary data.
* **Monospace**: `font-mono` is selectively used for specific technical data like Student IDs and OTP inputs to ensure character clarity.

## 3. Color Palette

The app uses a curated, harmonious color palette primarily built on Tailwind's **Slate** and **Indigo** scales, with semantic colors mapped to specific real-world statuses.

### Base & Backgrounds
* **Main App Background**: A very light, cool off-white (`bg-[#f8fafc]` / `slate-50`).
* **Cards/Surfaces**: Clean white (`bg-white`) with subtle slate borders (`border-slate-100`, `border-slate-200`).

### Primary Brand Accent
* **Indigo** (`indigo-600`, `indigo-700`, `indigo-50`): Used for primary calls to action (Login, Accept Order), active states, and brand highlights.

### High-Contrast Dark Surfaces
* Important command areas (like the Top Operations Header in the Staff Dashboard) are inverted to use **Dark Slate** (`bg-slate-900`, `bg-slate-800/60`) with white text. This creates a striking "Command Center" feel and draws immediate attention to critical metrics and tools.

### Semantic Status Colors (Crucial for Kanban/Order flow)
* **Placed (New)**: Slate/Default (`bg-slate-100`, `text-slate-700`)
* **Accepted**: Blue (`bg-blue-50`, `text-blue-700`)
* **Preparing**: Orange (`bg-orange-50`, `text-orange-700`, `bg-orange-500` for actions)
* **Ready/Success**: Emerald (`bg-emerald-50`, `text-emerald-700`, `bg-emerald-600` for actions)
* **Overdue/Warning**: Amber (`bg-amber-50`, `ring-amber-100`, `text-amber-900`)
* **Rejected/Danger**: Rose (`bg-rose-50`, `text-rose-600`)

## 4. Shapes, Borders, and Depth

* **"Squircle" Radiuses**: The design avoids sharp corners. It leans heavily into large, friendly border radiuses:
  * Main containers and prominent buttons use `rounded-[2rem]` or `rounded-2xl`.
  * Standard buttons, tags, and inputs use `rounded-xl`.
  * Status badges and avatars use `rounded-full`.
* **Depth & Glassmorphism**: 
  * Standard cards use light shadows (`shadow-sm`) that elevate slightly on hover (`hover:shadow-md`).
  * Translucent/Glass effects are used in the dark command center (`bg-slate-800/60`, `border-slate-700/60`) and on toasts to feel modern and layered.

## 5. Iconography

* **Lucide React** is the icon library of choice. 
* Icons are used heavily, but always purposefully (never just for decoration). They accompany almost all action buttons (e.g., `<IconCooking /> Start Preparing`, `<IconZap /> Collect`) to ensure staff can operate the UI rapidly through visual muscle memory without reading text.

## 6. Micro-interactions & Feedback

* **Hover & Active States**: Buttons have clear background transitions (`transition-colors`, `hover:bg-indigo-700`) and tactile press effects (`active:scale-95` on the QR scanner button).
* **Animations**: Subtle, purposeful animations are used to draw attention to critical events, such as `animate-pulse` on the overdue indicator dot, and `animate-in fade-in slide-in-from-top-1` for quick OTP toast notifications.
* **Audio Feedback**: The QR/OTP scanner incorporates actual audio cues bridging the digital UI with physical real-world operations.
