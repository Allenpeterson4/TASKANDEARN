import type { DashboardAdvertisement } from '@/lib/mysqlApi';
import { publicImageUrl } from '@/lib/publicImageUrl';

export default function DashboardAdBanner({ advertisement }: { advertisement: DashboardAdvertisement | null }) {
  if (!advertisement) return null;
  const imageUrl = publicImageUrl(advertisement.image_path, 'dashboard-ads');
  if (!imageUrl) return null;
  return (
    <a href={advertisement.target_url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden border border-white/10" aria-label="Sponsored advertisement">
      <img src={imageUrl} alt="Sponsored" className="max-h-40 w-full object-cover" />
    </a>
  );
}
