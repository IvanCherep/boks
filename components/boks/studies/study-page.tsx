"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import "@/app/study.css";
import { getBrowserId } from "@/components/boks/reader-behavior";
import {
  claimStudyTrace,
  completeStudy,
  enrollInStudy,
  loadBoksUserContext,
  loadStudy,
  nextStudyFragment,
  recordStudyResponse,
  type StudyFragment,
  type StudyState,
} from "@/components/boks/supabase-browser-data";
import { useMessages } from "@/components/boks/ui-language";
import { studyCopy, studyMinutes } from "@/components/boks/studies/study-copy";
import { StudyFrame, StudyIntro, StudyMessage } from "@/components/boks/studies/study-forms";
import { StudyProtocol, type StudyRun } from "@/components/boks/studies/study-protocols";
import { sampleFragments } from "@/components/boks/studies/study-samples";
import { parseStudyMaterials } from "@/lib/boks/studies/materials";
import { isStudyKey, studyConditions, type StudyKey } from "@/lib/boks/studies/protocol";

/**
 * `/study/<key>`: one participant, one protocol.
 *
 * A study that is switched off says so and nothing more; its link can be
 * printed before the study starts. A participant joins with one tap, is
 * assigned a condition by the server and is taken through the protocol;
 * a second visit after finishing is thanked, not run again.
 *
 * `?preview=1` is for admins: the whole protocol, switched on or off, with
 * nothing written. `&condition=` picks the condition to look at.
 */

type Phase =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "unknown" }
  | { kind: "closed" }
  | { kind: "done" }
  | { kind: "materials"; problems: string[] }
  | { kind: "intro"; state: StudyState }
  | { kind: "running"; run: StudyRun }
  | { kind: "thanks" };

function previewRequest() {
  if (typeof window === "undefined") return { preview: false, condition: null as string | null };
  const params = new URLSearchParams(window.location.search);
  return { preview: params.get("preview") === "1", condition: params.get("condition") };
}

export function StudyPage({ studyKey }: { studyKey: string }) {
  const words = useMessages(studyCopy);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = isStudyKey(studyKey) ? studyKey : null;

  const buildRun = useCallback(
    (state: StudyState, participant: { id: string; condition: string; seed: number }, previewing: boolean): StudyRun | { problems: string[] } => {
      const parsed = parseStudyMaterials(state.key, state.materials);
      if (!parsed.ok) return { problems: parsed.problems };
      let fragments = [...sampleFragments];
      return {
        key: state.key,
        words,
        preview: previewing,
        participant,
        materials: parsed.materials,
        record: async (step, answers, extra = {}) => {
          if (previewing) return;
          await recordStudyResponse({ participantId: participant.id, step, answers, ...extra });
        },
        claimTrace: (reelId) => (previewing ? Promise.resolve(null) : claimStudyTrace(participant.id, reelId)),
        nextFragment: (): Promise<StudyFragment | null> => {
          if (!previewing) return nextStudyFragment(participant.id);
          const [next, ...rest] = fragments;
          fragments = rest;
          return Promise.resolve(next ?? null);
        },
        finish: () => {
          setPhase({ kind: "thanks" });
          if (!previewing) void completeStudy(participant.id).catch(() => undefined);
        },
      };
    },
    [words]
  );

  useEffect(() => {
    if (!key) {
      const handle = window.setTimeout(() => setPhase({ kind: "unknown" }), 0);
      return () => window.clearTimeout(handle);
    }
    let cancelled = false;
    const request = previewRequest();
    (async () => {
      const state = await loadStudy(key);
      if (cancelled) return;
      if (!state) return setPhase({ kind: "unknown" });
      if (request.preview) {
        const context = await loadBoksUserContext();
        if (cancelled) return;
        if (context?.role === "admin") {
          setPreview(true);
          const conditions: readonly string[] = studyConditions[key];
          const condition = request.condition && conditions.includes(request.condition) ? request.condition : conditions[0];
          const run = buildRun(state, { id: "preview", condition, seed: Math.floor(Math.random() * 2 ** 31) }, true);
          return setPhase("problems" in run ? { kind: "materials", problems: run.problems } : { kind: "intro", state });
        }
      }
      if (!state.enabled) return setPhase({ kind: "closed" });
      if (state.participant?.completedAt) return setPhase({ kind: "done" });
      setPhase({ kind: "intro", state });
    })().catch((error: unknown) => {
      if (!cancelled) setPhase({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
    });
    return () => { cancelled = true; };
  }, [key, buildRun]);

  const start = async (state: StudyState) => {
    setBusy(true);
    try {
      let participant: { id: string; condition: string; seed: number };
      if (preview) {
        const request = previewRequest();
        const conditions: readonly string[] = studyConditions[state.key];
        participant = {
          id: "preview",
          condition: request.condition && conditions.includes(request.condition) ? request.condition : conditions[Math.floor(Math.random() * conditions.length)],
          seed: Math.floor(Math.random() * 2 ** 31),
        };
      } else {
        participant = state.participant ?? (await enrollInStudy(state.key, getBrowserId("boks-reader")));
      }
      const run = buildRun(state, participant, preview);
      setPhase("problems" in run ? { kind: "materials", problems: run.problems } : { kind: "running", run });
    } catch (error) {
      setPhase({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const content = useMemo(() => {
    switch (phase.kind) {
      case "loading": return <p className="study-loading" role="status">{words.loading}</p>;
      case "unknown": return <StudyMessage title={words.unknown} />;
      case "closed": return <StudyMessage title={words.notRunning} body={<p>{words.notRunningBody}</p>} />;
      case "done": return <StudyMessage title={words.thanksTitle} body={<p>{words.alreadyDone}</p>} />;
      case "thanks": return <StudyMessage title={words.thanksTitle} body={<p>{words.thanksBody}</p>} />;
      case "failed": return <StudyMessage title={words.failed} body={<p className="study-muted">{phase.message}</p>}
        action={<button type="button" className="study-button" onClick={() => window.location.reload()}>{words.retry}</button>} />;
      case "materials": return <StudyMessage title={words.previewNoMaterials} body={<ul className="study-problems">{phase.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>} />;
      case "intro": return <StudyIntro words={words} minutes={studyMinutes[phase.state.key as StudyKey]} what={words.introWhat[phase.state.key as StudyKey]} busy={busy} onStart={() => void start(phase.state)} />;
      case "running": return <StudyProtocol run={phase.run} />;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, words, busy]);

  return <StudyFrame words={words} preview={preview}>{content}</StudyFrame>;
}
