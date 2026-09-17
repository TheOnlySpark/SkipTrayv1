# SkipTray: Campus PreOrdering Dashboard

**VISTAS & MH Collaborative**  
*Developed by Prahaan Adi D and Madeshwar P*

## What is SkipTray?
SkipTray is a canteen ordering dashboard built to eliminate long lines and confusion during lunch hours. It provides a seamless way for students and teachers to browse the menu, place their orders in advance, and pick up their food at designated time slots without the hassle of waiting in physical queues.

## Why Use It?
The traditional canteen experience is often chaotic:
- **Long Lines:** Students waste their breaks standing in line.
- **Uncertainty:** Popular items sell out before you reach the front.
- **Inefficiency:** Canteen staff are overwhelmed during peak rush hours, leading to errors and delays.

SkipTray solves these problems by shifting the ordering process online. You order from your phone or computer, view exactly what is available, and only go to the canteen when your food is ready.

## How It Helps
SkipTray transforms the lunchtime experience through the following operational improvements:
- **Massive Time Savings:** SkipTray **reduces canteen waiting time from an average of 15 minutes down to just 2-3 minutes**. 
- **Fair Access:** Lunch bookings open at a specific time (e.g., 9:30 AM), ensuring everyone has an equal opportunity to select their meals.
- **Predictability for Kitchen Staff:** The canteen staff receives orders in advance, allowing them to prepare food efficiently without being rushed by a sudden influx of people.

## What the User Sees
The SkipTray interface is designed for efficient and straightforward interaction:
- **Clean Design:** A card-based menu layout that enables rapid item selection.
- **Live Status Updates:** You can monitor the exact state of your order—whether it has just been placed, is currently being prepared, or is ready for pickup.
- **Color-Coded Badges:** Immediate visual cues (e.g., Green for Ready, Orange for Preparing) to convey order status at a glance.

## Security Features & Accountability
SkipTray implements several security and accountability measures:
- **OTP & QR Code Verification:** When you place an order, you receive a unique 6-digit OTP (One-Time Password) and a QR code. The staff must scan your QR code or enter your OTP before handing over the food, ensuring nobody else can take your meal.
- **The Strike System:** To prevent food waste and ensure fairness, users who fail to pick up their orders (No-Shows) receive a "strike." Accumulating too many strikes temporarily suspends the account from placing future orders.

## How It's Made (The Tech Stack)
SkipTray utilizes the following technology stack to maintain system reliability and performance:
- **Frontend:** React and Vite (provides a responsive, component-based user interface).
- **Styling:** TailwindCSS (utility-first CSS framework for consistent UI styling).
- **Backend & Database:** Supabase (provides PostgreSQL for structured data storage, Row Level Security, and real-time WebSocket subscriptions).
