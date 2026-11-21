import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import BrandLogo from '@/components/BrandLogo';

interface Props {
  label: string;
  amount: string;
  icon: LucideIcon;
  description?: string;
  action?: ReactNode;
  ariaLabel?: string;
}

export default function WalletBalanceCard({ label, amount, icon: Icon, description, action, ariaLabel }: Props) {
  return (
    <section
      className="hustler-wallet-card relative isolate overflow-hidden rounded-2xl border border-amber-300/60 bg-gradient-to-br from-[#21190c] via-[#17140f] to-[#10100f] p-3 shadow-[0_0_24px_-8px_rgba(249,115,22,0.7)] md:p-5"
      aria-label={ariaLabel ?? `${label} balance`}
    >
      <div className="relative z-10 grid min-h-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-1 text-left md:min-h-56 md:grid-cols-[minmax(0,1fr)_minmax(140px,.8fr)_auto] md:gap-4 md:py-2">
        <div className="min-w-0">
          <p className="hustler-wallet-title flex min-w-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-amber-300 md:gap-2 md:text-sm md:tracking-[0.12em]">
            <Icon size={18} className="shrink-0 md:h-[21px] md:w-[21px]" strokeWidth={2.5} />
            <span className="truncate">{label}</span>
          </p>
          <p className="mt-1 break-all text-2xl font-black leading-tight tracking-tight text-white md:mt-2 md:text-5xl md:leading-none xl:text-6xl">{amount}</p>
          {description && <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-gray-400 md:mt-3 md:text-xs md:leading-relaxed">{description}</p>}
        </div>
        <BrandLogo
          className="hustler-wallet-logo mx-auto hidden h-32 w-32 items-center justify-center md:flex md:h-40 md:w-40 xl:h-48 xl:w-48"
          showWordmark={false}
          showFallback={false}
        />
        {action ?? (
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-amber-200/30 bg-amber-300/10 text-amber-200 md:mx-0 md:h-12 md:w-12">
            <Icon size={21} />
          </div>
        )}
      </div>
    </section>
  );
}
