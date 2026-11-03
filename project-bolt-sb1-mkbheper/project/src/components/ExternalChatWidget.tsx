import { useEffect } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const WIDGET_KEY = 'support.live_chat.widget_code';

export default function ExternalChatWidget() {
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    const injectedNodes: Node[] = [];

    function openProviderChat() {
      const providerWindow = window as Window & {
        Tawk_API?: { maximize?: () => void; toggle?: () => void };
        Intercom?: (command: string) => void;
        $crisp?: { push: (command: unknown[]) => void };
      };
      if (providerWindow.Tawk_API?.maximize) {
        providerWindow.Tawk_API.maximize();
        return;
      }
      if (providerWindow.Tawk_API?.toggle) {
        providerWindow.Tawk_API.toggle();
        return;
      }
      if (providerWindow.Intercom) {
        providerWindow.Intercom('show');
        return;
      }
      if (providerWindow.$crisp) providerWindow.$crisp.push(['do', 'chat:open']);
    }

    async function loadWidget() {
      const { data } = await supabase.from('site_content').select('body').eq('content_key', WIDGET_KEY).maybeSingle();
      if (!active || !data?.body?.trim()) return;
      const parsed = document.createElement('template');
      parsed.innerHTML = data.body;
      Array.from(parsed.content.childNodes).forEach(node => {
        if (node.nodeName.toLowerCase() === 'script') {
          const source = node as HTMLScriptElement;
          const script = document.createElement('script');
          Array.from(source.attributes).forEach(attribute => script.setAttribute(attribute.name, attribute.value));
          script.text = source.text;
          document.body.appendChild(script);
          injectedNodes.push(script);
        } else {
          const clone = node.cloneNode(true);
          document.body.appendChild(clone);
          injectedNodes.push(clone);
        }
      });
    }

    window.addEventListener('mrhustler:open-external-chat', openProviderChat);
    void loadWidget();
    return () => {
      active = false;
      window.removeEventListener('mrhustler:open-external-chat', openProviderChat);
      injectedNodes.forEach(node => node.parentNode?.removeChild(node));
    };
  }, []);

  return null;
}
