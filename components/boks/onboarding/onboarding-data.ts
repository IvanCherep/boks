"use client";

import { supabase } from "@/lib/boks/supabase-client";
import type { OnboardingAnswers } from "./onboarding-frame";

/**
 * The introduction's answers into the reader's account (guest or permanent):
 * `save_my_starting_preferences`, read back by the feed. `adopt`: a guest's
 * answers carried into the account they signed in to, which keeps its own if
 * it already has some.
 */
export async function saveStartingPreferences(answers: OnboardingAnswers, options: { adopt?: boolean; visitorId?: string | null } = {}) {
  if (!supabase) return null;
  const result = await supabase.rpc("save_my_starting_preferences", {
    p_answers: answers,
    p_adopt: Boolean(options.adopt),
    p_visitor_id: options.visitorId ?? null,
  });
  if (result.error) throw result.error;
  return result.data;
}
