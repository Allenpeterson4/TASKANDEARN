export interface AppUser {
  id: string;
  email: string;
  app_metadata: {
    role: 'member' | 'admin';
    mfa_required: boolean;
    mfa_verified?: boolean;
  };
}

interface ApiResponse<T> {
  data: T;
}

interface QueryFilter {
  column: string;
  operator: string;
  value: unknown;
}

const requestTimeoutMs = 20_000;
const dashboardRequestTimeoutMs = 30_000;

// Legacy data and RPC calls do not declare their response schemas yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DynamicResponse = any;

export interface DashboardFeaturePermission {
  feature_key: string;
  free_enabled: boolean;
  premium_enabled: boolean;
  settings: { allowed_plan_codes?: string[] } | null;
}

export interface DashboardCheckin {
  checkin_date: string;
  streak: number;
  reward: number;
}

export interface DashboardAnnouncement {
  title: string;
  message: string;
  enabled: boolean;
  welcome_bonus: number;
  require_social: boolean;
  social_links: { label: string; url: string }[];
}

export interface DashboardAdvertisement {
  image_path: string;
  target_url: string;
  enabled: boolean;
}

export interface DashboardCompletion {
  id: string;
  user_id: string;
  task_id: string;
  status: string;
  completed_at: string;
  reviewed_at: string | null;
}

export interface DashboardSettings {
  available_plan_codes: string[];
  current_plan_code: string;
  feature_permissions: DashboardFeaturePermission[];
}

export interface DashboardSnapshot extends DashboardSettings {
  profile: DynamicResponse | null;
  balance: DynamicResponse | null;
  tasks: DynamicResponse[];
  completions: DashboardCompletion[];
  referrals: DynamicResponse[];
  withdrawals: DynamicResponse[];
  funding_deposits: DynamicResponse[];
  withdrawal_settings: DynamicResponse | null;
  latest_checkin: DashboardCheckin | null;
  today_checkin: DashboardCheckin | null;
  activity: DynamicResponse[];
  announcement: DashboardAnnouncement | null;
  announcement_claimed: boolean;
  advertisement: DashboardAdvertisement | null;
}

