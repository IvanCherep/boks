# 0012: One embedding model per column - `multilingual-e5-small`

Date: 2026-09-20
Status: accepted

`reels.embedding` holds vectors from exactly one model, `multilingual-e5-small`, and `set_bok_embedding` refuses any other (`20260920120000_boks_single_embedding_model.sql`). Cosine similarity between two models' vectors is meaningless and the failure is silent - just a worse feed. Supabase's built-in `gte-small` was measured on this catalogue and could not tell Russian authors apart (same-author pairs 0.895 vs 0.893 for different authors), and most of the catalogue is Russian. Embedding therefore runs locally through `scripts/embed-catalogue.mjs`; the `embed` Edge Function stays deployed but is refused until a multilingual model is available in a runtime we can call (Cloudflare Workers AI `bge-m3` is the intended next step).
