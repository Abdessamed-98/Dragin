import { useEffect, useRef, useState } from 'react';
import { X, Camera, Loader2, CheckCircle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { ConnectionInfo } from '@/services/platform';

interface Props {
  mode: 'qr' | 'scanner';
  connectionInfo?: ConnectionInfo | null;
  pairPin?: string | null;
  onScanned: (info: ConnectionInfo) => void;
  onClose: () => void;
}

export function QRPairModal({ mode, connectionInfo, pairPin, onScanned, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative bg-slate-800 rounded-2xl p-6 mx-4 max-w-sm w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-slate-700 transition-colors"
        >
          <X className="w-5 h-5 text-slate-400" />
        </button>

        {mode === 'qr' ? (
          <QRDisplay connectionInfo={connectionInfo} pairPin={pairPin} />
        ) : (
          <MobileScanner onScanned={onScanned} />
        )}
      </div>
    </div>
  );
}

// --- Desktop: show QR code + PIN ---

function QRDisplay({ connectionInfo, pairPin }: { connectionInfo?: ConnectionInfo | null; pairPin?: string | null }) {
  if (!connectionInfo) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
        <p className="text-sm text-slate-400">Loading connection info...</p>
      </div>
    );
  }

  const qrData = JSON.stringify({
    space: true,
    ip: connectionInfo.ip,
    port: connectionInfo.port,
    id: connectionInfo.id,
    name: connectionInfo.name,
  });

  return (
    <div className="flex flex-col items-center gap-4">
      <h2 className="text-lg font-semibold">Connect Mobile</h2>
      <p className="text-sm text-slate-400 text-center">
        Scan this QR code with Space on your phone
      </p>
      <div className="bg-white p-4 rounded-xl">
        <QRCodeSVG value={qrData} size={200} level="M" />
      </div>

      {/* PIN display */}
      {pairPin && (
        <>
          <div className="flex items-center gap-3 w-full">
            <div className="flex-1 h-px bg-slate-700" />
            <span className="text-xs text-slate-500">or enter code</span>
            <div className="flex-1 h-px bg-slate-700" />
          </div>
          <div className="flex gap-2">
            {pairPin.split('').map((digit, i) => (
              <span
                key={i}
                className="w-10 h-12 flex items-center justify-center text-xl font-mono font-bold bg-slate-700 rounded-lg text-white"
              >
                {digit}
              </span>
            ))}
          </div>
        </>
      )}

      <p className="text-xs text-slate-500 text-center">
        {connectionInfo.name} &middot; {connectionInfo.ip}:{connectionInfo.port}
      </p>
    </div>
  );
}

// --- Mobile: tabs for camera scan or code entry ---

function MobileScanner({ onScanned }: { onScanned: (info: ConnectionInfo) => void }) {
  const [tab, setTab] = useState<'scan' | 'code'>('scan');

  return (
    <div className="flex flex-col gap-4">
      {/* Tab toggle */}
      <div className="flex rounded-lg bg-slate-700/50 p-1">
        <button
          onClick={() => setTab('scan')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === 'scan' ? 'bg-blue-600 text-white' : 'text-slate-400'
          }`}
        >
          Scan QR
        </button>
        <button
          onClick={() => setTab('code')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === 'code' ? 'bg-blue-600 text-white' : 'text-slate-400'
          }`}
        >
          Enter Code
        </button>
      </div>

      {tab === 'scan' ? (
        <CameraScanner onScanned={onScanned} />
      ) : (
        <PinEntry onScanned={onScanned} />
      )}
    </div>
  );
}

// --- Camera QR scanner (extracted from original QRScanner) ---

