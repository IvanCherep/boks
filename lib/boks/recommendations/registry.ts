import type { RecommendationStrategy, StrategyFamily } from "@/lib/boks/recommendations/strategy";
import type { UiLanguage } from "@/lib/i18n/ui-language";
import {
  type RecommendationAlgorithmId,
  registeredStrategies,
  strategyList,
} from "@/lib/boks/recommendations/strategies";

export type { RecommendationAlgorithmId };

export const defaultAlgorithmId: RecommendationAlgorithmId = "for_you";

/**
 * Control arm for every comparison in the admin lab.
 *
 * `for_you` is the product ranker, so it is what a challenger has to beat.
 */
export const controlAlgorithmId: RecommendationAlgorithmId = "for_you";

const strategiesById = new Map(strategyList.map((strategy) => [strategy.id, strategy]));

export function listRecommendationStrategies(): readonly RecommendationStrategy[] {
  return strategyList;
}

export function isRecommendationAlgorithmId(value: unknown): value is RecommendationAlgorithmId {
  return typeof value === "string" && strategiesById.has(value);
}

export function getRecommendationStrategy(id: string): RecommendationStrategy {
  return strategiesById.get(id) ?? strategiesById.get(defaultAlgorithmId) ?? registeredStrategies[0];
}

/**
 * Russian names and descriptions for the admin console. The strategy files
 * keep the English ones, which are what tests, scripts and exports read; ids
 * never change.
 */
const russianStrategies: Record<RecommendationAlgorithmId, { name: string; description: string }> = {
  for_you: {
    name: "Для вас",
    description:
      "Перенесён из исходного ранжировщика boks: источники близости и открытий, оценённые по истории читателя, доверию к автору и свежести, затем жадная выдача, которая разносит авторов, формы и длины. Всё, что читателю уже показывали, ждёт позади всего, чего он ещё не видел.",
  },
  balanced: {
    name: "Сбалансированное качество",
    description: "Контрольная смесь дочитываний, реакций, свежести и небольшой доли исследования.",
  },
  completion_first: {
    name: "Сначала дочитывания",
    description: "Продвигает боки, которые дочитывают после начала, и терпимо относится к длинным.",
  },
  reaction_first: {
    name: "Сначала реакции",
    description: "Продвигает боки, которые быстро собирают лайки, репосты и комментарии.",
  },
  discovery: {
    name: "Открытия",
    description: "Даёт новым и мало проверенным бокам больше шансов, не забывая о качестве.",
  },
  taste_match: {
    name: "По вкусу",
    description: "Ранжирует по близости жанра и настроения, которую читатель накопил дочитываниями и лайками.",
  },
  recency: {
    name: "Сначала новые",
    description: "Хронологическая лента. Базовая линия до экспериментов, с которой вышел MVP.",
  },
  random_control: {
    name: "Случайная базовая линия",
    description: "Детерминированное перемешивание. Показывает, сколько вообще стоит ранжирование.",
  },
};

const familyNames: Record<UiLanguage, Record<StrategyFamily, string>> = {
  en: { quality: "quality", engagement: "engagement", exploration: "exploration", personal: "personal", baseline: "baseline" },
  ru: { quality: "качество", engagement: "вовлечение", exploration: "исследование", personal: "персональный", baseline: "базовая линия" },
};

function localized(strategy: RecommendationStrategy, language: UiLanguage) {
  if (language === "en") return strategy;
  return russianStrategies[strategy.id as RecommendationAlgorithmId] ?? strategy;
}

export function recommendationAlgorithmName(id: string, language: UiLanguage = "en") {
  const strategy = strategiesById.get(id);
  return strategy ? localized(strategy, language).name : id;
}

/**
 * Browser- and admin-facing description of the registry. The admin lab renders
 * this so operators can see every algorithm the build knows about, including
 * ones that are not currently receiving traffic.
 */
export function describeRecommendationStrategies(language: UiLanguage = "en") {
  return strategyList.map((strategy) => ({
    id: strategy.id,
    name: localized(strategy, language).name,
    description: localized(strategy, language).description,
    family: familyNames[language][strategy.family],
    weights: strategy.weights,
  }));
}
