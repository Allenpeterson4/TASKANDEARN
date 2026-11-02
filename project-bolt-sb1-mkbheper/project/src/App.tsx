import { useState, useCallback } from 'react';
import Preloader from '@/components/Preloader';
import Navbar from '@/components/Navbar';
import Hero from '@/components/Hero';
import HowItWorks from '@/components/HowItWorks';
import Features from '@/components/Features';
import Referral from '@/components/Referral';
import Testimonials from '@/components/Testimonials';
import FAQ from '@/components/FAQ';
import About from '@/components/About';
import Footer from '@/components/Footer';

export default function App() {
  const [loaded, setLoaded] = useState(false);

  const handlePreloaderFinish = useCallback(() => setLoaded(true), []);

  return (
    <>
      {!loaded && <Preloader onFinish={handlePreloaderFinish} />}
      <div
        className={`transition-opacity duration-700 ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <Navbar />
        <main>
          <Hero />
          <HowItWorks />
          <Features />
          <Referral />
          <Testimonials />
          <FAQ />
          <About />
        </main>
        <Footer />
      </div>
    </>
  );
}
