/**
 * Audio synthesis and haptic feedback utilities for order status notifications.
 * Uses Web Audio API for zero-dependency, ultra-reliable harmonic chimes.
 */

export type OrderNotificationStatus = 'ACCEPTED' | 'PREPARING' | 'READY';

// Helper to get AudioContext cross-browser safely
function getAudioContext(): AudioContext | null {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    return new AudioCtx();
  } catch {
    return null;
  }
}

/**
 * Play a distinct synthesized chime depending on the order status.
 * - ACCEPTED: Warm, reassuring 2-tone ascending chime (C5 -> E5)
 * - PREPARING: Upbeat 3-tone kitchen prep chime (A4 -> C#5 -> E5)
 * - READY: Celebratory 4-tone pickup fanfare (C5 -> E5 -> G5 -> C6)
 */
export function playStatusChime(status: OrderNotificationStatus): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    if (status === 'ACCEPTED') {
      // 2-tone ascending harmonic chime (C5: 523.25Hz -> E5: 659.25Hz)
      const notes = [
        { freq: 523.25, time: 0, duration: 0.15 },
        { freq: 659.25, time: 0.12, duration: 0.28 },
      ];

      notes.forEach(({ freq, time, duration }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + time);

        gain.gain.setValueAtTime(0, now + time);
        gain.gain.linearRampToValueAtTime(0.18, now + time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + time + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + time);
        osc.stop(now + time + duration);
      });
    } else if (status === 'PREPARING') {
      // 3-tone rhythmic chime (A4: 440Hz -> C#5: 554.37Hz -> E5: 659.25Hz)
      const notes = [
        { freq: 440.0, time: 0, duration: 0.12 },
        { freq: 554.37, time: 0.10, duration: 0.12 },
        { freq: 659.25, time: 0.20, duration: 0.30 },
      ];

      notes.forEach(({ freq, time, duration }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        // Layered triangle/sine for slightly richer "cooking/progress" timbre
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + time);

        gain.gain.setValueAtTime(0, now + time);
        gain.gain.linearRampToValueAtTime(0.16, now + time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + time + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + time);
        osc.stop(now + time + duration);
      });
    } else if (status === 'READY') {
      // 4-tone celebratory fanfare arpeggio (C5: 523.25Hz -> E5: 659.25Hz -> G5: 783.99Hz -> C6: 1046.50Hz)
      const notes = [
        { freq: 523.25, time: 0, duration: 0.14 },
        { freq: 659.25, time: 0.11, duration: 0.14 },
        { freq: 783.99, time: 0.22, duration: 0.16 },
        { freq: 1046.50, time: 0.35, duration: 0.55 },
      ];

      notes.forEach(({ freq, time, duration }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + time);

        gain.gain.setValueAtTime(0, now + time);
        gain.gain.linearRampToValueAtTime(0.22, now + time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + time + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + time);
        osc.stop(now + time + duration);
      });
    }
  } catch {
    // Gracefully ignore autoplay or audio context errors
  }
}

/**
 * Triggers vibration feedback on supported mobile devices.
 */
export function triggerHapticFeedback(status: OrderNotificationStatus): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      if (status === 'ACCEPTED') {
        navigator.vibrate([70]);
      } else if (status === 'PREPARING') {
        navigator.vibrate([100, 50, 100]);
      } else if (status === 'READY') {
        // High-priority pulsing vibration
        navigator.vibrate([200, 100, 200, 100, 400]);
      }
    }
  } catch {
    // Gracefully ignore devices that don't support vibration
  }
}
