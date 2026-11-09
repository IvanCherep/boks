"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MyAuthorPage } from "@/components/boks/client-types";
import { loadMyAuthorPage, saveMyAuthorPage } from "@/components/boks/supabase-browser-data";
import { authorInitials, mountAuthorRings } from "@/components/boks/author-rings";
import { readableBoksError } from "@/lib/boks/errors";
import { clampCrop, cropLayout, encodeCrop, photoProblem, zoomMax, zoomMin, type Crop } from "@/lib/boks/author/author-photo";
import type { UiLanguage } from "@/lib/i18n/ui-language";
import type { CabinetWords } from "./messages";
import { Icon, LanguageSwitch, Sheet, SheetAction, Topbar } from "./ui";

/**
 * "Photo and name" (design v51): what readers see on the author's page
 * (`/@handle`) and in its link preview. Nothing changes for readers until
 * Save, which writes the name and the photo together (`save_my_author_page`);
 * a failed save keeps everything the author typed and chose.
 */

export type ProfileView = "profile-edit" | "profile-photo" | "profile-preview";

type PhotoDraft = { kind: "keep" } | { kind: "remove" } | { kind: "new"; jpeg: string };

type CropState = Crop & { url: string; image: HTMLImageElement };

const nameLimit = 60;
const cleanName = (value: string) => value.trim().replace(/\s+/g, " ");
const nameLength = (value: string) => Array.from(cleanName(value)).length;

export function photoUrl(handle: string, version: number | null | undefined) {
  return version ? `/a/${handle}/photo?v=${version}` : null;
}

