import { mysqlApi } from '@/lib/mysqlApi';

export function publicImageUrl(path: string | null | undefined, bucket = 'site-media'): string | null {
  const value = path?.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:') return url.toString();
      if (typeof window === 'undefined' || window.location.protocol !== 'https:') return url.toString();
      url.protocol = 'https:';
      return url.toString();
    } catch {
      return null;
    }
  }

  if (value.startsWith('/') && !value.startsWith('//')) return value;
  return mysqlApi.storage.from(bucket).getPublicUrl(value).data.publicUrl;
}

export function imageContentType(path: string): string {
  return /\.svg(?:[?#]|$)/i.test(path) ? 'image/svg+xml' : 'image/png';
}
