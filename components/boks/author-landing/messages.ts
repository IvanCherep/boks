import { defineMessages } from "@/lib/i18n/messages";

/** The frame's own words; the page's texts are the designers' (`public/author-landing/copy.js`). */
export const landingMessages = defineMessages(
  {
    frameTitle: "boks for authors",
    failed: "The application did not go. Try again in a minute.",
  },
  {
    ru: {
      frameTitle: "boks для авторов",
      failed: "Заявка не отправилась. Попробуйте через минуту.",
    },
  },
);
