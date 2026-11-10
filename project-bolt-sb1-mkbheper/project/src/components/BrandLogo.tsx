import { supabase } from '@/lib/supabase';
import { useSiteContent } from '@/hooks/useSiteContent';

type LogoVariant = 'site' | 'preloader';

interface Props {
  variant?: LogoVariant;
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
  fallbackClassName?: string;
  showWordmark?: boolean;
}

export default function BrandLogo({
  variant = 'site',
  className = '',
  markClassName = '',
  wordmarkClassName = '',
  fallbackClassName = '',
  showWordmark = true,
}: Props) {
  const contentKey = variant === 'preloader' ? 'branding.preloader_logo' : 'branding.site_logo';
  const content = useSiteContent([contentKey]);
  const path = content[contentKey];
  const imageUrl = path ? supabase.storage.from('site-media').getPublicUrl(path).data.publicUrl : null;

  return (
    <div className={className}>
      <div className={markClassName}>
        {imageUrl ? (
          <img src={imageUrl} alt={showWordmark ? '' : 'MrHustler logo'} className="h-full w-full object-contain" />
        ) : (
          <span className={fallbackClassName}>M</span>
        )}
      </div>
      {showWordmark && (
        <span className={wordmarkClassName}>
          Mr<span className="text-amber-400">Hustler</span>
        </span>
      )}
    </div>
  );
}