export function useProfileEditor({
  w,
  language,
  enabled,
  go,
  toast,
}: {
  w: CabinetWords;
  language: UiLanguage;
  /** A signed-in author: the page is loaded once there is one. */
  enabled: boolean;
  go: (view: ProfileView | "library") => void;
  toast: (text: string) => void;
}) {
  const [saved, setSaved] = useState<MyAuthorPage | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<PhotoDraft>({ kind: "keep" });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [crop, setCrop] = useState<CropState | null>(null);
  const [loadingPhoto, setLoadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<"badType" | "photoTooLarge" | "badImage" | null>(null);
  const [sheet, setSheet] = useState<null | "photo" | { leave: () => void }>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const cropBox = useRef<HTMLDivElement | null>(null);
  const cropImage = useRef<HTMLImageElement | null>(null);
  const fileTicket = useRef(0);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const page = await loadMyAuthorPage();
      setSaved(page);
      setName(page.name ?? "");
      setPhoto({ kind: "keep" });
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [enabled, load]);

  const handle = saved?.handle ?? "";
  const savedName = saved?.name ?? "";
  const valid = nameLength(name) <= nameLimit;
  const dirty = cleanName(name) !== cleanName(savedName) || photo.kind !== "keep";
  const unsaved = dirty || crop !== null || loadingPhoto;

  /** The page as it is saved, or as it would be: for the card, the library and the preview. */
  function identity(useDraft: boolean) {
    const shownName = cleanName(useDraft ? name : savedName);
    const savedPhoto = photoUrl(handle, saved?.photoVersion);
    const shownPhoto = !useDraft
      ? savedPhoto
      : photo.kind === "new"
        ? `data:image/jpeg;base64,${photo.jpeg}`
        : photo.kind === "remove"
          ? null
          : savedPhoto;
    // Without a name, the medallion carries the handle's first letter, as on the author page.
    const initials = shownName ? authorInitials(shownName, handle) : Array.from(authorInitials("", handle)).slice(0, 1).join("");
    return { name: shownName, photo: shownPhoto, handle, initials: initials || "b" };
  }

  // Leaving with changes asks first; so does closing the tab.
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  function clearCrop() {
    if (crop?.url) URL.revokeObjectURL(crop.url);
    setCrop(null);
  }

  function discard() {
    fileTicket.current += 1;
    setLoadingPhoto(false);
    clearCrop();
    setName(savedName);
    setPhoto({ kind: "keep" });
    setSaveState("idle");
    setPhotoError(null);
  }

  /** Asked before leaving the editor: true when it may go now. */
  function requestLeave(leave: () => void) {
    if (saveState === "saving") return false;
    if (!unsaved) return true;
    setSheet({ leave });
    return false;
  }

  function choosePhoto() {
    setSheet(null);
    if (saveState === "saving" || loadingPhoto) return;
    fileInput.current?.click();
  }

  function openPhotoMenu() {
    if (saveState === "saving" || loadingPhoto) return;
    if (crop) {
      go("profile-photo");
      return;
    }
    setPhotoError(null);
    if (!identity(true).photo) {
      choosePhoto();
      return;
    }
    setSheet("photo");
  }

  async function receiveFile(file: File | undefined) {
    if (!file || saveState === "saving") return;
    const ticket = ++fileTicket.current;
    const problem = photoProblem(file);
    if (problem) {
      setPhotoError(problem);
      return;
    }
    setPhotoError(null);
    setLoadingPhoto(true);
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (ticket !== fileTicket.current) {
        URL.revokeObjectURL(url);
        return;
      }
      if (!image.naturalWidth || !image.naturalHeight) throw new Error("Empty image.");
      clearCrop();
      setCrop({ url, image, width: image.naturalWidth, height: image.naturalHeight, zoom: 1, x: 0, y: 0 });
      setLoadingPhoto(false);
      go("profile-photo");
    } catch {
      URL.revokeObjectURL(url);
      if (ticket !== fileTicket.current) return;
      setLoadingPhoto(false);
      setPhotoError("badImage");
    }
  }

  function applyCrop() {
    if (!crop) return;
    try {
      const jpeg = encodeCrop(crop.image, crop);
      setPhoto({ kind: "new", jpeg });
      setSaveState("idle");
      clearCrop();
      go("profile-edit");
      toast(w.cropApplied);
    } catch {
      setPhotoError("badImage");
    }
  }

  function cancelCrop() {
    fileTicket.current += 1;
    setLoadingPhoto(false);
    clearCrop();
    setPhotoError(null);
    go("profile-edit");
  }

  async function save() {
    if (saveState === "saving" || !dirty || !valid || loadingPhoto || !saved) return;
    setSaveState("saving");
    setSaveError("");
    try {
      const next = await saveMyAuthorPage({
        name: cleanName(name),
        photo: photo.kind === "new" ? photo.jpeg : photo.kind,
        version: saved.version,
      });
      setSaved(next);
      setName(next.name ?? "");
      setPhoto({ kind: "keep" });
      setSaveState("saved");
      toast(w.savedToast);
    } catch (error) {
      setSaveState("error");
      setSaveError(readableBoksError(error, w.saveErrorHint, language));
    }
  }

  // ------------------------------------------------------------ the crop frame

  const drawCrop = useCallback((next: CropState | null) => {
    const box = cropBox.current;
    const image = cropImage.current;
    if (!next || !box || !image) return;
    const layout = cropLayout(next, box.getBoundingClientRect().width);
    image.style.width = `${layout.width}px`;
    image.style.height = `${layout.height}px`;
    image.style.left = `${layout.left}px`;
    image.style.top = `${layout.top}px`;
  }, []);

  useEffect(() => {
    drawCrop(crop);
  }, [crop, drawCrop]);

  useEffect(() => {
    const box = cropBox.current;
    if (!box || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => drawCrop(crop));
    observer.observe(box);
    return () => observer.disconnect();
  });

  const drag = useRef<{ id: number; x: number; y: number; startX: number; startY: number; size: number } | null>(null);

  function moveCrop(change: Partial<Crop>) {
    setCrop((current) => (current ? { ...current, ...clampCrop({ ...current, ...change }) } : current));
  }

  // ------------------------------------------------------------ the dark card's rings

  const ringsCanvas = useRef<HTMLCanvasElement | null>(null);
  const ringsMounted = useRef<HTMLCanvasElement | null>(null);
  const ringsController = useRef<ReturnType<typeof mountAuthorRings> | null>(null);
  useEffect(() => {
    const canvas = ringsCanvas.current;
    if (canvas === ringsMounted.current) return;
    ringsController.current?.destroy();
    ringsController.current = canvas ? mountAuthorRings(canvas, { host: canvas }) : null;
    ringsMounted.current = canvas;
  });
  useEffect(() => () => ringsController.current?.destroy(), []);

  // ------------------------------------------------------------ views

  const picker = (
    <input
      ref={fileInput}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      hidden
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        void receiveFile(file);
      }}
    />
  );

  function portrait(person: ReturnType<typeof identity>) {
    return person.photo ? (
      <img className="pe-portrait" src={person.photo} alt="" width={256} height={256} />
    ) : (
      <span className="pe-monogram" aria-hidden="true">
        {person.initials}
      </span>
    );
  }

  function EditView() {
    const person = identity(true);
    const saving = saveState === "saving";
    if (!saved) {
      return (
        <main className="page pe-page">
          <Topbar title={w.workspace} backLabel={w.back} languageLabel={w.languageSwitch} onBack={() => go("library")} />
          <header className="pe-heading">
            <h1>{w.pageTitle}</h1>
            <p>{loadFailed ? w.pageLoadFailed : w.loading}</p>
          </header>
          {loadFailed && (
            <button type="button" className="btn" onClick={() => void load()}>
              {w.retry}
            </button>
          )}
        </main>
      );
    }
    const photoState = loadingPhoto ? w.loadingPhoto : crop ? w.cropTitle : photo.kind === "new" ? w.photoDraft : person.photo ? w.photoSaved : w.photoNone;
    return (
      <main className="page pe-page">
        <Topbar title={w.workspace} backLabel={w.back} languageLabel={w.languageSwitch} onBack={() => go("library")} />
        <header className="pe-heading">
          <h1>{w.pageTitle}</h1>
          <p>{w.pageIntro}</p>
        </header>
        <div className="pe-editor-grid">
          <div className="pe-preview-column">
            <section className="pe-card" aria-label={w.pagePreviewLabel}>
              <canvas ref={ringsCanvas} className="pe-card-rings" aria-hidden="true" />
              <div className="pe-card-top">
                <span className="brand">boks</span>
                <button type="button" className="pe-preview" disabled={saving || loadingPhoto || !valid} onClick={() => go("profile-preview")}>
                  <Icon name="eye" />
                  <span>{w.pagePreview}</span>
                </button>
              </div>
              <div className="pe-card-person">
                <button
                  type="button"
                  className="pe-photo-trigger"
                  aria-label={person.photo ? w.photoChange : w.photoAdd}
                  disabled={saving || loadingPhoto}
                  onClick={openPhotoMenu}
                >
                  <span>{portrait(person)}</span>
                  <span className="pe-camera">
                    <Icon name="camera" />
                  </span>
                </button>
                <div className="pe-card-identity">
                  <h2>{person.name || `@${handle}`}</h2>
                  {person.name && <span>@{handle}</span>}
                </div>
              </div>
            </section>
            <div className="pe-photo-row">
              <div>
                <strong>{w.photo}</strong>
                <small>{photoState}</small>
              </div>
              <button type="button" className="pe-photo-link" disabled={saving || loadingPhoto} onClick={openPhotoMenu}>
                {crop ? w.cropTitle : person.photo ? w.photoChange : w.photoAdd}
              </button>
            </div>
            <p className="pe-form-note">{w.photoHelp}</p>
            {photoError && (
              <p className="pe-field-error" role="alert">
                {w[photoError]}
              </p>
            )}
            {picker}
          </div>
          <div className="pe-details">
            <label className="pe-field" htmlFor="pe-name">
              <span>
                <strong>{w.pageName}</strong>
                <small>{w.optional}</small>
              </span>
              <input
                id="pe-name"
                type="text"
                name="public-name"
                value={name}
                placeholder={w.namePlaceholder}
                autoComplete="name"
                aria-describedby="pe-name-help pe-name-error"
                aria-invalid={!valid}
                disabled={saving}
                onChange={(event) => {
                  setName(event.target.value);
                  if (saveState === "saved") setSaveState("idle");
                }}
              />
            </label>
            <div className="pe-name-meta">
              <span id="pe-name-error" className="pe-field-error" hidden={valid}>
                {w.nameLong}
              </span>
              <span>
                {nameLength(name)} / {nameLimit}
              </span>
            </div>
            <p className="pe-form-note" id="pe-name-help">
              {w.nameHelp}
              <span>{w.nameEmpty}</span>
            </p>
            <section className="pe-handle">
              <div>
                <strong>{w.handle}</strong>
                <span>@{handle}</span>
              </div>
              <p>{w.handleHelp}</p>
            </section>
            {saveState === "error" && (
              <div className="pe-error" role="alert">
                <strong>{w.saveError}</strong>
                <p>{saveError || w.saveErrorHint}</p>
              </div>
            )}
          </div>
        </div>
        <footer className="pe-save-bar">
          <div className="pe-save-state" aria-live="polite">
            {saving ? w.saving : saveState === "saved" && !dirty ? w.saved : dirty ? w.notSaved : w.saveHelp}
          </div>
          <button type="button" className="btn pe-save" disabled={saving || !dirty || !valid || loadingPhoto} onClick={() => void save()}>
            {saving ? <span className="pe-spinner" aria-hidden="true" /> : <Icon name="check" />}
            <span>{saving ? w.saving : saveState === "error" ? w.retry : w.save}</span>
          </button>
        </footer>
      </main>
    );
  }

  function PhotoView() {
    return (
      <main className="page pe-page pe-photo-page">
        <header className="topbar">
          <button type="button" className="icon-btn" aria-label={w.cancel} onClick={cancelCrop}>
            <Icon name="back" />
          </button>
          <span className="bar-title">{w.photo}</span>
          <LanguageSwitch label={w.languageSwitch} />
        </header>
        <header className="pe-heading">
          <h1>{w.cropTitle}</h1>
          <p>{loadingPhoto ? w.loadingPhoto : w.cropHint}</p>
        </header>
        {picker}
        {crop && (
          <>
            <div className="pe-crop-workspace">
              <div
                ref={cropBox}
                className="pe-crop"
                tabIndex={0}
                role="group"
                aria-label={w.cropLabel}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.currentTarget.focus({ preventScroll: true });
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drag.current = {
                    id: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    startX: crop.x,
                    startY: crop.y,
                    size: event.currentTarget.getBoundingClientRect().width,
                  };
                }}
                onPointerMove={(event) => {
                  const start = drag.current;
                  if (!start || start.id !== event.pointerId) return;
                  moveCrop({ x: start.startX + (event.clientX - start.x) / start.size, y: start.startY + (event.clientY - start.y) / start.size });
                }}
                onPointerUp={(event) => {
                  if (drag.current?.id === event.pointerId) drag.current = null;
                }}
                onPointerCancel={() => (drag.current = null)}
                onKeyDown={(event) => {
                  const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
                  const move = moves[event.key];
                  if (!move) return;
                  event.preventDefault();
                  const step = (event.shiftKey ? 30 : 10) / event.currentTarget.getBoundingClientRect().width;
                  moveCrop({ x: crop.x + move[0] * step, y: crop.y + move[1] * step });
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img ref={cropImage} src={crop.url} alt="" draggable={false} />
                <span className="pe-crop-mask" aria-hidden="true" />
                <span className="pe-crop-grid" aria-hidden="true" />
              </div>
              <div className="pe-crop-tools">
                <label htmlFor="pe-zoom">
                  {w.cropZoom}
                  <output>{Math.round(crop.zoom * 100)}%</output>
                </label>
                <input
                  id="pe-zoom"
                  type="range"
                  min={zoomMin}
                  max={zoomMax}
                  step={0.01}
                  value={crop.zoom}
                  aria-label={w.cropZoom}
                  style={{ ["--pe-range" as string]: `${((crop.zoom - zoomMin) / (zoomMax - zoomMin)) * 100}%` }}
                  onChange={(event) => moveCrop({ zoom: Number(event.target.value) })}
                />
                <div className="pe-crop-secondary">
                  <button type="button" className="btn-quiet" onClick={() => moveCrop({ zoom: 1, x: 0, y: 0 })}>
                    {w.cropReset}
                  </button>
                  <button type="button" className="btn-quiet" onClick={() => fileInput.current?.click()}>
                    {w.chooseAnother}
                  </button>
                </div>
                <p className="pe-keyboard">{w.cropKeyboard}</p>
              </div>
            </div>
            <footer className="pe-save-bar pe-crop-save">
              <button type="button" className="btn btn-secondary" onClick={cancelCrop}>
                {w.cancel}
              </button>
              <button type="button" className="btn" disabled={loadingPhoto} onClick={applyCrop}>
                {w.photoApply}
                <Icon name="check" />
              </button>
            </footer>
          </>
        )}
        {photoError && (
          <p className="pe-field-error pe-crop-error" role="alert">
            {w[photoError]}
          </p>
        )}
      </main>
    );
  }

  const sheetNode =
    sheet === "photo" ? (
      <Sheet title={w.photo} closeLabel={w.close} onClose={() => setSheet(null)}>
        <div className="pe-sheet-photo">{portrait(identity(true))}</div>
        <SheetAction icon="camera" label={w.chooseAnother} onClick={choosePhoto} />
        <SheetAction
          icon="trash"
          label={w.photoRemove}
          danger
          onClick={() => {
            setPhoto(saved?.photoVersion ? { kind: "remove" } : { kind: "keep" });
            setSaveState("idle");
            setSheet(null);
            toast(w.photoRemoved);
          }}
        />
        <p className="sheet-quiet">{w.removeHint}</p>
      </Sheet>
    ) : sheet ? (
      <Sheet title={w.leaveTitle} closeLabel={w.close} onClose={() => setSheet(null)}>
        <p>{w.leaveBody}</p>
        <div className="pe-leave-actions">
          <button type="button" className="btn btn-light" onClick={() => setSheet(null)}>
            {w.stay}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              const leave = sheet.leave;
              discard();
              setSheet(null);
              leave();
            }}
          >
            {w.discard}
          </button>
        </div>
      </Sheet>
    ) : null;

  return {
    saved,
    identity,
    unsaved,
    requestLeave,
    canShow: (view: ProfileView) => (view === "profile-photo" ? crop !== null : true),
    render: (view: ProfileView) => (view === "profile-photo" ? PhotoView() : EditView()),
    sheet: sheetNode,
  };
}
