import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('authorization');
  if (!url || !anonKey || !serviceRoleKey || !authorization) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: { user }, error: authError }, { data: isAdmin, error: roleError }] = await Promise.all([
    userClient.auth.getUser(),
    userClient.rpc('is_admin'),
  ]);
  if (authError || !user || roleError || isAdmin !== true) {
    return Response.json({ error: 'Admin access required' }, { status: 403, headers: corsHeaders });
  }

  let payload: { user_id?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400, headers: corsHeaders });
  }
  if (typeof payload.user_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.user_id)) {
    return Response.json({ error: 'A valid user ID is required' }, { status: 400, headers: corsHeaders });
  }

  const adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: account, error: accountError } = await adminClient.auth.admin.getUserById(payload.user_id);
  if (accountError || !account.user?.email) {
    return Response.json({ error: 'Account email is unavailable' }, { status: 404, headers: corsHeaders });
  }
  const { data: recovery, error: linkError } = await adminClient.auth.admin.generateLink({
    type: 'recovery',
    email: account.user.email,
  });
  if (linkError || !recovery.properties?.action_link) {
    console.error('Recovery link generation failed:', linkError?.message);
    return Response.json({ error: 'Could not generate recovery link' }, { status: 500, headers: corsHeaders });
  }

  return Response.json({ action_link: recovery.properties.action_link }, { headers: corsHeaders });
});
