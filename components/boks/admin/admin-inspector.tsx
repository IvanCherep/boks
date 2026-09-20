"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AdminInspectorContext, type AdminInspector } from "@/components/boks/admin/inspector-context";
import { BokInspector } from "@/components/boks/admin/bok-inspector";
import { PersonInspector } from "@/components/boks/admin/person-inspector";

type InspectorTarget = { kind: "bok"; id: string } | { kind: "person"; id: string };

/**
 * The console's one detail surface. A side sheet over whichever tab is open,
 * showing a boks or a person; following a link inside it (an author, a
 * commenter, a liked boks) pushes onto a stack, and Back walks it.
 */
export function AdminInspectorProvider({
  children,
  onChange,
}: {
  children: ReactNode;
  /** A boks was hidden, restored or erased from inside the inspector. */
  onChange?: () => void;
}) {
  const [stack, setStack] = useState<InspectorTarget[]>([]);
  const [changes, setChanges] = useState(0);
  const current = stack.at(-1) ?? null;

  const open = useCallback((target: InspectorTarget) => {
    setStack((entries) => {
      const top = entries.at(-1);
      if (top && top.kind === target.kind && top.id === target.id) return entries;
      return [...entries, target];
    });
  }, []);

  const inspector = useMemo<AdminInspector>(
    () => ({
      openBok: (id) => open({ kind: "bok", id }),
      openPerson: (id) => open({ kind: "person", id }),
      changes,
    }),
    [changes, open]
  );

  const back = () => setStack((entries) => entries.slice(0, -1));
  const changed = () => {
    setChanges((count) => count + 1);
    onChange?.();
  };

  return (
    <AdminInspectorContext.Provider value={inspector}>
      {children}
      <Sheet open={Boolean(current)} onOpenChange={(isOpen) => !isOpen && setStack([])}>
        <SheetContent side="right" className="admin-inspector">
          <SheetHeader className="admin-inspector__header">
            {stack.length > 1 && (
              <Button size="sm" variant="ghost" onClick={back} className="w-fit">
                <ArrowLeft /> Back
              </Button>
            )}
            <SheetTitle className="sr-only">{current?.kind === "person" ? "Account" : "Boks"}</SheetTitle>
            <SheetDescription className="sr-only">
              {current?.kind === "person"
                ? "One account's profile, metrics, and the boks they wrote, liked, commented on and read."
                : "One bok's text, history, metrics, comments and likes."}
            </SheetDescription>
          </SheetHeader>
          {/* Keyed by what it shows, so each boks or person opens at the top
              rather than at the scroll position of the one before it. */}
          <div className="admin-inspector__scroll" key={current ? `${current.kind}:${current.id}` : "empty"}>
            {current?.kind === "bok" && (
              <BokInspector
                key={`bok:${current.id}`}
                id={current.id}
                onChanged={changed}
                onErased={() => {
                  changed();
                  back();
                }}
              />
            )}
            {current?.kind === "person" && <PersonInspector key={`person:${current.id}`} userId={current.id} />}
          </div>
        </SheetContent>
      </Sheet>
    </AdminInspectorContext.Provider>
  );
}
