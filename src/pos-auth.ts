import { createClient } from '@supabase/supabase-js';
import type { AuthChangeEvent, RealtimeChannel, Session, SupabaseClient } from '@supabase/supabase-js';
import type { PosProfile, UserRole } from './pos-types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || '';
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || '';

export const isCloudConfigured = Boolean(supabaseUrl && publishableKey);
export const supabase: SupabaseClient | null = isCloudConfigured
  ? createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

function client() {
  if (!supabase) throw new Error('supabase is not connected');
  return supabase;
}

const redirectUrl = () => new URL(location.pathname || '/', location.origin).href;

export async function getSession() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function sendSignInLink(email: string) {
  const { error } = await client().auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: redirectUrl(), shouldCreateUser: false },
  });
  if (error) throw error;
}

export async function signInWithPassword(email: string, password: string) {
  const { error } = await client().auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
}

export async function changePassword(password: string) {
  const { error } = await client().auth.updateUser({
    password,
    data: { must_change_password: false },
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await client().auth.signOut();
  if (error) throw error;
}

export async function getCurrentProfile(): Promise<PosProfile | null> {
  if (!supabase) return null;
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, business_id, email, display_name, role, active, created_at')
    .eq('id', userData.user.id)
    .single();
  if (error) throw error;
  return {
    id: data.id,
    businessId: data.business_id,
    email: data.email,
    displayName: data.display_name,
    role: data.role,
    active: data.active,
    createdAt: data.created_at,
  } as PosProfile;
}

export async function getBusinessProfiles(): Promise<PosProfile[]> {
  const { data, error } = await client()
    .from('profiles')
    .select('id, business_id, email, display_name, role, active, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map((profile) => ({
    id: profile.id,
    businessId: profile.business_id,
    email: profile.email,
    displayName: profile.display_name,
    role: profile.role,
    active: profile.active,
    createdAt: profile.created_at,
  } as PosProfile));
}

export async function createTeamAccount(email: string, displayName: string, temporaryPassword: string, role: UserRole) {
  const { data, error } = await client().functions.invoke('invite-staff', {
    body: {
      action: 'create',
      email: email.trim().toLowerCase(),
      displayName: displayName.trim(),
      temporaryPassword,
      role,
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  if (data?.role !== role) throw new Error('account role service needs updating in supabase');
  return data as { id?: string; email: string };
}

export async function updateTeamMemberRole(userId: string, role: UserRole) {
  const { data, error } = await client().functions.invoke('invite-staff', {
    body: { action: 'update-role', userId, role },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  if (data?.role !== role) throw new Error('account role service needs updating in supabase');
  return data as { id: string; role: UserRole };
}

export function watchAuth(callback: (event: AuthChangeEvent, session: Session | null) => void) {
  if (!supabase) return () => undefined;
  const { data } = supabase.auth.onAuthStateChange(callback);
  return () => data.subscription.unsubscribe();
}

export function watchBusinessChanges(callback: () => void | Promise<void>) {
  if (!supabase) return () => undefined;
  let timer = 0;
  let running = false;
  let rerun = false;
  const run = async () => {
    if (running) { rerun = true; return; }
    running = true;
    try { await callback(); }
    finally {
      running = false;
      if (rerun) { rerun = false; schedule(); }
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => { void run(); }, 350);
  };
  const channel: RealtimeChannel = supabase
    .channel('doubletime-pos-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, schedule)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'modifiers' }, schedule)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'price_lists' }, schedule)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'business_settings' }, schedule)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, schedule)
    .subscribe();
  return () => { clearTimeout(timer); void supabase.removeChannel(channel); };
}
