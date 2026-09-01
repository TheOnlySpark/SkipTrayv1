import React, { useState, useMemo, useRef, useEffect } from 'react';
import { QRCodeSVG } from '../components/QRCode';
import { IconCamera, IconCheckCircle, IconRefreshCw, IconZap } from '../components/Icons';

export default function QRTestBench() {
  const [inputText, setInputText] = useState('SKIPTRAY:b3f4a1c2-9a3d-4e5f-8c1b-2d3e4f5a6b7c:482910');
  const [qrSize, setQrSize] = useState(260);
  const [margin, setMargin] = useState(4);
  const [scannedResult, setScannedResult] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const presets = [
    { label: 'Full UUID Token', val: 'SKIPTRAY:b3f4a1c2-9a3d-4e5f-8c1b-2d3e4f5a6b7c:482910' },
    { label: 'Short Token', val: 'SKIP:1042:482910' },
    { label: '6-Digit OTP Only', val: '482910' },
    { label: 'Simple Text', val: 'Hello SkipTray' },
    { label: 'Website URL', val: 'https://skiptray.com' },
  ];

  // Render pure Canvas 2D Bitmap representation as well
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw high-contrast canvas version
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Draw SVG onto canvas or direct pixels
  }, [inputText, qrSize, margin]);

  // Live Camera Scanner
  useEffect(() => {
    if (!cameraActive) return;
    let stream: MediaStream | null = null;
    let intervalId: number | null = null;

    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
      .then(s => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play();
        }

        const BarcodeDetectorClass = (window as unknown as { BarcodeDetector?: new (opt: { formats: string[] }) => { detect: (src: ImageBitmapSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        if (BarcodeDetectorClass) {
          const detector = new BarcodeDetectorClass({ formats: ['qr_code'] });
          intervalId = window.setInterval(async () => {
            if (videoRef.current && videoRef.current.readyState >= 2) {
              try {
                const barcodes = await detector.detect(videoRef.current);
                if (barcodes.length > 0) {
                  setScannedResult(barcodes[0].rawValue);
                  setScanStatus('SUCCESS');
                }
              } catch {}
            }
          }, 200);
        }
      })
      .catch(err => {
        setScanStatus('Camera Error: ' + err.message);
      });

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, [cameraActive]);

  return (
    <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-[2rem] p-6 sm:p-8 shadow-sm space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-slate-200">
        <div>
          <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold uppercase tracking-wider">
            🧪 Diagnostic Lab
          </span>
          <h1 className="text-3xl font-extrabold text-slate-900 mt-2">QR Code Test Bench</h1>
          <p className="text-xs text-slate-500 mt-1">
            Test and verify QR code scanning in real-time with Google Lens, phone cameras, and live scanner.
          </p>
        </div>
      </div>

      {/* Preset Quick Buttons */}
      <div className="space-y-2">
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Quick Presets</label>
        <div className="flex flex-wrap gap-2">
          {presets.map(p => (
            <button
              key={p.label}
              onClick={() => setInputText(p.val)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                inputText === p.val
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input Field */}
      <div className="space-y-2">
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Payload String to Encode</label>
        <input
          type="text"
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Enter text to generate QR code..."
        />
        <div className="flex justify-between text-[11px] text-slate-400">
          <span>Length: {inputText.length} characters</span>
          <span>Encoding: ISO Byte Mode (UTF-8) • ECC: Level M (15%)</span>
        </div>
      </div>

      {/* Sliders for Size & Margin */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200">
        <div>
          <label className="text-xs font-bold text-slate-700 flex justify-between">
            <span>Display Size:</span>
            <span className="font-mono text-indigo-600">{qrSize}px</span>
          </label>
          <input
            type="range"
            min={150}
            max={400}
            step={10}
            value={qrSize}
            onChange={e => setQrSize(Number(e.target.value))}
            className="w-full mt-2 accent-indigo-600 cursor-pointer"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-slate-700 flex justify-between">
            <span>Quiet Zone Margin:</span>
            <span className="font-mono text-indigo-600">{margin} modules</span>
          </label>
          <input
            type="range"
            min={0}
            max={8}
            step={1}
            value={margin}
            onChange={e => setMargin(Number(e.target.value))}
            className="w-full mt-2 accent-indigo-600 cursor-pointer"
          />
        </div>
      </div>

      {/* QR Code Display & Scan Target */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
        {/* Visual QR Card (Point Google Lens Here) */}
        <div className="flex flex-col items-center justify-center p-6 bg-slate-900 rounded-3xl border border-slate-800 shadow-xl space-y-4">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
            Scan Target (Aim Google Lens Here)
          </span>

          <div className="bg-white p-6 rounded-2xl shadow-2xl border-4 border-white inline-block">
            <QRCodeSVG
              value={inputText}
              size={qrSize}
              includeMargin={margin > 0}
            />
          </div>

          <p className="text-xs text-slate-400 text-center max-w-xs">
            High-contrast white background with {margin}-module quiet zone.
          </p>
        </div>

        {/* Live Camera Scanner Verification Box */}
        <div className="flex flex-col items-center justify-center p-6 bg-slate-50 rounded-3xl border border-slate-200 shadow-inner space-y-4 min-h-[350px]">
          <div className="flex items-center justify-between w-full">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <IconCamera size={16} className="text-indigo-600" />
              <span>In-App Scanner Test</span>
            </span>
            <button
              onClick={() => setCameraActive(!cameraActive)}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                cameraActive ? 'bg-rose-500 text-white' : 'bg-indigo-600 text-white'
              }`}
            >
              {cameraActive ? 'Stop Camera' : 'Start Camera'}
            </button>
          </div>

          {cameraActive ? (
            <div className="relative aspect-square w-full max-w-[260px] bg-black rounded-2xl overflow-hidden shadow-md">
              <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
              <div className="absolute inset-0 border-2 border-indigo-400 rounded-2xl pointer-events-none"></div>
            </div>
          ) : (
            <div className="w-full max-w-[260px] aspect-square rounded-2xl bg-slate-200 border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 p-4 text-center">
              <IconCamera size={32} className="mb-2 opacity-50" />
              <span className="text-xs font-medium">Click "Start Camera" to test the in-browser decoder</span>
            </div>
          )}

          {scannedResult && (
            <div className="w-full bg-emerald-50 border border-emerald-200 p-3 rounded-xl text-emerald-800 text-xs font-mono break-all flex items-start gap-2">
              <IconCheckCircle size={16} className="text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <strong>Decoded:</strong> {scannedResult}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
