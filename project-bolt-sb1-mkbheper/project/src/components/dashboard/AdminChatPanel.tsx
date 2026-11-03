import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, MessageCircle, Send, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Conversation = {
  id: string;
  user_id: string;
  status: 'open' | 'closed';
  updated_at: string;
};

type ChatMessage = {
  id: string;
  conversation_id: string;
  author_id: string;
  body: string;
  created_at: string;
};

type ProfileName = { user_id: string; full_name: string; username: string };

export default function AdminChatPanel() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [profiles, setProfiles] = useState<Map<string, ProfileName>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const refreshConversations = useCallback(async () => {
    const { data, error: loadError } = await supabase.from('support_conversations')
      .select('id, user_id, status, updated_at')
      .order('updated_at', { ascending: false })
      .limit(100);
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as Conversation[];
    setConversations(rows);
    if (!selectedId && rows.length) setSelectedId(rows[0].id);
    const userIds = [...new Set(rows.map(row => row.user_id))];
    if (userIds.length) {
      const { data: names } = await supabase.from('profiles').select('user_id, full_name, username').in('user_id', userIds);
      if (names) setProfiles(new Map((names as ProfileName[]).map(profile => [profile.user_id, profile])));
    }
    setLoading(false);
  }, [selectedId]);

  useEffect(() => {
    refreshConversations();
    const timer = window.setInterval(() => { void refreshConversations(); }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshConversations]);

  const loadMessages = useCallback(async () => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    const { data, error: loadError } = await supabase.from('support_messages')
      .select('id, conversation_id, author_id, body, created_at')
      .eq('conversation_id', selectedId)
      .order('created_at', { ascending: true });
    if (loadError) setError(loadError.message);
    else setMessages((data ?? []) as ChatMessage[]);
  }, [selectedId]);

  useEffect(() => {
    loadMessages();
    const timer = window.setInterval(() => { void loadMessages(); }, 4000);
    return () => window.clearInterval(timer);
  }, [loadMessages]);

  async function sendReply(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId || !draft.trim()) return;
    setSending(true);
    const { error: sendError } = await supabase.rpc('send_support_message', {
      p_conversation_id: selectedId,
      p_body: draft.trim(),
    });
    setSending(false);
    if (sendError) {
      setError(sendError.message);
      return;
    }
    setDraft('');
    await loadMessages();
    await refreshConversations();
  }

  async function closeConversation() {
    if (!selectedId) return;
    const { error: closeError } = await supabase.rpc('admin_close_support_conversation', {
      p_conversation_id: selectedId,
    });
    if (closeError) {
      setError(closeError.message);
      return;
    }
    setSelectedId(null);
    setMessages([]);
    await refreshConversations();
  }

  const selectedConversation = conversations.find(conversation => conversation.id === selectedId);

  return (
    <div className="grid min-h-[420px] gap-4 border border-white/10 bg-[#111] md:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="border-b border-white/10 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between border-b border-white/8 p-4">
          <h2 className="text-sm font-bold text-white">Support conversations</h2>
          <MessageCircle size={16} className="text-emerald-300" />
        </div>
        <div className="max-h-[520px] overflow-y-auto">
          {loading && <p className="p-4 text-xs text-gray-500"><Loader2 className="mr-2 inline animate-spin" size={13} /> Loading conversations</p>}
          {conversations.map(conversation => {
            const profile = profiles.get(conversation.user_id);
            return (
              <button key={conversation.id} onClick={() => setSelectedId(conversation.id)} className={`w-full border-b border-white/5 p-3 text-left ${selectedId === conversation.id ? 'bg-emerald-300/10' : 'hover:bg-white/5'}`}>
                <span className="flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold text-white">{profile?.full_name || profile?.username || conversation.user_id}</span><span className={`text-[10px] ${conversation.status === 'open' ? 'text-emerald-300' : 'text-gray-500'}`}>{conversation.status}</span></span>
                <span className="mt-1 block text-[10px] text-gray-500">Updated {new Date(conversation.updated_at).toLocaleString('en-NG')}</span>
              </button>
            );
          })}
          {!loading && conversations.length === 0 && <p className="p-4 text-xs text-gray-500">No support conversations yet.</p>}
        </div>
      </aside>

      <section className="flex min-h-[420px] flex-col">
        {error && <div role="alert" className="m-3 flex items-center justify-between gap-2 border border-red-400/20 bg-red-400/5 px-3 py-2 text-xs text-red-300">{error}<button onClick={() => setError('')} aria-label="Dismiss error"><X size={14} /></button></div>}
        {selectedConversation ? (
          <>
            <header className="flex items-center justify-between border-b border-white/8 p-4"><div><p className="text-sm font-bold text-white">{profiles.get(selectedConversation.user_id)?.full_name || profiles.get(selectedConversation.user_id)?.username || selectedConversation.user_id}</p><p className="text-[11px] text-gray-500">{selectedConversation.status}</p></div>{selectedConversation.status === 'open' && <button onClick={closeConversation} aria-label="Close conversation" className="flex items-center gap-1.5 rounded border border-white/10 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-white/5"><Check size={13} /> Resolve</button>}</header>
            <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
              {messages.map(message => {
                const isAdminMessage = profiles.has(message.author_id) && message.author_id !== selectedConversation.user_id;
                return <div key={message.id} className={`max-w-[85%] ${isAdminMessage ? 'ml-auto' : 'mr-auto'}`}><p className={`whitespace-pre-wrap break-words px-3 py-2 text-sm ${isAdminMessage ? 'bg-emerald-300 text-black' : 'bg-white/8 text-gray-200'}`}>{message.body}</p><time className="mt-1 block text-[10px] text-gray-500">{new Date(message.created_at).toLocaleString('en-NG')}</time></div>;
              })}
            </div>
            {selectedConversation.status === 'open' && <form onSubmit={sendReply} className="flex gap-2 border-t border-white/10 p-3"><input value={draft} onChange={event => setDraft(event.target.value)} maxLength={4000} placeholder="Reply to member" className="admin-input min-w-0 flex-1" /><button disabled={sending || !draft.trim()} aria-label="Send reply" className="flex h-10 w-10 items-center justify-center bg-emerald-300 text-black disabled:opacity-40"><Send size={15} /></button></form>}
          </>
        ) : <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-gray-500">Select an open support conversation to reply.</div>}
      </section>
      <style>{`.admin-input{border:1px solid rgba(255,255,255,.1);border-radius:.5rem;background:#0a0a0a;padding:.65rem .75rem;color:#fff;font-size:.875rem;outline:none}.admin-input:focus{border-color:rgba(110,231,183,.55)}`}</style>
    </div>
  );
}
