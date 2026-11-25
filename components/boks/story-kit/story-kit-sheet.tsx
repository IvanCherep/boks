"use client";

import { useEffect, useState } from "react";
import "@/app/story-kit.css";
import { Sheet } from "@/components/boks/author-cabinet/ui";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { ShareLinkPair } from "@/components/boks/share/share-link-pair";
import { loadBokSlug } from "@/components/boks/supabase-browser-data";
import { authorShareUrl, bokShareUrl, russianShareUrl } from "@/lib/boks/share-link";
import { defineMessages } from "@/lib/i18n/messages";
import { shareToStory } from "./kit-share";
import { canShareKitFile, KitOptions, KitPreview, useKitCard, type KitSubject } from "./kit-editor";

export type { KitSubject } from "./kit-editor";

/**
 * "For social media" (`docs/story-kit.md`): ready pictures for stories and
 * posts about the author's page or one of their works, in the boks look, to
 * save or send straight to a story from the phone's share sheet.
 */

const words = defineMessages(
  {
    title: "For social media",
    close: "Close",
    intro: "Pictures for stories and posts, in the boks look. Save one, or send it straight to a story.",
    share: "Share to a story",
    save: "Save the picture",
    copied: "The link is copied: paste it into the “Link” sticker.",
    notCopied: "Copy the link with a button below.",
    shareFailed: "The phone did not open its menu. Save the picture and post it from your gallery.",
    saved: "Saved to downloads.",
    howTitle: "How to post",
    how: {
      instagram: "Instagram: choose Instagram in the menu, then Story. Add the “Link” sticker and paste the address, it is already copied.",
      vk: "VK: choose VK, then Story, and add the “Link” sticker with the same address.",
      telegram: "Telegram: from the menu the picture goes to a chat or a channel. For a story, save it and pick it in Telegram, New story; the link goes into the caption.",
      other: "No network you need in the menu? Choose “Save image” there and post the picture from your gallery.",
    },
    linkTitle: "The link, by hand",
    linkHint: "If it did not copy, or for a post: the address for Russian networks, and the one Telegram previews.",
    noFrames: "This Series has no pictures to show yet.",
  },
  {
    ru: {
      title: "Для соцсетей",
      close: "Закрыть",
      intro: "Готовые картинки для сторис и постов в стиле boks. Сохраните или сразу отправьте в сторис.",
      share: "Поделиться в сторис",
      save: "Сохранить картинку",
      copied: "Ссылка скопирована: вставьте её в стикер «Ссылка».",
      notCopied: "Скопируйте ссылку кнопкой ниже.",
      shareFailed: "Телефон не открыл меню. Сохраните картинку и выложите её из галереи.",
      saved: "Сохранено в загрузки.",
      howTitle: "Как выложить",
      how: {
        instagram: "Instagram: в меню выберите Instagram, затем «История». Добавьте стикер «Ссылка» и вставьте адрес — он уже скопирован.",
        vk: "ВКонтакте: выберите ВКонтакте, затем «История», и добавьте стикер «Ссылка» с тем же адресом.",
        telegram: "Telegram: из меню картинка уходит в чат или канал. Для истории сохраните её и выберите в Telegram → «Новая история», ссылку — в подпись.",
        other: "Нужной соцсети нет в меню? Нажмите там «Сохранить изображение» и выложите картинку из галереи.",
      },
      linkTitle: "Ссылка вручную",
      linkHint: "Если не скопировалась или нужна для поста: адрес для российских соцсетей и тот, что показывает превью в Telegram.",
      noFrames: "У этой Series пока нет кадров.",
    },
  }
);

export function StoryKitSheet({ subject, handle, onClose }: { subject: KitSubject; handle: string; onClose: () => void }) {
  const w = useMessages(words);
  const device = useUiLanguage();
  const kit = useKitCard(subject, handle);
  const [notice, setNotice] = useState("");
  const [slug, setSlug] = useState<string | null>(null);
  const work = subject.kind === "work" ? subject : null;
  useEffect(() => {
    if (!work) return;
    let live = true;
    void loadBokSlug(work.bokId).then((value) => { if (live) setSlug(value); });
    return () => { live = false; };
  }, [work]);

  const { picture, file, fileName, ready } = kit;
  const canShareFile = canShareKitFile(file);
  const pageUrl = typeof window === "undefined" ? "" : work ? bokShareUrl({ id: work.bokId, slug }, window.location.origin) : authorShareUrl(handle, window.location.origin);
  // A link sticker shows no preview, so it takes the direct address: no detour abroad for a reader in Russia.
  const stickerLink = russianShareUrl(pageUrl);

  async function share() {
    if (!file) return;
    const { outcome, copied } = await shareToStory(file, stickerLink, { share: (data) => navigator.share(data), clipboard: navigator.clipboard });
    if (outcome === "failed") setNotice(w.shareFailed);
    else setNotice(copied ? w.copied : w.notCopied);
  }

  return (
    // Its own cabinet look wherever it opens: My page, or Studio, which is not inside the cabinet.
    <div className="acab kit-root">
    <Sheet title={w.title} closeLabel={w.close} onClose={onClose}>
      <div className="kit">
        <p className="kit-intro">{w.intro}</p>
        <div className="kit-layout">
          <KitPreview kit={kit} />
          <div className="kit-controls">
            <KitOptions kit={kit} onNotice={setNotice} />
            {notice && <p className="kit-notice" role="status">{notice}</p>}
            <div className="kit-actions">
              {canShareFile && <button type="button" className="btn" disabled={!ready} onClick={() => void share()}>{w.share}</button>}
              <a className={`btn ${canShareFile ? "btn-secondary" : ""}`} href={picture?.url} download={fileName} aria-disabled={!ready} onClick={(event) => { if (!ready) event.preventDefault(); else setNotice(w.saved); }}>
                {w.save}
              </a>
            </div>
            <section className="kit-how" aria-label={w.howTitle}>
              <strong>{w.howTitle}</strong>
              <ul>
                <li>{w.how.instagram}</li>
                <li>{w.how.vk}</li>
                <li>{w.how.telegram}</li>
              </ul>
              <small>{w.how.other}</small>
            </section>
            <section className="kit-link">
              <strong>{w.linkTitle}</strong>
              <small>{w.linkHint}</small>
              <ShareLinkPair url={pageUrl} caption={false} language={device} />
            </section>
          </div>
        </div>
      </div>
    </Sheet>
    </div>
  );
}
