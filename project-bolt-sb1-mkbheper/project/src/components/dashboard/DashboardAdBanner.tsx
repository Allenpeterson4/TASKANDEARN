import { useEffect, useState } from 'react';
import { mysqlApi } from '@/lib/platformTypes';

type Advertisement = { image_path: string; target_url: string; enabled: boolean };

export default function DashboardAdBanner() {
  const [advertisement, setAdvertisement] = useState<Advertisement | null>(null);

  useEffect(() => {
    let active = true;
    mysqlApi.from('dashboard_advertisements').select('image_path, target_url, enabled').eq('singleton', true).maybeSingle()
      .then(({ data }) => {
        if (active && data?.enabled && data.image_path && data.target_url) setAdvertisement(data as Advertisement);
      });
    return () => { active = false; };
  }, []);

  if (!advertisement) return null;
  const { data } = mysqlApi.storage.from('dashboard-ads').getPublicUrl(advertisement.image_path);
  return (
    <a href={advertisement.target_url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden border border-white/10" aria-label="Sponsored advertisement">
      <img src={data.publicUrl} alt="Sponsored" className="max-h-40 w-full object-cover" />
    </a>
  );
}
