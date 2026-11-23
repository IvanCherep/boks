"use client";

import { supabase } from "@/lib/boks/supabase-client";
import type { LegalKind } from "@/lib/boks/author/agreement";

/** The documents for authors (`20261123095000_boks_legal_documents.sql`): open to anyone. */

export type LegalDocument = {
  kind: LegalKind;
  version: string;
  title: string;
  body: string;
  sha256: string;
  publishedAt: string;
  current: boolean;
  versions: { version: string; publishedAt: string }[];
};

export type LegalDocumentEntry = {
  kind: LegalKind;
  title: string;
  version: string;
  versions: { version: string; publishedAt: string }[];
};

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const result = await supabase.rpc(name, args);
  if (result.error) throw result.error;
  return result.data as T;
}

export const loadLegalDocument = (kind: LegalKind, version: string | null = null) =>
  call<LegalDocument | null>("get_boks_legal_document", { p_kind: kind, p_version: version });

export const loadLegalDocuments = () => call<LegalDocumentEntry[]>("get_boks_legal_documents");
