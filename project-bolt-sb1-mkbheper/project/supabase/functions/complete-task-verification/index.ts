import { createClient } from 'npm:@supabase/supabase-js@2';

function equalSignature(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function signBody(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(signature)].map(value => value.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async request => {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const verificationSecret = Deno.env.get('TASK_VERIFICATION_SECRET');
  if (!url || !serviceRoleKey || !verificationSecret) {
    return Response.json({ error: 'Task verification callback is not configured' }, { status: 503 });
  }

  const rawBody = await request.text();
  const providedSignature = request.headers.get('x-task-verification-signature') ?? '';
  const expectedSignature = await signBody(verificationSecret, rawBody);
  if (!equalSignature(providedSignature, expectedSignature)) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: { tracking_id?: unknown; provider_reference?: unknown };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }
  if (typeof payload.tracking_id !== 'string' || payload.tracking_id.length > 80) {
    return Response.json({ error: 'A valid tracking_id is required' }, { status: 400 });
  }
  if (payload.provider_reference !== undefined
    && (typeof payload.provider_reference !== 'string' || payload.provider_reference.length > 200)) {
    return Response.json({ error: 'Invalid provider reference' }, { status: 400 });
  }

  const serviceClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: completionId, error } = await serviceClient.rpc('complete_verified_task_session', {
    p_session_id: payload.tracking_id,
    p_provider_reference: typeof payload.provider_reference === 'string' ? payload.provider_reference : null,
  });
  if (error) {
    console.error('Task verification rejected:', error.message);
    return Response.json({ error: 'Verification was rejected' }, { status: 409 });
  }

  return Response.json({ verified: true, completion_id: completionId });
});
