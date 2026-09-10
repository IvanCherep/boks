import { createClient } from "@supabase/supabase-js";
import type { BoksUserContext } from "@/components/boks/client-types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabasePublishableKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export async function getAnonymousSupabaseUserId() {
  if (!supabase) return null;

  const sessionResult = await supabase.auth.getSession();
  if (sessionResult.error) throw sessionResult.error;
  if (sessionResult.data.session?.user.id) return sessionResult.data.session.user.id;

  const signInResult = await supabase.auth.signInAnonymously();
  if (signInResult.error) throw signInResult.error;

  return signInResult.data.user?.id ?? null;
}

export async function getCurrentSupabaseUser() {
  if (!supabase) return null;

  const sessionResult = await supabase.auth.getSession();
  if (sessionResult.error) throw sessionResult.error;

  return sessionResult.data.session?.user ?? null;
}

export async function getCurrentBoksUserContext(): Promise<BoksUserContext | null> {
  if (!supabase) return null;

  const user = await getCurrentSupabaseUser();
  if (!user) return null;

  const result = await supabase.rpc("get_boks_user_context");
  if (result.error) throw result.error;

  return result.data as BoksUserContext;
}

export async function createOrUpgradeBoksUser(email: string, password: string) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const user = await getCurrentSupabaseUser();
  const redirectTo = typeof window === "undefined" ? undefined : window.location.origin;
  const signUp = async () => {
    const signUpResult = await supabase.auth.signUp({
      email,
      password,
      options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
    });
    if (signUpResult.error) throw signUpResult.error;
    return signUpResult.data.user;
  };

  if (user?.is_anonymous) {
    const updateResult = await supabase.auth.updateUser({
      email,
      password,
    });
    if (updateResult.error) {
      const emailOnlyResult = await supabase.auth.updateUser({ email });
      if (emailOnlyResult.error) {
        await supabase.auth.signOut();
        return signUp();
      }
      return emailOnlyResult.data.user;
    }
    return updateResult.data.user;
  }

  return signUp();
}

export async function signInBoksUser(email: string, password: string) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const signInResult = await supabase.auth.signInWithPassword({ email, password });
  if (signInResult.error) throw signInResult.error;

  return signInResult.data.user;
}

export async function signOutBoksUser() {
  if (!supabase) return;

  const result = await supabase.auth.signOut();
  if (result.error) throw result.error;
}
