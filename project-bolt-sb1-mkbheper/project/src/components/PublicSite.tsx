import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import Hero from '@/components/Hero';
import PayoutTicker from '@/components/PayoutTicker';
import HowItWorks from '@/components/HowItWorks';
import Features from '@/components/Features';
import Referral from '@/components/Referral';
import Testimonials from '@/components/Testimonials';
import FAQ from '@/components/FAQ';
import About from '@/components/About';
import Footer from '@/components/Footer';

type AuthMode = 'login' | 'signup';

interface Props {
  onAuthRequest: (mode: AuthMode) => void;
}

function PublicLayout({ children, onAuthRequest }: { children: ReactNode; onAuthRequest: Props['onAuthRequest'] }) {
  return (
    <div className="min-h-screen transition-opacity duration-700 opacity-100">
      <Navbar onAuthRequest={onAuthRequest} />
      <main>{children}</main>
      <Footer />
    </div>
  );
}

export default function PublicSite({ onAuthRequest }: Props) {
  return (
    <PublicLayout onAuthRequest={onAuthRequest}>
      <Routes>
        <Route path="/" element={<><Hero /><PayoutTicker /><Testimonials /></>} />
        <Route path="/how-it-works" element={<HowItWorks />} />
        <Route path="/features" element={<Features />} />
        <Route path="/referral" element={<Referral />} />
        <Route path="/testimonials" element={<Testimonials />} />
        <Route path="/faq" element={<FAQ />} />
        <Route path="/about" element={<About />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </PublicLayout>
  );
}