function CameraScanner({ onScanned }: { onScanned: (info: ConnectionInfo) => void }) {
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [scannedInfo, setScannedInfo] = useState<ConnectionInfo | null>(null);
  const processedRef = useRef(false);

  useEffect(() => {
    let stopped = false;

    async function startScanner() {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');

        if (stopped || !scannerRef.current) return;

        const scannerId = 'space-qr-scanner';
        scannerRef.current.id = scannerId;

        const scanner = new Html5Qrcode(scannerId);
        html5QrRef.current = scanner;

        // Pick the main rear camera (not ultrawide/telephoto)
        let cameraId: string | { facingMode: string } = { facingMode: 'environment' };
        try {
          const cameras = await Html5Qrcode.getCameras();
          if (cameras.length > 0) {
            const backCams = cameras.filter(c => {
              const label = c.label.toLowerCase();
              return label.includes('back') || label.includes('rear') || label.includes('environment');
            });
            const pool = backCams.length > 0 ? backCams : cameras;
            const main = pool.find(c => {
              const label = c.label.toLowerCase();
              return !label.includes('wide') && !label.includes('ultra') && !label.includes('tele') && !label.includes('macro');
            });
            cameraId = (main || pool[0]).id;
          }
        } catch {
          // Camera enumeration failed — fall back to facingMode
        }

        await scanner.start(
          cameraId,
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            if (processedRef.current) return;
            try {
              const data = JSON.parse(decodedText);
              if (data.space && data.ip && data.port && data.id) {
                processedRef.current = true;
                scanner.stop()
                  .catch(() => {})
                  .finally(() => {
                    html5QrRef.current = null;
                    setScannedInfo({
                      ip: data.ip,
                      port: data.port,
                      id: data.id,
                      name: data.name || 'Desktop',
                    });
                  });
              }
            } catch {
              // Not valid Space QR — ignore
            }
          },
          () => {
            // No QR in frame — expected, ignore
          }
        );
      } catch (err: any) {
        if (!stopped) {
          setError(err.message || 'Camera access denied');
        }
      }
    }

    startScanner();

    return () => {
      stopped = true;
      if (html5QrRef.current) {
        html5QrRef.current.stop().catch(() => {});
        html5QrRef.current = null;
      }
    };
  }, []);

  // After scanner is fully stopped and scannedInfo is set, notify parent
  useEffect(() => {
    if (!scannedInfo) return;
    const timer = setTimeout(() => {
      onScanned(scannedInfo);
    }, 300);
    return () => clearTimeout(timer);
  }, [scannedInfo, onScanned]);

  if (scannedInfo) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <CheckCircle className="w-10 h-10 text-green-400" />
        <p className="text-sm text-green-400 font-medium">Found {scannedInfo.name}</p>
        <p className="text-xs text-slate-500">Connecting...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="flex flex-col items-center gap-3 py-8">
          <Camera className="w-10 h-10 text-red-400" />
          <p className="text-sm text-red-400 text-center">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-sm text-slate-400 text-center">
        Point your camera at the QR code on your desktop
      </p>
      <div
        ref={scannerRef}
        className="w-full rounded-xl overflow-hidden bg-black"
        style={{ minHeight: 280 }}
      />
    </div>
  );
}

// --- PIN code entry (mobile) ---

function PinEntry({ onScanned }: { onScanned: (info: ConnectionInfo) => void }) {
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [status, setStatus] = useState<'idle' | 'searching' | 'found' | 'error'>('idle');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const submittedRef = useRef(false);

  const handleSubmit = async (pin: string) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setStatus('searching');
    try {
      const { findPeerByPin } = await import('../services/mobileNet');
      const result = await findPeerByPin(pin);
      if (result) {
        setStatus('found');
        setTimeout(() => {
          onScanned({ ip: result.ip, port: result.port, id: result.id, name: result.name });
        }, 300);
      } else {
        setStatus('error');
        submittedRef.current = false;
      }
    } catch {
      setStatus('error');
      submittedRef.current = false;
    }
  };

  const handleDigit = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return;
    const newDigits = [...digits];
    newDigits[index] = value;
    setDigits(newDigits);

    // Auto-advance to next box
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 filled
    if (value && newDigits.every(d => d !== '')) {
      handleSubmit(newDigits.join(''));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (text.length === 6) {
      e.preventDefault();
      const newDigits = text.split('');
      setDigits(newDigits);
      inputRefs.current[5]?.focus();
      handleSubmit(text);
    }
  };

  // Reset after error
  useEffect(() => {
    if (status === 'error') {
      const timer = setTimeout(() => {
        setStatus('idle');
        setDigits(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [status]);

  if (status === 'found') {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <CheckCircle className="w-10 h-10 text-green-400" />
        <p className="text-sm text-green-400 font-medium">Device found!</p>
        <p className="text-xs text-slate-500">Connecting...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-sm text-slate-400 text-center">
        Enter the 6-digit code shown on your desktop
      </p>

      <div className="flex gap-2">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={el => { inputRefs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={d}
            onChange={e => handleDigit(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            onPaste={i === 0 ? handlePaste : undefined}
            className="w-11 h-14 text-center text-2xl font-mono font-bold bg-slate-700 border border-slate-600 rounded-lg text-white focus:border-blue-500 focus:outline-none transition-colors"
            disabled={status !== 'idle'}
            autoFocus={i === 0}
          />
        ))}
      </div>

      {status === 'searching' && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Searching nearby devices...
        </div>
      )}

      {status === 'error' && (
        <p className="text-sm text-red-400">No device found with this code</p>
      )}
    </div>
  );
}
