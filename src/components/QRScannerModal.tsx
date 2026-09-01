import React, { useEffect, useRef, useState } from 'react';
import { IconCamera, IconX, IconRefreshCw, IconCheckCircle, IconAlertTriangle } from './Icons';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (payload: string) => Promise<boolean | void>;
}

// Synthesize pleasant pickup verification chime via Web Audio API
function playSuccessBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    // Two-tone rising chime (880Hz -> 1320Hz)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.12);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.25);
  } catch {
    // Ignore audio permission or autoplay restrictions silently
  }
}

export function QRScannerModal({ isOpen, onClose, onScanSuccess }: QRScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [lastScannedPayload, setLastScannedPayload] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const scanIntervalRef = useRef<number | null>(null);

  // Check if multiple camera devices exist
  useEffect(() => {
    if (!isOpen) return;
    navigator.mediaDevices?.enumerateDevices()
      .then(devices => {
        const videoInputs = devices.filter(d => d.kind === 'videoinput');
        setHasMultipleCameras(videoInputs.length > 1);
      })
      .catch(() => {});
  }, [isOpen]);

  // Start Camera Stream
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setError(null);
    setScanning(true);

    const startCamera = async () => {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (!isMounted) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : 'Camera access denied or unavailable.';
        setError(`Unable to access camera: ${msg}. You can still verify orders by typing the 6-digit OTP.`);
      }
    };

    startCamera();

    return () => {
      isMounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, [isOpen, facingMode]);

  // QR Code Frame Analysis Loop
  useEffect(() => {
    if (!isOpen || !scanning) return;

    let isScanningActive = true;
    const BarcodeDetectorClass = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => { detect: (source: ImageBitmapSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;

    let detector: { detect: (source: ImageBitmapSource) => Promise<{ rawValue: string }[]> } | null = null;
    if (BarcodeDetectorClass) {
      try {
        detector = new BarcodeDetectorClass({ formats: ['qr_code'] });
      } catch {
        detector = null;
      }
    }

    const checkFrame = async () => {
      if (!isScanningActive || isProcessing || !videoRef.current || videoRef.current.readyState < 2) {
        return;
      }

      try {
        if (detector) {
          const barcodes = await detector.detect(videoRef.current);
          if (barcodes && barcodes.length > 0 && isScanningActive && !isProcessing) {
            const rawValue = barcodes[0].rawValue.trim();
            if (rawValue && rawValue !== lastScannedPayload) {
              handlePayloadDetected(rawValue);
            }
          }
        }
      } catch {
        // Continue loop
      }
    };

    const intervalId = window.setInterval(checkFrame, 200);
    scanIntervalRef.current = intervalId;

    return () => {
      isScanningActive = false;
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
      }
    };
  }, [isOpen, scanning, isProcessing, lastScannedPayload]);

  const handlePayloadDetected = async (payload: string) => {
    setIsProcessing(true);
    setLastScannedPayload(payload);
    playSuccessBeep();

    try {
      await onScanSuccess(payload);
    } catch {
      // Handled in parent
    } finally {
      // Reset cooldown for next scan after 1.5s
      setTimeout(() => {
        setIsProcessing(false);
        setLastScannedPayload(null);
      }, 1500);
    }
  };

  const toggleCamera = () => {
    setFacingMode(prev => (prev === 'environment' ? 'user' : 'environment'));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl overflow-hidden shadow-2xl w-full max-w-md flex flex-col relative text-white">
        
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30">
              <IconCamera size={18} className="w-4.5 h-4.5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-white">Instant QR Scanner</h3>
              <p className="text-[11px] text-slate-400">Scan student's pickup QR code</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {hasMultipleCameras && (
              <button
                onClick={toggleCamera}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="Switch Camera"
              >
                <IconRefreshCw size={16} className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <IconX size={18} className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Camera Viewport */}
        <div className="relative aspect-square w-full bg-black flex items-center justify-center overflow-hidden">
          {error ? (
            <div className="p-6 text-center text-slate-400 flex flex-col items-center gap-3">
              <IconAlertTriangle size={32} className="w-8 h-8 text-amber-400" />
              <p className="text-xs leading-relaxed text-slate-300">{error}</p>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover"
              />

              {/* Viewfinder Target Reticle */}
              <div className="relative z-10 w-64 h-64 border-2 border-indigo-400/60 rounded-3xl overflow-hidden shadow-[0_0_0_9999px_rgba(15,23,42,0.6)] flex items-center justify-center">
                {/* Corner Accents */}
                <div className="absolute top-2 left-2 w-5 h-5 border-t-4 border-l-4 border-indigo-400 rounded-tl-lg"></div>
                <div className="absolute top-2 right-2 w-5 h-5 border-t-4 border-r-4 border-indigo-400 rounded-tr-lg"></div>
                <div className="absolute bottom-2 left-2 w-5 h-5 border-b-4 border-l-4 border-indigo-400 rounded-bl-lg"></div>
                <div className="absolute bottom-2 right-2 w-5 h-5 border-b-4 border-r-4 border-indigo-400 rounded-br-lg"></div>

                {/* Animated Laser Scanline */}
                {!isProcessing && (
                  <div className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-indigo-400 to-transparent animate-pulse shadow-[0_0_8px_#818cf8]"
                    style={{
                      animation: 'scanLaser 2s ease-in-out infinite alternate',
                    }}
                  />
                )}

                {/* Processing Overlay */}
                {isProcessing && (
                  <div className="absolute inset-0 bg-emerald-500/20 backdrop-blur-xs flex flex-col items-center justify-center gap-2 animate-in fade-in">
                    <IconCheckCircle size={40} className="w-10 h-10 text-emerald-400" />
                    <span className="text-xs font-black text-emerald-300 uppercase tracking-wider">Verified!</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer Instructions */}
        <div className="p-4 bg-slate-900 text-center border-t border-slate-800 space-y-2">
          <p className="text-xs font-semibold text-slate-300">
            Hold student's phone screen inside the frame
          </p>
          <p className="text-[11px] text-slate-500">
            Auto-verifies and triggers confirmation chime instantly.
          </p>
        </div>
      </div>

      <style>{`
        @keyframes scanLaser {
          0% { transform: translateY(-110px); }
          100% { transform: translateY(110px); }
        }
      `}</style>
    </div>
  );
}
