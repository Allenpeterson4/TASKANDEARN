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
      role="status"
      aria-label="Loading"
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-[#0a0a0a] transition-opacity duration-700 ${
        fade ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <BrandLogo
        variant="preloader"
        showWordmark={false}
        showFallback={false}
        imageOnly
        className="preloader-logo h-32 w-32 animate-[spin_2.8s_linear_infinite] motion-reduce:animate-none"
        markClassName="h-full w-full"
      />
    </div>
  );
}