async function request<T>(path: string, body?: unknown, retryNetworkFailure = false, timeoutMs = requestTimeoutMs): Promise<T> {
  const attempts = retryNetworkFailure ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`/api/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? `Request failed (${response.status}).`);
      return result as T;
    } catch (error) {
      const connectionReset = error instanceof TypeError;
      if (connectionReset && attempt + 1 < attempts) {
        await new Promise(resolve => window.setTimeout(resolve, 350));
        continue;
      }
      if (controller.signal.aborted) {
        throw new Error('The server connection timed out. Check the MySQL API hosting connection and try again.');
      }
      if (error instanceof TypeError) {
        throw new Error('Could not reach the MySQL API. Check the site connection and try again.');
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
  throw new Error('Could not reach the MySQL API. Check the site connection and try again.');
}

class DataQueryBuilder implements PromiseLike<{ data: DynamicResponse; error: Error | null; count?: number | null }> {
  private action = 'select';
  private columns = ['*'];
  private filters: QueryFilter[] = [];
  private orderings: Array<{ column: string; ascending: boolean }> = [];
  private limitValue = 1000;
  private offsetValue = 0;
  private cardinality = '';
  private countMode: string | undefined;
  private head = false;
  private returnRows = false;
  private values: unknown;

  constructor(private readonly table: string) {}

  select(columns = '*', options?: { count?: string; head?: boolean }) {
    if (this.action === 'select') this.columns = columns.split(',').map(column => column.trim()).filter(Boolean);
    else this.returnRows = true;
    this.countMode = options?.count;
    this.head = options?.head ?? false;
    return this;
  }

  eq(column: string, value: unknown) { return this.addFilter(column, 'eq', value); }
  neq(column: string, value: unknown) { return this.addFilter(column, 'neq', value); }
  gt(column: string, value: unknown) { return this.addFilter(column, 'gt', value); }
  gte(column: string, value: unknown) { return this.addFilter(column, 'gte', value); }
  lt(column: string, value: unknown) { return this.addFilter(column, 'lt', value); }
  lte(column: string, value: unknown) { return this.addFilter(column, 'lte', value); }
  is(column: string, value: unknown) { return this.addFilter(column, 'is', value); }
  in(column: string, value: unknown[]) { return this.addFilter(column, 'in', value); }
  not(column: string, operator: string, value: unknown) {
    if (operator !== 'is' || value !== null) throw new Error('Unsupported NOT filter.');
    return this.addFilter(column, 'not-is', value);
  }

  or(expression: string) {
    const match = /^([a-zA-Z_]\w*)\.is\.null,([a-zA-Z_]\w*)\.gt\.([0-9T:Z.+-]+)$/.exec(expression);
    if (!match || match[1] !== match[2]) throw new Error('Unsupported OR filter.');
    this.filters.push({ column: match[1], operator: 'or-null-gt', value: match[3] });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderings.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  range(from: number, to: number) {
    this.offsetValue = Math.max(0, from);
    this.limitValue = Math.max(0, to - from + 1);
    return this;
  }

  single() { this.cardinality = 'single'; return this; }
  maybeSingle() { this.cardinality = 'maybeSingle'; return this; }

  insert(values: unknown) { this.action = 'insert'; this.values = values; return this; }
  upsert(values: unknown, options?: { onConflict?: string; ignoreDuplicates?: boolean }) { void options; this.action = 'upsert'; this.values = values; return this; }
  update(values: unknown) { this.action = 'update'; this.values = values; return this; }
  delete() { this.action = 'delete'; return this; }

  then<TResult1 = { data: DynamicResponse; error: Error | null; count?: number | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: DynamicResponse; error: Error | null; count?: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const payload = {
      table: this.table,
      action: this.action,
      columns: this.columns,
      filters: this.filters,
      order: this.orderings,
      limit: this.limitValue,
      offset: this.offsetValue,
      cardinality: this.cardinality,
      count: this.countMode,
      head: this.head,
      returnRows: this.returnRows,
      values: this.values,
    };
    const retryNetworkFailure = this.action === 'select'
      || (this.table === 'profiles' && this.action === 'update');
    const result = request<{ data: DynamicResponse; count?: number | null }>('data', payload, retryNetworkFailure)
      .then(data => ({ ...data, error: null as Error | null }))
      .catch(error => ({ data: null, error: error instanceof Error ? error : new Error('Database request failed.') }));
    return result.then(onfulfilled, onrejected);
  }

  private addFilter(column: string, operator: string, value: unknown) {
    this.filters.push({ column, operator, value });
    return this;
  }
}

const authEvent = 'mrhustler:auth-change';

function notifyAuthChanged() {
  window.dispatchEvent(new Event(authEvent));
}

async function settled<T>(work: Promise<T>): Promise<{ data: T | null; error: Error | null }> {
  try {
    return { data: await work, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error : new Error('Backend request failed.') };
  }
}

export const mysqlApi = {
  dashboard: {
    load() {
      return settled(request<{ data: DashboardSnapshot }>('dashboard', undefined, true, dashboardRequestTimeoutMs).then(response => response.data));
    },
    settings() {
      return settled(request<{ data: DashboardSettings }>('dashboard/settings', undefined, true, dashboardRequestTimeoutMs).then(response => response.data));
    },
  },
  from(table: string) {
    return new DataQueryBuilder(table);
  },
  auth: {
    async getCurrentUser() {
      return this.getSession();
    },
    async getSession() {
      const { user } = await request<{ user: AppUser | null }>('auth/session', undefined, true);
      return user;
    },
    async signIn(email: string, password: string) {
      const { user } = await request<{ user: AppUser }>('auth/login', { email, password }, true);
      notifyAuthChanged();
      return user;
    },
    async signOut() {
      await request<{ ok: boolean }>('auth/logout', {}, true);
      notifyAuthChanged();
    },
    async signUp(input: { email: string; password: string; fullName: string; phone: string; referralCode: string }) {
      return request<{ ok: boolean; verification_required: boolean | null }>('auth/signup', input, true);
    },
    async requestPasswordReset(email: string) {
      return request<{ ok: boolean }>('auth/password-reset-request', { email });
    },
    async resetPassword(token: string, password: string) {
      return request<{ ok: boolean }>('auth/password-reset', { token, password });
    },
    async verifyEmail(token: string) {
      return request<{ ok: boolean }>('auth/verify-email', { token });
    },
    async changePassword(currentPassword: string, newPassword: string) {
      return request<{ ok: boolean }>('auth/password', { currentPassword, newPassword });
    },
    async mfaStatus() {
      return request<{ enabled: boolean; verified: boolean }>('auth/mfa');
    },
    async enrollMfa() {
      return request<{ secret: string; otpauth_uri: string }>('auth/mfa/enroll', {});
    },
    async verifyMfa(code: string) {
      const result = await request<{ ok: boolean }>('auth/mfa/verify', { code });
      notifyAuthChanged();
      return result;
    },
    async disableMfa() {
      const result = await request<{ ok: boolean }>('auth/mfa/disable', {});
      notifyAuthChanged();
      return result;
    },
    subscribe(callback: () => void) {
      window.addEventListener(authEvent, callback);
      return () => window.removeEventListener(authEvent, callback);
    },
  },
  rpc<T = DynamicResponse>(name: string, args?: Record<string, unknown>) {
    return settled(request<{ data: T }>(`rpc/${encodeURIComponent(name)}`, args ?? {}).then(result => result.data));
  },
  functions: {
    invoke<T = DynamicResponse>(name: string, options?: { body?: unknown }) {
      return settled(request<T>(`functions/${encodeURIComponent(name)}`, options?.body ?? {}));
    },
  },
  storage: {
    from(bucket: string) {
      return {
        getPublicUrl(path: string) {
          const query = new URLSearchParams({ bucket, path });
          return { data: { publicUrl: `/api/storage/public?${query.toString()}` } };
        },
        upload(path: string, file: File, options?: { contentType?: string; upsert?: boolean }) {
          const form = new FormData();
          form.set('bucket', bucket);
          form.set('path', path);
          form.set('upsert', options?.upsert ? '1' : '0');
          form.set('file', file, file.name);
          return settled((async () => {
            for (let attempt = 0; attempt < 2; attempt++) {
              const controller = new AbortController();
              const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs);
              try {
                const response = await fetch('/api/storage/upload', {
                  method: 'POST',
                  credentials: 'same-origin',
                  body: form,
                  signal: controller.signal,
                });
                const result = await response.json().catch(() => null) as { error?: string } | null;
                if (!response.ok) throw new Error(result?.error ?? `Upload failed (${response.status}).`);
                return result;
              } catch (error) {
                const networkFailure = controller.signal.aborted || error instanceof TypeError;
                if (networkFailure && attempt === 0) {
                  await new Promise(resolve => window.setTimeout(resolve, 350));
                  continue;
                }
                if (controller.signal.aborted) {
                  throw new Error('The upload connection timed out. Check the hosting connection and try again.');
                }
                if (error instanceof TypeError) {
                  throw new Error('Could not reach the upload service. Check the site connection and try again.');
                }
                throw error;
              } finally {
                window.clearTimeout(timeout);
              }
            }
            throw new Error('Could not reach the upload service. Check the site connection and try again.');
          })());
        },
        remove(paths: string[]) {
          return settled(request<{ removed: number }>('storage/remove', { bucket, paths }));
        },
        list(path = '', options?: { limit?: number; sortBy?: { column: string; order: 'asc' | 'desc' } }) {
          return settled(request<{ data: Array<{ name: string; created_at: string }> }>('storage/list', {
            bucket,
            path,
            limit: options?.limit,
            sortBy: options?.sortBy,
          }).then(result => result.data));
        },
        createSignedUrl(path: string, expiresIn = 120) {
          return settled(request<{ signedUrl: string }>('storage/signed-url', { bucket, path, expiresIn }));
        },
      };
    },
  },
};

export type { ApiResponse };
