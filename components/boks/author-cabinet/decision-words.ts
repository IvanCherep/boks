import { defineMessages } from "@/lib/i18n/messages";
import type { DecisionKind } from "@/lib/boks/author/editor-decisions";

/**
 * The editors' reasoned answer as the author reads it, on My page and in the
 * composer (`docs/author-publishing.md`, "When the editors cannot take a piece").
 */
export const decisionWords = defineMessages(
  {
    kinds: { recording: "Recording", text: "Text", law: "Law", other: "Other" } as Record<DecisionKind, string>,
    changesTitle: "The editors ask for changes",
    refusedTitle: "The editors cannot publish this text",
    about: (kind: string) => `About: ${kind}`,
    recordAgain: "Record again",
    fixText: "Fix the text",
    edit: "Make the changes",
    changesHint: "Make the changes, then send it to the editors again.",
    recordingHint: "Only a recording made after this note counts.",
    refusedText: "The text stays with you, but it cannot be sent again as it is.",
    disagree: (place: string) => `If you disagree, write to us in “${place}”.`,
    openText: "Open the text",
    requestsPlace: "Requests and ideas",
    beforeNote: "Recorded before the editors' note. Record it again.",
  },
  {
    ru: {
      kinds: { recording: "Запись", text: "Текст", law: "Законодательство", other: "Другое" },
      changesTitle: "Редакция просит доработать",
      refusedTitle: "Редакция не сможет выпустить этот текст",
      about: (kind: string) => `Причина: ${kind}`,
      recordAgain: "Записать заново",
      fixText: "Исправить текст",
      edit: "Доработать",
      changesHint: "Доработайте и снова отправьте в редакцию.",
      recordingHint: "Засчитается только запись, сделанная после этой просьбы.",
      refusedText: "Текст остаётся у вас, но отправить его снова в таком виде нельзя.",
      disagree: (place: string) => `Если не согласны, напишите нам в «${place}».`,
      openText: "Открыть текст",
      requestsPlace: "Просьбы и предложения",
      beforeNote: "Записана до просьбы редакции. Запишите ещё раз.",
    },
  },
);
