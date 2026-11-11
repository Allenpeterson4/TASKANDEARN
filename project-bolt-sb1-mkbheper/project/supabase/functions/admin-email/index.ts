import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.10.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type SmtpSettings = {
  singleton: boolean;
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  from_email: string;
  from_name: string;
  password_ciphertext: string | null;
};

function encryptionKey() {
  const encoded = Deno.env.get('SMTP_CONFIG_ENCRYPTION_KEY');
  if (!encoded) throw new Error('SMTP_CONFIG_ENCRYPTION_KEY is not configured in Edge Function secrets.');
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  if (bytes.length !== 32) throw new Error('SMTP_CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function encodeBytes(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function decodeBytes(encoded: string) {
  return Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
}

async function encryptPassword(password: string) {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(password));
  return `${encodeBytes(iv)}.${encodeBytes(new Uint8Array(ciphertext))}`;
}

async function decryptPassword(ciphertext: string) {
  const [encodedIv, encodedValue] = ciphertext.split('.');
  if (!encodedIv || !encodedValue) throw new Error('Saved SMTP password is invalid.');
  const key = await encryptionKey();
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBytes(encodedIv) }, key, decodeBytes(encodedValue));
  return new TextDecoder().decode(plaintext);
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : 'Email operation failed.';
}

function replaceVariables(template: string, values: Record<string, unknown>) {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => String(values[key] ?? ''));
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function safeSecretMatch(expected: string, actual: string) {
  if (expected.length !== actual.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  return mismatch === 0;
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('authorization');
  const queueSecret = Deno.env.get('EMAIL_QUEUE_SECRET');
  const suppliedQueueSecret = request.headers.get('x-email-queue-secret') ?? '';
  const isScheduledWorker = Boolean(queueSecret && safeSecretMatch(queueSecret, suppliedQueueSecret));
  let adminUserId: string | null = null;
  let adminEmail: string | null = null;
  if (!url || !anonKey || !serviceRoleKey || (!authorization && !isScheduledWorker)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  if (!isScheduledWorker) {
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization! } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const [{ data: { user }, error: authError }, { data: isAdmin, error: roleError }] = await Promise.all([
      userClient.auth.getUser(),
      userClient.rpc('is_admin'),
    ]);
    if (authError || !user || roleError || isAdmin !== true) {
      return Response.json({ error: 'Admin access required' }, { status: 403, headers: corsHeaders });
    }
    adminUserId = user.id;
    adminEmail = user.email ?? null;
  }

  const adminClient = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400, headers: corsHeaders });
  }

  const action = body.action;
  if (isScheduledWorker && action !== 'process_queue') {
    return Response.json({ error: 'Scheduled worker may only process the email queue.' }, { status: 403, headers: corsHeaders });
  }
  const { data: currentSettings, error: settingsError } = await adminClient.from('email_smtp_settings')
    .select('*').eq('singleton', true).maybeSingle();
  if (settingsError) return Response.json({ error: settingsError.message }, { status: 500, headers: corsHeaders });

  if (action === 'get_settings') {
    const settings = currentSettings as SmtpSettings | null;
    return Response.json({ settings: settings ? {
      enabled: settings.enabled,
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      username: settings.username,
      from_email: settings.from_email,
      from_name: settings.from_name,
      password_configured: Boolean(settings.password_ciphertext),
    } : null }, { headers: corsHeaders });
  }

  if (action === 'save_settings') {
    const settings = body.settings as Record<string, unknown> | undefined;
    if (!settings || typeof settings.host !== 'string' || typeof settings.from_email !== 'string'
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.from_email)
      || !Number.isInteger(Number(settings.port)) || Number(settings.port) < 1 || Number(settings.port) > 65535) {
      return Response.json({ error: 'Enter a valid SMTP host, port, and sender email.' }, { status: 400, headers: corsHeaders });
    }
    let passwordCiphertext = (currentSettings as SmtpSettings | null)?.password_ciphertext ?? null;
    if (typeof body.password === 'string' && body.password.length > 0) {
      try {
        passwordCiphertext = await encryptPassword(body.password);
      } catch (error) {
        return Response.json({ error: safeError(error) }, { status: 503, headers: corsHeaders });
      }
    }
    const { error } = await adminClient.from('email_smtp_settings').upsert({
      singleton: true,
      enabled: settings.enabled === true,
      host: settings.host.trim(),
      port: Number(settings.port),
      secure: settings.secure === true,
      username: typeof settings.username === 'string' ? settings.username.trim() : '',
      from_email: settings.from_email.trim(),
      from_name: typeof settings.from_name === 'string' ? settings.from_name.trim().slice(0, 120) : 'MrHustler',
      password_ciphertext: passwordCiphertext,
      updated_by: adminUserId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'singleton' });
    if (error) return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
    return Response.json({ saved: true, password_configured: Boolean(passwordCiphertext) }, { headers: corsHeaders });
  }

  const settings = currentSettings as SmtpSettings | null;
  if (!settings?.host || !settings.password_ciphertext) {
    return Response.json({ error: 'Configure SMTP host and password before sending email.' }, { status: 400, headers: corsHeaders });
  }

  let password: string;
  try {
    password = await decryptPassword(settings.password_ciphertext);
  } catch (error) {
    return Response.json({ error: safeError(error) }, { status: 503, headers: corsHeaders });
  }
  const transporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: settings.username ? { user: settings.username, pass: password } : undefined,
  });

  if (action === 'test') {
    if (!adminEmail) return Response.json({ error: 'Your admin account has no email address.' }, { status: 400, headers: corsHeaders });
    try {
      await transporter.sendMail({
        from: { name: settings.from_name, address: settings.from_email },
        to: adminEmail,
        subject: 'MrHustler SMTP test',
        text: 'SMTP is configured correctly for MrHustler email notifications.',
      });
      return Response.json({ sent: true, recipient: adminEmail }, { headers: corsHeaders });
    } catch (error) {
      console.error('SMTP test failed:', safeError(error));
      return Response.json({ error: 'SMTP test failed. Check the server logs and SMTP settings.' }, { status: 502, headers: corsHeaders });
    }
  }

  if (action !== 'process_queue') return Response.json({ error: 'Unknown action' }, { status: 400, headers: corsHeaders });
  if (!settings.enabled) return Response.json({ error: 'Email notifications are disabled.' }, { status: 400, headers: corsHeaders });

  const [{ data: queueRows, error: queueError }, { data: templates, error: templatesError }] = await Promise.all([
    adminClient.from('email_notification_queue').select('*').in('status', ['pending', 'failed']).lt('attempts', 5).order('created_at').limit(25),
    adminClient.from('email_notification_templates').select('*'),
  ]);
  if (queueError || templatesError) return Response.json({ error: (queueError ?? templatesError)?.message }, { status: 500, headers: corsHeaders });
  const templateByKey = new Map((templates ?? []).map(template => [template.event_key, template]));
  const result = { sent: 0, failed: 0, skipped: 0 };

  for (const queued of queueRows ?? []) {
    const template = templateByKey.get(queued.event_key);
    if (!template || !template.enabled || !queued.user_id) {
      await adminClient.from('email_notification_queue').update({ status: 'skipped', last_error: 'Missing/disabled template or user.' }).eq('id', queued.id);
      result.skipped += 1;
      continue;
    }
    const { data: account, error: accountError } = await adminClient.auth.admin.getUserById(queued.user_id);
    if (accountError || !account.user?.email) {
      await adminClient.from('email_notification_queue').update({ status: 'failed', attempts: queued.attempts + 1, last_error: 'User email unavailable.' }).eq('id', queued.id);
      result.failed += 1;
      continue;
    }
    const { data: profile } = await adminClient.from('profiles').select('full_name, username').eq('user_id', queued.user_id).maybeSingle();
    const firstName = (profile?.full_name || profile?.username || 'Hustler').split(' ')[0];
    const values = { ...(queued.payload as Record<string, unknown>), first_name: firstName, email: account.user.email };
    const subject = replaceVariables(template.subject_template, values);
    const text = replaceVariables(template.body_template, values);
    const html = escapeHtml(text).replace(/\n/g, '<br>');
    await adminClient.from('email_notification_queue').update({ status: 'processing', attempts: queued.attempts + 1, last_error: null }).eq('id', queued.id);
    try {
      await transporter.sendMail({ from: { name: settings.from_name, address: settings.from_email }, to: account.user.email, subject, text, html });
      await adminClient.from('email_notification_queue').update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null }).eq('id', queued.id);
      result.sent += 1;
    } catch (error) {
      await adminClient.from('email_notification_queue').update({ status: 'failed', last_error: safeError(error) }).eq('id', queued.id);
      result.failed += 1;
    }
  }

  return Response.json(result, { headers: corsHeaders });
});