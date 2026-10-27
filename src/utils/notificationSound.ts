/**
 * Audio synthesis and haptic feedback utilities for order status notifications.
 * Uses Web Audio API for zero-dependency, ultra-reliable harmonic chimes.
 */

export type OrderNotificationStatus = 'ACCEPTED' | 'PREPARING' | 'READY' | 'COLLECTED';

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
 * - COLLECTED: Harmonious, pleasant completion chime (F5 -> A5 -> C6)
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
    } else if (status === 'COLLECTED') {
      // 3-tone sweet completion chime (F5: 698.46Hz -> A5: 880.00Hz -> C6: 1046.50Hz)
      const notes = [
        { freq: 698.46, time: 0, duration: 0.12 },
        { freq: 880.00, time: 0.10, duration: 0.14 },
        { freq: 1046.50, time: 0.22, duration: 0.40 },
      ];

      notes.forEach(({ freq, time, duration }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + time);

        gain.gain.setValueAtTime(0, now + time);
        gain.gain.linearRampToValueAtTime(0.20, now + time + 0.02);
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
 * Play a loud, attention-grabbing kitchen alert chime when a new order arrives.
 * Designed specifically for noisy kitchen environments with dual-tone repeating chime.
 */
export function playIncomingOrderAlarm(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    // Pattern: 2 rapid piercing bell bursts (High E6: 1318.5Hz + B5: 987.77Hz + G#5: 830.61Hz)
    // Plays at t=0 and repeated at t=0.35s for maximum audibility in noisy kitchens.
    const bursts = [0, 0.35, 0.70];
    const notes = [
      { freq: 830.61, offset: 0, dur: 0.28, type: 'triangle' as OscillatorType, peakGain: 0.75 },
      { freq: 1318.51, offset: 0.04, dur: 0.30, type: 'sine' as OscillatorType, peakGain: 0.85 },
      { freq: 1567.98, offset: 0.08, dur: 0.32, type: 'sine' as OscillatorType, peakGain: 0.70 },
    ];

    bursts.forEach(burstTime => {
      notes.forEach(({ freq, offset, dur, type, peakGain }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, now + burstTime + offset);

        const startTime = now + burstTime + offset;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + dur);
      });
    });

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([250, 100, 250, 100, 400]);
    }
  } catch {
    // Gracefully handle browser sound policy
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
      } else if (status === 'COLLECTED') {
        // Pleasant double pulse for collection confirmation
        navigator.vibrate([120, 80, 220]);
      }
    }
  } catch {
    // Gracefully ignore devices that don't support vibration
  }
}
