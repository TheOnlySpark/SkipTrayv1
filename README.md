# SkipTray

SkipTray is a modern, fast, and tactile canteen ordering and management dashboard designed to streamline operations for students, teachers, and canteen staff. It uses a clean card-based design with robust typography to ensure rapid scanning and error-free order processing.

## 🌟 Key Features

*   **Role-Based Access Control**:
    *   **Students/Teachers**: View menu, place orders (subject to time slot constraints, e.g., 9:30 AM), receive pickup OTPs, and submit reviews.
    *   **Staff**: A robust "Command Center" to monitor incoming orders, accept them, mark as preparing/ready, and verify pickup via QR code scanner or manual OTP entry.
    *   **Admin**: Manage menu items (prices, availability), oversee user roles, manage the "strike" system (for no-shows), and review analytics.
*   **Real-time Updates**: Instant synchronization of order statuses and menu availability via Supabase Realtime.
*   **Security & Accountability**:
    *   OTP verification for secure order pickup.
    *   Strike system that temporarily suspends users for repeatedly missing pickups (no-shows).
*   **Premium UI/UX**:
    *   Tactile feedback, glassmorphism, and smooth micro-animations.
    *   Integrated audio feedback for QR scanning and OTP processing.
    *   Semantic color coding for order statuses (e.g., Placed, Preparing, Ready).

## 🛠️ Tech Stack

*   **Frontend**: React (v19), Vite, TailwindCSS (v4), Framer Motion, Lucide React
*   **Backend & Database**: Supabase (PostgreSQL) with Row Level Security (RLS)
*   **State Management**: React Query (TanStack), React Context API
