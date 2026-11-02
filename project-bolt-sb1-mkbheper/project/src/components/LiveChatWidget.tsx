import { useEffect, useState } from 'react';
import { Loader2, MessageCircle, Send, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type ChatMessage = {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
};

interface Props {
  userId: string | null;
  onLoginRequired?: () => void;
}

export default function LiveChatWidget({ userId, onLoginRequired }: Props) {
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !userId) return;
    let active = true;

    async function syncConversation() {
      const { data: id, error: createError } = await supabase.rpc('create_support_conversation');
      if (createError) {
        if (active) setError(createError.message);
        return;
      }
      if (!active) return;
      setConversationId(id as string);
      const { data, error: messageError } = await supabase.from('support_messages')
        .select('id, author_id, body, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true });
      if (active) {
        if (messageError) setError(messageError.message);
        else setMessages((data ?? []) as ChatMessage[]);
        setLoading(false);
      }
    }

    setLoading(true);
    syncConversation();
    const timer = window.setInterval(syncConversation, 4000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [open, userId]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!conversationId || !draft.trim()) return;
    setSending(true);
    setError('');
    const { error: sendError } = await supabase.rpc('send_support_message', {
      p_conversation_id: conversationId,
      p_body: draft.trim(),
    });
    setSending(false);
    if (sendError) {
      setError(sendError.message);
      return;
    }
    setDraft('');
    const { data } = await supabase.from('support_messages')
      .select('id, author_id, body, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (data) setMessages(data as ChatMessage[]);
  }

  return (
    <div className="fixed bottom-5 right-5 z-[70]">
      {open && (
        <section className="mb-3 flex h-[min(520px,75vh)] w-[min(360px,calc(100vw-2rem))] flex-col border border-white/10 bg-[#111] shadow-2xl" aria-label="Live support chat">
          <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div><h2 className="text-sm font-bold text-white">Live support</h2><p className="text-[11px] text-gray-500">Usually replies within a few minutes</p></div>
            <button onClick={() => setOpen(false)} aria-label="Close live chat" className="p-2 text-gray-400 hover:text-white"><X size={16} /></button>
          </header>
          {!userId ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <MessageCircle size={28} className="text-amber-400" />
              <p className="text-sm text-gray-300">Sign in to start a private support conversation.</p>
              <button onClick={onLoginRequired} className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-black">Sign in</button>
            </div>
          ) : (
            <>
              <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
                {loading && messages.length === 0 && <p className="text-center text-xs text-gray-500"><Loader2 className="mr-1 inline animate-spin" size={13} /> Connecting to support</p>}
                {messages.map(message => {
                  const ownMessage = message.author_id === userId;
                  return (
                    <div key={message.id} className={`max-w-[85%] ${ownMessage ? 'ml-auto' : 'mr-auto'}`}>
                      <p className={`whitespace-pre-wrap break-words px-3 py-2 text-sm ${ownMessage ? 'bg-amber-400 text-black' : 'bg-white/8 text-gray-200'}`}>{message.body}</p>
                      <time className={`mt-1 block text-[10px] text-gray-500 ${ownMessage ? 'text-right' : ''}`}>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                    </div>
                  );
                })}
                {!loading && messages.length === 0 && <p className="py-8 text-center text-xs text-gray-500">Send a message to connect with our support team.</p>}
              </div>
              {error && <p role="alert" className="px-4 pb-2 text-xs text-red-300">{error}</p>}
              <form onSubmit={sendMessage} className="flex gap-2 border-t border-white/10 p-3">
                <input value={draft} onChange={event => setDraft(event.target.value)} maxLength={4000} placeholder="Write a message" className="min-w-0 flex-1 border border-white/10 bg-[#0a0a0a] px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50" />
                <button disabled={sending || !draft.trim()} aria-label="Send message" className="flex h-10 w-10 items-center justify-center bg-amber-400 text-black disabled:opacity-40"><Send size={15} /></button>
              </form>
            </>
          )}
        </section>
      )}
      <button onClick={() => setOpen(value => !value)} aria-label={open ? 'Close live support chat' : 'Open live support chat'} className="ml-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-400 text-black shadow-xl shadow-amber-500/20 transition-transform hover:scale-105">
        {open ? <X size={20} /> : <MessageCircle size={20} />}
      </button>
    </div>
  );
}
