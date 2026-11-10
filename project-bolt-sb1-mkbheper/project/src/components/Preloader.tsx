import { useEffect, useState } from 'react';
import BrandLogo from '@/components/BrandLogo';

interface PreloaderProps {
  ready: boolean;
  onFinish: () => void;
}

export default function Preloader({ ready, onFinish }: PreloaderProps) {
  const [fade, setFade] = useState(false);

  useEffect(() => {
    if (!ready) return;

    const timer = setTimeout(() => setFade(true), 2200);
    const done = setTimeout(() => onFinish(), 2900);
    return () => {
      clearTimeout(timer);
      clearTimeout(done);
    };
  }, [onFinish, ready]);

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#0a0a0a] transition-opacity duration-700 ${
        fade ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <div className="flex flex-col items-center gap-6 animate-pulse-slow">
        {/* Logo mark */}
        <div className="relative">
          <BrandLogo variant="preloader" showWordmark={false} markClassName="w-24 h-24 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center overflow-hidden shadow-2xl shadow-amber-500/30" fallbackClassName="text-white font-black text-4xl tracking-tight" />
          <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 opacity-20 blur-lg animate-pulse" />
        </div>

        {/* Brand name */}
        <div className="text-center">
          <h1 className="text-white text-3xl font-black tracking-widest uppercase">
            Mr<span className="text-amber-400">Hustler</span>
          </h1>
          <p className="text-gray-400 text-sm tracking-[0.25em] uppercase mt-1">
            Earn. Grow. Thrive.
          </p>
        </div>

        {/* Progress bar */}
        <div className="w-48 h-[3px] bg-gray-800 rounded-full overflow-hidden mt-2">
          <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full animate-progress" />
        </div>
      </div>
    </div>
  );
}
