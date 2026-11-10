import { ArrowRight, Twitter, Instagram, Facebook, Youtube } from 'lucide-react';
import { Link } from 'react-router-dom';
import BrandLogo from '@/components/BrandLogo';

const footerLinks = {
  Platform: ['How It Works', 'Features', 'Referral Program', 'Testimonials', 'Pricing'],
  Support: ['Help Center', 'Contact Us', 'WhatsApp Support', 'Report an Issue', 'Status Page'],
  Legal: ['Terms of Service', 'Privacy Policy', 'Cookie Policy', 'Disclaimer'],
  Company: ['About Us', 'Blog', 'Press Kit', 'Careers', 'Partners'],
};

const socials = [
  { icon: Twitter, label: 'Twitter' },
  { icon: Instagram, label: 'Instagram' },
  { icon: Facebook, label: 'Facebook' },
  { icon: Youtube, label: 'YouTube' },
];

const sectionRoutes: Record<string, string> = {
  'How It Works': '/how-it-works',
  Features: '/features',
  'Referral Program': '/referral',
  Testimonials: '/testimonials',
  'About Us': '/about',
};

export default function Footer() {
  return (
    <footer className="bg-[#080808] border-t border-white/5">
      {/* CTA Banner */}
      <div className="border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <div className="bg-gradient-to-r from-amber-400/8 via-orange-500/5 to-amber-400/8 border border-amber-400/12 rounded-3xl p-10 lg:p-14 text-center">
            <h2 className="text-3xl sm:text-4xl font-black text-white mb-3">
              Your Next Earning Starts
              <span className="text-amber-400"> Today</span>
            </h2>
            <p className="text-gray-400 text-base mb-8 max-w-lg mx-auto">
              Thousands of Nigerians are already hustling smarter. Join the
              movement and unlock your true earning potential.
            </p>
            <div className="flex flex-wrap gap-4 justify-center">
              <Link
                to="/how-it-works"
                className="group inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-black font-bold text-base hover:shadow-2xl hover:shadow-amber-500/30 hover:-translate-y-1 transition-all duration-300"
              >
                Create Free Account
                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link
                to="/referral"
                className="px-8 py-4 rounded-2xl border border-white/10 text-white font-semibold text-base hover:bg-white/5 hover:border-white/20 transition-all duration-300"
              >
                Learn About Referrals
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Main footer */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid lg:grid-cols-5 gap-12 mb-12">
          {/* Brand col */}
          <div className="lg:col-span-1">
            <BrandLogo className="mb-4 flex items-center gap-3" markClassName="h-10 w-10 overflow-hidden rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center" wordmarkClassName="text-white font-black text-xl" fallbackClassName="text-white font-black text-xl" />
            <p className="text-gray-400 text-sm leading-relaxed mb-6">
              Nigeria's most trusted platform for earning real Naira through
              simple online hustles and referrals.
            </p>
            {/* Socials */}
            <div className="flex gap-2">
              {socials.map(({ icon: Icon, label }) => (
                <button
                  key={label}
                  aria-label={label}
                  className="w-9 h-9 rounded-lg bg-white/5 hover:bg-amber-400/15 text-gray-400 hover:text-amber-400 flex items-center justify-center transition-all"
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([heading, links]) => (
            <div key={heading}>
              <h4 className="text-white font-bold text-sm mb-5">{heading}</h4>
              <ul className="space-y-3">
                {links.map(link => (
                  <li key={link}>
                    {sectionRoutes[link] ? (
                      <Link to={sectionRoutes[link]} className="text-gray-400 hover:text-white text-sm transition-colors">{link}</Link>
                    ) : (
                      <a href="#" className="text-gray-400 hover:text-white text-sm transition-colors">{link}</a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-8 border-t border-white/5">
          <p className="text-gray-500 text-sm">
            © {new Date().getFullYear()} MrHustler. All rights reserved. Proudly Nigerian 🇳🇬
          </p>
          <div className="flex gap-6">
            {['Terms', 'Privacy', 'Cookies'].map(item => (
              <a key={item} href="#" className="text-gray-500 hover:text-gray-300 text-sm transition-colors">
                {item}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
