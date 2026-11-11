import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Loader2, MessageCircle, Send, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Conversation = {
  id: string;
  user_id: string;
  subject: string;
  status: 'open' | 'closed';
  created_at: string;
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const refreshConversations = useCallback(async () => {
    let query = supabase.from('support_conversations')
      .select('id, user_id, subject, status, created_at, updated_at', { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(page * 50, page * 50 + 49);
    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    const { data, error: loadError, count } = await query;
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as Conversation[];
    setConversations(rows);
    setTotalCount(count ?? 0);
    if (!selectedId && rows.length) setSelectedId(rows[0].id);
    const userIds = [...new Set(rows.map(row => row.user_id))];
    if (userIds.length) {
      const { data: names } = await supabase.from('profiles').select('user_id, full_name, username').in('user_id', userIds);
      if (names) setProfiles(new Map((names as ProfileName[]).map(profile => [profile.user_id, profile])));
    }
    setLoading(false);
  }, [page, selectedId, statusFilter]);

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

  async function setConversationStatus(status: Conversation['status']) {
    if (!selectedId) return;
    const { error: closeError } = await supabase.rpc('admin_set_support_ticket_status', {
      p_conversation_id: selectedId,
      p_status: status,
    });
    if (closeError) {
      setError(closeError.message);
      return;
    }
    await refreshConversations();
  }

  const selectedConversation = conversations.find(conversation => conversation.id === selectedId);

  return (
    <div className="grid min-h-[420px] gap-4 border border-white/10 bg-[#111] md:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="border-b border-white/10 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between border-b border-white/8 p-4">
          <h2 className="text-sm font-bold text-white">Support tickets</h2>
          <MessageCircle size={16} className="text-emerald-300" />
        </div>
        <label className="block border-b border-white/8 p-3 text-[10px] text-gray-500">Ticket status<select value={statusFilter} onChange={event => { setStatusFilter(event.target.value as typeof statusFilter); setPage(0); setSelectedId(null); }} className="admin-input mt-1"><option value="all">All tickets</option><option value="open">Open</option><option value="closed">Closed</option></select></label>
        <div className="max-h-[520px] overflow-y-auto">
          {loading && <p className="p-4 text-xs text-gray-500"><Loader2 className="mr-2 inline animate-spin" size={13} /> Loading conversations</p>}
          {conversations.map(conversation => {
            const profile = profiles.get(conversation.user_id);
            return (
              <button key={conversation.id} onClick={() => setSelectedId(conversation.id)} className={`w-full border-b border-white/5 p-3 text-left ${selectedId === conversation.id ? 'bg-emerald-300/10' : 'hover:bg-white/5'}`}>
                <span className="flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold text-white">{conversation.subject || 'Support request'}</span><span className={`text-[10px] ${conversation.status === 'open' ? 'text-emerald-300' : 'text-gray-500'}`}>{conversation.status}</span></span>
                <span className="mt-1 block truncate text-[10px] text-gray-400">{profile?.full_name || profile?.username || conversation.user_id}</span>
                <span className="mt-1 block text-[10px] text-gray-500">Submitted {new Date(conversation.created_at).toLocaleString('en-NG')}</span>
              </button>
            );
          })}
          {!loading && conversations.length === 0 && <p className="p-4 text-xs text-gray-500">No support tickets found.</p>}
        </div>
        <div className="flex items-center justify-between border-t border-white/8 p-2 text-[10px] text-gray-500"><span>{totalCount ? `${page * 50 + 1}-${Math.min(page * 50 + conversations.length, totalCount)} of ${totalCount}` : '0 tickets'}</span><div className="flex gap-1"><button type="button" aria-label="Previous tickets" disabled={page === 0} onClick={() => { setPage(current => current - 1); setSelectedId(null); }} className="p-1 text-gray-300 disabled:opacity-30"><ChevronLeft size={15} /></button><button type="button" aria-label="Next tickets" disabled={(page + 1) * 50 >= totalCount} onClick={() => { setPage(current => current + 1); setSelectedId(null); }} className="p-1 text-gray-300 disabled:opacity-30"><ChevronRight size={15} /></button></div></div>
      </aside>

      <section className="flex min-h-[420px] flex-col">
        {error && <div role="alert" className="m-3 flex items-center justify-between gap-2 border border-red-400/20 bg-red-400/5 px-3 py-2 text-xs text-red-300">{error}<button onClick={() => setError('')} aria-label="Dismiss error"><X size={14} /></button></div>}
        {selectedConversation ? (
          <>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 p-4"><div><p className="text-[10px] font-bold uppercase text-emerald-300">{selectedConversation.status} ticket</p><h3 className="mt-1 text-sm font-bold text-white">{selectedConversation.subject || 'Support request'}</h3><p className="text-[11px] text-gray-500">{profiles.get(selectedConversation.user_id)?.full_name || profiles.get(selectedConversation.user_id)?.username || selectedConversation.user_id} · Submitted {new Date(selectedConversation.created_at).toLocaleString('en-NG')}</p></div><button onClick={() => void setConversationStatus(selectedConversation.status === 'open' ? 'closed' : 'open')} className="flex items-center gap-1.5 rounded border border-white/10 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-white/5">{selectedConversation.status === 'open' ? <><Check size={13} /> Close ticket</> : 'Reopen ticket'}</button></header>
            <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
              {messages.map(message => {
                const isAdminMessage = message.author_id !== selectedConversation.user_id;
                return <div key={message.id} className={`max-w-[85%] ${isAdminMessage ? 'ml-auto' : 'mr-auto'}`}><p className={`whitespace-pre-wrap break-words px-3 py-2 text-sm ${isAdminMessage ? 'bg-emerald-300 text-black' : 'bg-white/8 text-gray-200'}`}>{message.body}</p><time className="mt-1 block text-[10px] text-gray-500">{new Date(message.created_at).toLocaleString('en-NG')}</time></div>;
              })}
            </div>
            {selectedConversation.status === 'open' && <form onSubmit={sendReply} className="flex gap-2 border-t border-white/10 p-3"><input value={draft} onChange={event => setDraft(event.target.value)} maxLength={4000} placeholder="Reply to hustler" className="admin-input min-w-0 flex-1" /><button disabled={sending || !draft.trim()} aria-label="Send reply" className="flex h-10 w-10 items-center justify-center bg-emerald-300 text-black disabled:opacity-40"><Send size={15} /></button></form>}
          </>
        ) : <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-gray-500">Select a ticket to review or reply.</div>}
      </section>
      <style>{`.admin-input{border:1px solid rgba(255,255,255,.1);border-radius:.5rem;background:#0a0a0a;padding:.65rem .75rem;color:#fff;font-size:.875rem;outline:none}.admin-input:focus{border-color:rgba(110,231,183,.55)}`}</style>
    </div>
  );
}
