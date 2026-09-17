# Architecture & Technical Overview

This document provides a high-level overview of the SkipTray system architecture, database schema, and core operational flows.

## 🏗️ System Architecture

SkipTray is built on a modern **React (Vite)** frontend connected to a **Supabase (PostgreSQL)** backend as a Service (BaaS).

### Frontend (Client)
*   **Routing**: Handled by `react-router-dom`. The app is structured into distinct dashboards based on user roles (`StudentDashboard`, `StaffDashboard`, `AdminDashboard`).
*   **State Management**: 
    *   **React Context**: Used for global UI state (e.g., `ModalDialogContext` for modals, toast notifications).
    *   **React Query**: Handled implicitly through Supabase realtime subscriptions and custom hooks to keep data fresh without manual polling.
*   **UI/UX Framework**: TailwindCSS is used for all styling, complemented by `motion` (Framer Motion) for micro-animations and `lucide-react` for iconography.
*   **Hardware Integration**: The frontend leverages device cameras/scanners to read QR codes for OTP verification (in the `QRScannerModal`).

### Backend (Supabase)
*   **Database**: PostgreSQL acts as the primary data store.
*   **Authentication**: Handled via Supabase Auth.
*   **Realtime**: Supabase Realtime is used extensively to push updates to connected clients (e.g., when a student places an order, the staff dashboard updates instantly).
*   **Security (RLS)**: Row Level Security policies ensure users can only access and modify data they own or have role-based permissions for.

---

## 🗄️ Database Schema

The database consists of the following core tables:

### 1. `profiles`
Stores user metadata extended from Supabase Auth.
*   `id` (uuid, primary key, references `auth.users`)
*   `role` (enum: `STUDENT`, `TEACHER`, `STAFF`, `ADMIN`)
*   `name`, `id_number` (string)
*   `strike_count` (integer) - Tracks no-show incidents.
*   `suspended_until` (timestamp) - Active if strikes exceed limits.

### 2. `menu_items`
The catalog of available food items.
*   `id` (uuid, primary key)
*   `name` (string)
*   `price` (integer)
*   `veg_non_veg` (enum: `VEG`, `NON_VEG`)
*   `is_sold_out` (boolean)

### 3. `orders`
The core transactional table for food orders.
*   `id` (uuid, primary key)
*   `user_id` (uuid, references `profiles`)
*   `order_number` (integer) - Resets daily.
*   `status` (enum: `PLACED`, `ACCEPTED`, `PREPARING`, `READY`, `COLLECTED`, `REJECTED`)
*   `pickup_time` (timestamp)
*   `otp_code` (string) - 6-digit code for secure pickup.
*   `otp_attempts` (integer) - Security measure against brute-forcing.
*   Timestamps: `created_at`, `accepted_at`, `ready_at`, `collected_at`

### 4. `order_items`
Junction table mapping orders to menu items.
*   `id` (uuid, primary key)
*   `order_id` (uuid, references `orders`)
*   `menu_item_id` (uuid, references `menu_items`)
*   `quantity` (integer)

### 5. `item_reviews`
Stores feedback and ratings.
*   `id` (uuid, primary key)
*   `user_id` (uuid, references `profiles`)
*   `order_id` (uuid, references `orders`)
*   `menu_item_id` (uuid, references `menu_items`)
*   `rating` (integer 1-5)
*   `feedback_text` (text, optional)
*   `admin_reply` (text, optional)

---

## 🔒 Row Level Security (RLS)

Security is enforced at the database level:
*   **Students/Teachers**: Can insert `orders`, read their own `orders`, and read `menu_items`. Cannot update order status beyond placement.
*   **Staff**: Can read all `orders` and update `orders` status (e.g., from `PLACED` to `ACCEPTED`).
*   **Admin**: Full CRUD access across all tables.

---

## 🔄 Core Workflows

### The Order Lifecycle
1.  **Placement**: Student selects items and a pickup time slot. The system checks for constraints (e.g., time must be >= 9:30 AM). If valid, an `order` is created with status `PLACED` and a random 6-digit `otp_code`.
2.  **Acceptance**: Staff see the order on their dashboard and mark it as `ACCEPTED`.
3.  **Preparation**: Kitchen staff transition the order to `PREPARING` and then `READY`.
4.  **Collection (The Happy Path)**:
    *   Student arrives and presents their OTP (or QR code).
    *   Staff enters/scans the OTP.
    *   The `verify_pickup_otp` RPC function runs in PostgreSQL. It checks the OTP against the order ID.
    *   If successful, status becomes `COLLECTED`.
5.  **No-Show (The Penalty Path)**:
    *   If an order is not collected by the end of the time slot, Staff can mark it as a No-Show.
    *   The `mark_order_no_show` RPC runs, updating the student's `strike_count` in the `profiles` table.
    *   If strikes exceed the threshold (e.g., 3), `suspended_until` is set, blocking future orders.
