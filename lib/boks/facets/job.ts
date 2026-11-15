/**
 * Everything the facet labelling job (`deploy/embedder/facets.mjs`) needs from
 * the app's TypeScript, bundled by the release into one plain module
 * (`dist/embedder/facets-lib.mjs`), so the server job and the app share one
 * rubric and one way of talking to the model.
 */
export { agreement, authorGroupTask, moodTask, readAuthorGroupAnswer, readMoodAnswer } from "./labeler";
export { facetDefinition, facets } from "./rubric";
export { readYandexChat, withConcurrency, withRetries, yandexChatBody, yandexChatUrl, yandexConcurrency } from "@/lib/boks/fragments/llm";
