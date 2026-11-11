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
  showFallback?: boolean;
  imageOnly?: boolean;
}

export default function BrandLogo({
  variant = 'site',
  className = '',
  markClassName = '',
  wordmarkClassName = '',
  fallbackClassName = '',
  showWordmark = true,
  showFallback = true,
  imageOnly = false,
}: Props) {
  const contentKey = variant === 'preloader' ? 'branding.preloader_logo' : 'branding.site_logo';
  const content = useSiteContent(variant === 'preloader' ? [contentKey, 'branding.site_logo', 'branding.logo'] : [contentKey, 'branding.logo']);
  const path = (variant === 'preloader'
    ? [content[contentKey], content['branding.site_logo'], content['branding.logo']]
    : [content[contentKey], content['branding.logo']]
  ).find(value => value && !/^https?:\/\//i.test(value)) ?? '';
  const imageUrl = path ? supabase.storage.from('site-media').getPublicUrl(path).data.publicUrl : null;
  const image = imageUrl ? <img src={imageUrl} alt="MrHustler logo" loading="eager" fetchPriority="high" className="h-full w-full object-contain" /> : null;

  return (
    <div className={className}>
      {imageOnly ? image ?? (showFallback ? <span className={fallbackClassName}>M</span> : null) : <>
        <div className={markClassName}>
          {image ?? (showFallback ? <span className={fallbackClassName}>M</span> : null)}
        </div>
        {showWordmark && (
          <span className={wordmarkClassName}>
            Mr<span className="text-amber-400">Hustler</span>
          </span>
        )}
      </>}
    </div>
  );
}
