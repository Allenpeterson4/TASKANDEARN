import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.10.1';
import { decryptSmtpPassword } from '../_shared/smtp.ts';

type SmtpSettings = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  from_email: string;
  from_name: string;
  password_ciphertext: string | null;
};

function headers(request: Request) {
  return {
    'Access-Control-Allow-Origin': request.headers.get('origin') ?? '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function respond(request: Request, body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: headers(request) });
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : 'Email operation failed.';
}

async function hmac(value: string, key: string) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function validateOrigin(value: string | null) {
  if (!value) return null;
  try {
    const origin = new URL(value);
    const localHttp = origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname);
    if (origin.origin !== value || (origin.protocol !== 'https:' && !localHttp)) return null;
    return origin.origin;
  } catch {
    return null;
  }
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: headers(request) });
  if (request.method !== 'POST') return respond(request, { error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return respond(request, { error: 'Account email service is not configured.' }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return respond(request, { error: 'Invalid request body.' }, 400);
  }

  const action = body.action;
  if (action !== 'signup' && action !== 'password_reset') {
    return respond(request, { error: 'Unknown email action.' }, 400);
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return respond(request, { error: 'Enter a valid email address.' }, 400);
  }

  const siteOrigin = validateOrigin(request.headers.get('origin'));
  if (!siteOrigin) {
    return respond(request, { error: 'The current site origin is invalid. Use the platform’s HTTPS domain.' }, 400);
  }

  const fullName = typeof body.fullName === 'string' ? body.fullName.trim().slice(0, 120) : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim().slice(0, 30) : '';
  const referralCode = typeof body.referralCode === 'string' ? body.referralCode.trim().slice(0, 20) : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (action === 'signup' && (password.length < 6 || password.length > 72)) {
    return respond(request, { error: 'Password must be between 6 and 72 characters.' }, 400);
  }

  const sourceIp = request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-real-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0].trim();
  if (!sourceIp) return respond(request, { error: 'Could not verify the request source.' }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const [{ data: settingsData, error: settingsError }] = await Promise.all([
    admin.from('email_smtp_settings').select('enabled, host, port, secure, username, from_email, from_name, password_ciphertext').eq('singleton', true).maybeSingle(),
  ]);
  if (settingsError) {
    console.error('Could not load SMTP settings:', safeError(settingsError));
    return respond(request, { error: 'Account email service is temporarily unavailable.' }, 503);
  }
  const settings = settingsData as SmtpSettings | null;
  if (!settings?.enabled || !settings.host || !settings.from_email || !settings.password_ciphertext) {
    return respond(request, { error: 'Account email delivery is not configured. Contact the platform administrator.' }, 503);
  }

  let passwordForSmtp: string;
  try {
    passwordForSmtp = await decryptSmtpPassword(settings.password_ciphertext);
  } catch (error) {
    console.error('Could not decrypt SMTP password:', safeError(error));
    return respond(request, { error: 'Account email service is temporarily unavailable.' }, 503);
  }

  const [emailHash, ipHash] = await Promise.all([
    hmac(`email:${action}:${email}`, serviceRoleKey),
    hmac(`ip:${sourceIp}`, serviceRoleKey),
  ]);
  const { data: allowed, error: rateLimitError } = await admin.rpc('consume_auth_email_rate_limit', {
    p_email_hash: emailHash,
    p_ip_hash: ipHash,
    p_purpose: action,
  });
  if (rateLimitError) {
    console.error('Could not check account email rate limit:', safeError(rateLimitError));
    return respond(request, { error: 'Account email service is temporarily unavailable.' }, 503);
  }
  if (allowed !== true) return respond(request, { error: 'Too many email requests. Please try again later.' }, 429);

  let link: string;
  if (action === 'signup') {
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'signup',
      email,
      password,
      options: {
        data: { full_name: fullName, phone, referral_code: referralCode },
        redirectTo: `${siteOrigin}/`,
      },
    });
    if (error) {
      if (/already registered|already exists|user exists/i.test(error.message)) {
        return respond(request, { sent: true });
      }
      console.error('Could not generate signup confirmation link:', safeError(error));
      return respond(request, { error: 'Could not prepare the confirmation email. Please try again.' }, 502);
    }
    link = data.properties.action_link;
  } else {
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${siteOrigin}/?reset-password=1` },
    });
    if (error) {
      if (/user not found|no user|does not exist/i.test(error.message)) return respond(request, { sent: true });
      console.error('Could not generate password reset link:', safeError(error));
      return respond(request, { error: 'Could not prepare the password reset email. Please try again.' }, 502);
    }
    link = data.properties.action_link;
  }

  const transporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure || settings.port === 465,
    auth: settings.username ? { user: settings.username, pass: passwordForSmtp } : undefined,
  });
  const isSignup = action === 'signup';
  const subject = isSignup ? 'Confirm your MrHustler account' : 'Reset your MrHustler password';
  const greeting = fullName ? `Hi ${fullName},` : 'Hello,';
  const instruction = isSignup
    ? 'Confirm your email address to activate your MrHustler account.'
    : 'We received a request to reset your MrHustler password.';
  const text = `${greeting}\n\n${instruction}\n\nUse this secure link:\n${link}\n\nIf you did not request this, you can ignore this email.`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#171717"><h2 style="color:#b45309">MrHustler</h2><p>${escapeHtml(greeting)}</p><p>${escapeHtml(instruction)}</p><p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 18px;background:#f59e0b;color:#111;text-decoration:none;font-weight:bold">${isSignup ? 'Confirm email' : 'Reset password'}</a></p><p>If the button does not work, copy this link into your browser:</p><p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p><p>If you did not request this, you can ignore this email.</p></div>`;

  try {
    await transporter.sendMail({
      from: { name: settings.from_name || 'MrHustler', address: settings.from_email },
      to: email,
      subject,
      text,
      html,
    });
  } catch (error) {
    console.error('Could not send account email:', safeError(error));
    return respond(request, { error: 'Could not send the email. Please try again later.' }, 502);
  }

  return respond(request, { sent: true });
});
