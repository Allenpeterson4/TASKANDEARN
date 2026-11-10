import {
  LayoutDashboard,
  ClipboardList,
  Users,
  User,
  HelpCircle,
  LogOut,
  X,
  Bell,
  Menu,
  Crown,
  WalletCards,
  History,
  Trophy,
} from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import BrandLogo from '@/components/BrandLogo';

export type DashTab =
  | 'overview'
  | 'tasks'
  | 'referral'
  | 'wallet'
  | 'leaderboard'
  | 'profile'
  | 'plans'
  | 'payment'
  | 'history'
  | 'support';

interface Props {
  active: DashTab;
  onChange: (t: DashTab) => void;
  fullName: string;
  avatarUrl: string | null;
  tier: string;
  onLogout: () => void;
  taskCount: number;
  showPlans: boolean;
  featureAccess: Record<string, boolean>;
  sideOpen: boolean;
  setSideOpen: (v: boolean) => void;
}

const navItems: { id: DashTab; icon: typeof LayoutDashboard; label: string }[] = [
  { id: 'overview',   icon: LayoutDashboard, label: 'Home' },
  { id: 'tasks',      icon: ClipboardList,   label: 'Hustles' },
  { id: 'history',    icon: History,         label: 'Hustle history' },
  { id: 'referral',   icon: Users,           label: 'Referrals' },
  { id: 'wallet',     icon: WalletCards,     label: 'Wallet' },
  { id: 'leaderboard', icon: Trophy,         label: 'Leaderboard' },
  { id: 'plans',      icon: Crown,           label: 'Plans' },
  { id: 'support',    icon: HelpCircle,      label: 'Support' },
  { id: 'profile',    icon: User,            label: 'Profile' },
];

const tierColors: Record<string, string> = {
  Bronze:   'text-amber-700 bg-amber-700/15 border-amber-700/30',
  Silver:   'text-gray-300 bg-gray-300/10 border-gray-300/25',
  Gold:     'text-amber-400 bg-amber-400/10 border-amber-400/25',
  Platinum: 'text-blue-400 bg-blue-400/10 border-blue-400/25',
};

export default function DashSidebar({
  active, onChange, fullName, avatarUrl, tier, onLogout, taskCount, showPlans, featureAccess, sideOpen, setSideOpen,
}: Props) {
  const initials = fullName
    ? fullName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : 'MH';

  const tc = tierColors[tier] ?? tierColors.Bronze;

  return (
    <>
      {/* Mobile overlay */}
      {sideOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSideOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full z-40 flex flex-col bg-[#0e0e0e] border-r border-white/6 w-64 transition-transform duration-300 ${
          sideOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Logo + close */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-white/6">
          <div className="flex items-center gap-3">
            <BrandLogo className="flex items-center gap-3" markClassName="h-9 w-9 overflow-hidden rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20" wordmarkClassName="text-white font-black text-lg" fallbackClassName="text-white font-black text-base" />
          </div>
          <button
            onClick={() => setSideOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/8 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* User info */}
        <div className="px-5 py-4 border-b border-white/6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400/30 to-orange-600/30 border border-amber-400/20 flex items-center justify-center flex-shrink-0">
              {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full rounded-[inherit] object-cover" /> : <span className="text-amber-400 font-bold text-sm">{initials}</span>}
            </div>
            <div className="min-w-0">
              <p className="text-white font-semibold text-sm truncate">{fullName || 'Hustler'}</p>
              <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-bold border ${tc}`}>
                {tier}
              </span>
            </div>
          </div>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <p className="text-gray-600 text-[10px] font-bold uppercase tracking-wider px-3 mb-3">Menu</p>
          <ul className="space-y-1">
            {navItems.filter(item => {
              if (item.id === 'plans' && !showPlans) return false;
              const featureKey = item.id === 'tasks' ? 'hustles' : item.id === 'referral' ? 'referrals' : item.id === 'leaderboard' ? 'leaderboard' : null;
              return !featureKey || featureAccess[featureKey] !== false;
            }).map(item => {
              const Icon = item.icon;
              const isActive = active === item.id;
              return (
                <li key={item.id}>
                  <button
                    onClick={() => { onChange(item.id); setSideOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${item.id === 'history' ? 'pl-9' : ''} ${
                      isActive
                        ? 'bg-amber-400/10 text-amber-400 border border-amber-400/15'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Icon size={17} className={isActive ? 'text-amber-400' : ''} />
                    {item.label}
                    {item.id === 'tasks' && taskCount > 0 && (
                      <span className="ml-auto bg-amber-400 text-black text-[10px] font-black px-1.5 py-0.5 rounded-full">
                        {taskCount}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Logout */}
        <div className="px-3 py-4 border-t border-white/6">
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-red-400 hover:bg-red-500/8 transition-all"
          >
            <LogOut size={17} />
            Sign Out (Logout)
          </button>
        </div>
      </aside>
    </>
  );
}

export function DashTopbar({
  onMenuClick,
  onNotif,
  tab,
}: {
  onMenuClick: () => void;
  onNotif: () => void;
  tab: DashTab;
}) {
  const labels: Record<DashTab, string> = {
    overview:   'Home',
    tasks:      'Hustles',
    referral:   'Referral Program',
    wallet:     'Wallet',
    leaderboard: 'Leaderboard',
    profile:    'My Profile',
    plans:      'Plans & Membership',
    payment:    'Payment Selection',
    history:    'Hustle history',
    support:    'Help & Support',
  };

  return (
    <header className="sticky top-0 z-20 bg-[#0a0a0a]/90 backdrop-blur-md border-b border-white/5 px-4 sm:px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/8 transition-colors"
        >
          <Menu size={20} />
        </button>
        <h1 className="text-white font-bold text-lg">{labels[tab]}</h1>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <button
          onClick={onNotif}
          className="relative p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/8 transition-colors"
        >
          <Bell size={18} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-amber-400 rounded-full" />
        </button>
      </div>
    </header>
  );
}
