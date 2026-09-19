"use client";

import { createContext, useContext } from "react";

/**
 * How any part of the admin console opens the inspector: one boks, or one
 * person. Moderation, Rights, Content and People all call these instead of
 * building their own detail views, so there is one of each to maintain.
 */
export type AdminInspector = {
  openBok: (id: string) => void;
  openPerson: (userId: string) => void;
  /**
   * Bumped whenever the inspector changes something - a boks hidden, restored
   * or erased - so a list that shows it can reload.
   */
  changes: number;
};

export const AdminInspectorContext = createContext<AdminInspector | null>(null);

export function useAdminInspector(): AdminInspector {
  const inspector = useContext(AdminInspectorContext);
  if (!inspector) throw new Error("useAdminInspector must be used inside AdminInspectorProvider.");
  return inspector;
}
