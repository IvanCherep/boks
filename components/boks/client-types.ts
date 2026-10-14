import type { ReaderOutcomeRow } from "@/lib/recsys/aggregate";
import type { BokSubmissionQuota } from "@/lib/boks/author/submission-quota";
import type {
  ReaderSignals,
  RecommendationExperimentConfig,
  RecommendationLabReport,
} from "@/lib/boks/recommendations";

export type Story = {
  id: string;
  title: string;
  authorName: string;
  authorHandle: string;
  /** Account that published it. Empty for seeded demo boks, which cannot be followed. */
  authorUserId?: string;
  body: string;
  genre: string;
  mood: string;
  minutes: number;
  /** Real word count. Zero when unknown; callers fall back to `minutes`. */
  wordCount: number;
  /** ISO 639-1 code, `und` when the database could not tell. Absent on old rows. */
  language?: string;
  likes: number;
  shares: number;
  starts: number;
  completes: number;
  commentsCount: number;
  avgSeconds: number;
};

export type Comment = {
  id: number;
  storyId: string;
  visitorName: string;
  visitorHandle?: string | null;
  body: string;
  createdAt: string;
  parentCommentId: number | null;
  likesCount: number;
  likedByMe: boolean;
};

export type CommentLikeState = {
  commentId: number;
  likesCount: number;
  likedByMe: boolean;
};

/**
 * Browser-facing view of one registered algorithm. Sourced from
 * `lib/boks/recommendations` - the registry is browser-safe on purpose, because
 * the Supabase reader ranks its own feed.
 */
export type RecommendationAlgorithmSummary = {
  id: string;
  name: string;
  description: string;
  family: string;
  segment: string;
};

export type RecommendationExperiment = {
  experimentKey: string;
  algorithmId: string;
  algorithmName: string;
  userSegment: string;
  source: "assigned" | "requested" | "fallback";
};

/**
 * Where a feed came from and under which rules it was labelled.
 *
 * Carried on every reader event so a degraded serve is a countable condition
 * rather than an invisible second instrumentation regime (ADR-001).
 */
export type FeedProvenance = {
  feedId: string | null;
  /** `unknown` only before the first feed has been served. */
  servingBackend: "worker" | "browser" | "unknown";
  degradedMode: boolean;
  fallbackReason: string | null;
  labelingVersion: string;
  catalogSize: number;
  candidateCount: number;
};

export type Metrics = {
  funnel: Record<string, number>;
  stories: Array<Record<string, number | string>>;
  recentEvents: Array<Record<string, number | string>>;
  moderationQueue?: AdminModerationItem[];
  users?: AdminUserRow[];
  genres?: Array<Record<string, number | string>>;
  moods?: Array<Record<string, number | string>>;
  algorithms?: RecommendationAlgorithmSummary[];
  pagination?: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
    sort: string;
    query: string;
  };
};

/**
 * Counts of everything that would quietly corrupt a comparison.
 *
 * Every field is a condition that was previously invisible. Without this panel
 * broken numbers get trusted - which is exactly what happened.
 */
export type RecommendationDataQuality = {
  windowDays: number;
  events: number;
  eventsWithoutFeed: number;
  eventsUnattributed: number;
  feeds: number;
  feedsByBackend: Record<string, number>;
  degradedFeeds: number;
  emptyFeeds: number;
  algorithmMismatch: number;
  rankNotInFeed: number;
  eventsBeforeFeed: number;
  duplicateOutcomes: number;
  clampedReadingTime: number;
  outcomesWithoutTime: number;
  assignmentsWithoutEvents: number;
  eventsWithoutAssignment: number;
  labelingVersions: Record<string, number>;
};

export type RecommendationLabPayload = {
  experiment: RecommendationExperimentConfig;
  report: RecommendationLabReport;
  assignments: Array<{ algorithmId: string; userSegment: string; readers: number }>;
  topStories: Array<{ algorithmId: string; storyId: string; title: string; starts: number; completes: number; likes: number }>;
  /** Conditions that decide whether these numbers can be trusted at all. */
  dataQuality: RecommendationDataQuality | null;
  /**
   * The analysis unit itself - one row per (reader, algorithm, day). Carried so
   * the console can export it: a comparison nobody can recompute from the raw
   * rows is a claim, not a result.
   */
  outcomes: ReaderOutcomeRow[];
  /** False while the recommendation migration has not reached this project yet. */
  available: boolean;
  notice: string;
};

export type BoksOverview = {
  windowDays: number;
  readers: { active: number; previousActive: number; returning: number; new: number };
  reading: { activeSeconds: number; sessions: number; boksCompleted: number; boksStarted: number };
  readsPerReader: Array<{ bucket: string; readers: number }>;
  supply: {
    submitted: number;
    approved: number;
    refused: number;
    pending: number;
    activeAuthors: number;
    medianReviewHours: number;
  };
  catalog: {
    published: number;
    publishedRecently: number;
    readersPastHalf: number;
    medianSeenShare: number;
  };
  dataQuality: {
    reads: number;
    readsWithOutcome: number;
    sessions: number;
    sessionsWithoutOutcome: number;
    unattributedEvents: number;
    outcomesWithoutTime: number;
  };
};

export type BoksGrowth = {
  weeks: number;
  weekly: Array<{
    week: string;
    activeReaders: number;
    newReaders: number;
    signups: number;
    sessions: number;
    minutes: number;
    boksFinished: number;
    boksPublished: number;
  }>;
  cohorts: Array<{ week: string; size: number; retained: Array<{ offset: number; readers: number }> }>;
  activation: { newReaders: number; finishedOne: number; finishedThree: number; signedUp: number };
  stickiness: { daily: number; weekly: number; monthly: number };
  totals: { readers: number; accounts: number; minutes: number; boksFinished: number; publishedBoks: number };
};

export type BoksPersonRow = {
  userId: string;
  email: string;
  handle: string | null;
  role: BoksUserRole;
  displayName: string;
  joinedAt: string;
  lastSignInAt: string;
  lastReadAt: string | null;
  minutes: number;
  boksOpened: number;
  boksFinished: number;
  sessions: number;
  algorithmId: string | null;
  bannedAt: string | null;
  banReason: string | null;
};

export type BoksContentRow = {
  id: string;
  title: string;
  authorName: string;
  authorHandle: string;
  genre: string;
  mood: string;
  estimatedMinutes: number;
  wordCount: number;
  minutes: number;
  readers: number;
  starts: number;
  completes: number;
  skips: number;
  likes: number;
  comments: number;
  finishRate: number | null;
  status: "published" | "archived";
  archivedAt: string | null;
  archiveReason: string | null;
  archivedBy: string | null;
};

/** Every state a boks can be in, as the admin inspector shows it. */
export type AdminBokStatus = "draft" | "pending_review" | "published" | "rejected" | "archived";

/**
 * One boks as the admin inspector reads it (`get_admin_bok`). Metrics use the
 * same definitions as `BoksContentRow`, so the two never disagree.
 */
export type AdminBokDetail = {
  id: string;
  title: string;
  body: string;
  status: AdminBokStatus;
  language: string | null;
  genre: string;
  mood: string;
  estimatedMinutes: number;
  wordCount: number;
  isSeed: boolean;
  imported: boolean;
  authorName: string;
  authorHandle: string;
  authorUserId: string | null;
  authorEmail: string | null;
  createdAt: string;
  submittedAt: string | null;
  updatedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
  archiveReason: string | null;
  rights: { confirmed: boolean; note: string | null; confirmedAt: string } | null;
  metrics: {
    minutes: number;
    readers: number;
    impressions: number;
    starts: number;
    completes: number;
    skips: number;
    shares: number;
    likes: number;
    comments: number;
    reports: number;
    openReports: number;
    finishRate: number | null;
    lastReadAt: string | null;
  };
  comments: {
    id: number;
    body: string;
    createdAt: string;
    userId: string;
    handle: string | null;
    parentCommentId: number | null;
    likes: number;
  }[];
  likers: { userId: string; handle: string | null; likedAt: string }[];
};

/** A boks in one of the person inspector's lists. */
export type AdminPersonBok = {
  id: string;
  title: string;
  status: AdminBokStatus;
  authorName?: string;
  at: string;
};

/**
 * One account as the admin inspector reads it (`get_admin_person`). Reading
 * metrics use the same definitions as `BoksPersonRow`.
 */
export type AdminPersonDetail = {
  userId: string;
  email: string;
  isAnonymous: boolean;
  handle: string | null;
  role: BoksUserRole;
  joinedAt: string;
  lastSignInAt: string;
  termsAcceptedAt: string | null;
  readingLanguages: string[];
  bannedAt: string | null;
  banReason: string | null;
  bannedBy: string | null;
  algorithmId: string | null;
  metrics: {
    minutes: number;
    minutesLast7Days: number;
    minutesLast30Days: number;
    sessions: number;
    boksOpened: number;
    boksFinished: number;
    skips: number;
    activeDays: number;
    firstReadAt: string | null;
    lastReadAt: string | null;
    likesGiven: number;
    commentsWritten: number;
    authored: { total: number; published: number; pending: number; rejected: number; archived: number };
    likesReceived: number;
    commentsReceived: number;
    readersReached: number;
    followers: number;
    following: number;
  };
  /** Days with reading in the last 30; empty days are omitted. */
  activity: { day: string; minutes: number; boks: number }[];
  authoredBoks: { id: string; title: string; status: AdminBokStatus; createdAt: string; likes: number; comments: number; readers: number }[];
  likedBoks: AdminPersonBok[];
  comments: { id: number; body: string; at: string; isReply: boolean; reelId: string; title: string; status: AdminBokStatus }[];
  readBoks: (AdminPersonBok & { activeSeconds: number; finished: boolean })[];
};

export type ReaderProfile = {
  completed: string[];
  liked: string[];
  skipped: string[];
  genreScore: Record<string, number>;
  moodScore: Record<string, number>;
};

export type BoksUserRole = "reader" | "admin";

export type BoksUserContext = {
  userId: string | null;
  email: string | null;
  isAnonymous: boolean;
  role: BoksUserRole;
  /** The @nickname. A person has one name, and this is it. */
  handle: string | null;
  preferredGenre: string;
  preferredMood: string;
  termsAcceptedAt: string | null;
  termsVersion: string | null;
  hasAnyAdmin: boolean;
  views: number;
  likes: number;
  /**
   * Languages this reader accepts. Empty means they have not said, and
   * everything is eligible - never "nothing is".
   */
  readingLanguages: string[];
  /** Published boks per language, so an empty feed can explain itself. */
  languageCoverage: Record<string, number>;
  /** A suspended account may continue reading, but cannot publish or interact. */
  bannedAt: string | null;
  banReason: string | null;
};

/** An author as the reader meets them: who they are, and what they have written. */
/** One writer a publishing account has published, with how much of them. */
export type AuthorProfileWriter = {
  name: string;
  boks: number;
};

export type AuthorProfile = {
  /** Empty for the seeded catalog, which has a byline but no account. */
  authorUserId: string;
  authorName: string;
  authorHandle: string;
  /**
   * Set when the sheet is showing one writer inside a publisher's catalogue.
   * The account is what a reader can follow; the byline is who wrote it.
   */
  byline: string | null;
  followers: number;
  following: boolean;
  /** How many the whole scope holds, which may exceed the page of `boks`. */
  totalBoks: number;
  /** The writers this account publishes. Empty for an author's own account. */
  writers: AuthorProfileWriter[];
  boks: AuthorBok[];
};

export type AuthorBok = {
  id: string;
  title: string;
  minutes: number;
  readingShape: string;
  createdAt: string;
  /** The byline on this piece, when the account printed one. */
  authorName?: string | null;
};

export type ReaderLibraryItem = {
  storyId: string;
  title: string;
  authorName: string;
  /** Every boks has one; shown when there is no byline. */
  authorHandle?: string | null;
  minutes: number;
  readAt: string | null;
  likedAt: string | null;
  commentedAt: string | null;
  liked: boolean;
  commented: boolean;
};

export type BokReviewStatus = "draft" | "pending_review" | "published" | "rejected" | "archived";

export type AuthorBokSubmission = {
  id: string;
  title: string;
  body: string;
  genre: string;
  mood: string;
  /** The byline this piece was submitted under. Empty means the @handle alone. */
  authorName: string;
  wordCount: number;
  likes: number;
  comments: number;
  /** When an admin approved it, or null while it is not published. */
  publishedAt: string | null;
  minutes: number;
  status: BokReviewStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
};

export type AdminModerationItem = AuthorBokSubmission & {
  authorName: string;
  authorHandle: string;
  body: string;
  authorUserId: string | null;
  authorEmail: string;
};

export type AdminUserRow = {
  userId: string;
  email: string;
  role: BoksUserRole;
  displayName: string;
  createdAt: string;
  lastSignInAt: string;
  views: number;
  likes: number;
};

export type AuthorBokQuota = BokSubmissionQuota;

export type LoadOptions = {
  view?: "reader" | "admin";
  limit?: number;
  offset?: number;
  q?: string;
  sort?: string;
  visitorId?: string;
  /** Behavioral affinity used by personalized strategies. */
  reader?: ReaderSignals;
  /** Reading session this feed belongs to, recorded with its provenance. */
  sessionId?: string;
  /** The reader profile the ranking saw, stored verbatim so it can be replayed. */
  profileSnapshot?: Record<string, unknown>;
  /** Languages a guest accepts; a signed-in reader's stored set wins. */
  readingLanguages?: readonly string[];
  /**
   * Add the new slate after the one on screen instead of replacing it - how
   * the reader keeps going past the end of a slate. Boks already in the feed
   * are skipped, so nothing repeats and nothing the reader passed moves.
   */
  append?: boolean;
};

export type ReadOutcome = "complete" | "skip";

/** An account boks may be imported into, and what it already holds. */
export type BoksPublisher = {
  handle: string;
  userId: string;
  published: number;
  imported: number;
  followers: number;
};

export type BoksImportRowResult = {
  index: number;
  importKey: string | null;
  status: "imported" | "skipped" | "rejected";
  reason?: string;
  id?: string;
};

export type BoksImportReport = {
  publisher: string;
  status: "published" | "pending_review";
  results: BoksImportRowResult[];
  imported: number;
  skipped: number;
  rejected: number;
};

/** One reader complaint, as an admin sees it: the grievance beside the claim. */
export type BoksReport = {
  id: string;
  reelId: string;
  title: string;
  authorHandle: string | null;
  authorName: string | null;
  bokStatus: string;
  kind: "copyright" | "other";
  reason: string;
  status: "open" | "actioned" | "dismissed";
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  reporterHandle: string | null;
  rightsConfirmed: boolean | null;
  rightsNote: string | null;
};

/** A bok nobody has vouched for - published before the record, or withdrawn. */
export type BoksUnattested = {
  reelId: string;
  title: string;
  authorHandle: string | null;
  bokStatus: string;
  note: string | null;
  createdAt: string;
};

export type BoksRightsReview = {
  openReports: number;
  unattested: number;
  reports: BoksReport[];
  unattestedBoks: BoksUnattested[];
};

/**
 * Reading by slate position, per arm. The sequential dimension of the feed:
 * two arms can reach the same completion rate for opposite reasons, and
 * position is what separates better retrieval from better ordering.
 */
export type SlatePositionRow = {
  algorithmId: string;
  position: string;
  readers: number;
  impressions: number;
  starts: number;
  completes: number;
  skips: number;
  reactions: number;
  activeSeconds: number;
};

/** Supply against demand for one language: the content-acquisition signal. */
export type LanguageDemandRow = {
  language: string;
  published: number;
  readers: number;
  /** Readers who accept only this language - an empty app if published is 0. */
  readersOnly: number;
};

/** One reader's note, as the admin console reads it. */
export type BoksFeedbackRow = {
  id: number;
  message: string;
  surface: "settings" | "after_3" | "after_10" | "after_30" | "other";
  boksRead: number;
  handle: string | null;
  isAnonymous: boolean;
  userId: string;
  visitorId: string;
  createdAt: string;
};

export type BoksFeedbackPage = {
  total: number;
  newToday: number;
  bySurface: Record<string, number>;
  rows: BoksFeedbackRow[];
};

/** The guest funnel, counted by device. See `get_guest_funnel`. */
export type GuestFunnel = {
  days: number;
  since: string;
  /** When sign-up prompts and link requests started being recorded. */
  journeySince: string | null;
  /** When visits started carrying a country. */
  countriesSince: string | null;
  team: { devices: number; marked: number; included: boolean };
  hiddenCountries: string[];
  countries: { country: string; devices: number; guests: number; readers: number; accounts: number }[];
  knownCountries: { country: string; devices: number }[];
  funnel: {
    guests: number;
    startedReading: number;
    finishedOne: number;
    finishedThree: number;
    cameBack: number;
    sawSignup: number;
    requestedLink: number;
    createdAccount: number;
  };
  /**
   * Whether guests put a hand on a bok at all. Devices, except `swipes`,
   * `boksShown` and `boksTouched`. `tapped` and `scrolled` go by the first
   * touch on each bok and start at `since`; `swiped` comes from the outcomes
   * and covers the whole window. Absent from a database before the migration.
   */
  hands?: {
    since: string | null;
    shown: number;
    touched: number;
    tapped: number;
    scrolled: number;
    swiped: number;
    swipes: number;
    boksShown: number;
    boksTouched: number;
  };
  readsPerGuest: { none: number; oneOrTwo: number; threeToNine: number; tenToFourteen: number; fifteenPlus: number };
  medianGuestMinutes: number | null;
  limit: { hit: number; requested: number; converted: number };
  prompts: { reason: string; prompts: number; requests: number }[];
  sources: {
    landing: { value: string; visits: number }[];
    referrer: { value: string; visits: number }[];
    campaign: { value: string; visits: number }[];
  };
  daily: {
    day: string;
    guests: number;
    newGuests: number;
    /** Guest devices shown a bok, touching one, moving on to another. Absent before 20261014150000. */
    shown?: number;
    touched?: number;
    swiped?: number;
    readers: number;
    /** Reading time of the middle guest device that day. */
    medianSeconds?: number | null;
    /** Guest devices by country; "none" is a device the Worker never saw - the local dev server. */
    countries?: { country: string; devices: number }[];
    prompts: number;
    requests: number;
    newAccounts: number;
  }[];
};

/** One day opened up, device by device. See `get_guest_day`. */
export type GuestDay = {
  day: string;
  devices: GuestDayDevice[];
};

export type GuestDayDevice = {
  /** The last six characters of the device id: enough to tell rows apart. */
  device: string;
  country: string | null;
  guest: boolean;
  account: boolean;
  returning: boolean;
  firstAt: string;
  lastAt: string;
  visits: {
    at: string;
    landing: string;
    referrer: string | null;
    campaign: string | null;
    /** The tracked link's label, or its code. */
    link: string | null;
    /** The bok a shared link landed on. */
    bok: string | null;
  }[];
  prompts: string[];
  requested: boolean;
  boks: GuestDayBok[];
};

export type GuestDayBok = {
  title: string;
  at: string;
  seconds: number;
  /** The first touch on it: tap, scroll, swipe or key. */
  touch: string | null;
  finished: boolean;
  /** How it was left: swipe, button, keyboard, exit. */
  leftBy: string | null;
  liked: boolean;
  shared: boolean;
};

/** What one tracked link, or one landed bok, brought - counted by arriving device. See `get_link_attribution`. */
export type LinkArrivalStats = {
  /** Sessions that arrived (one visit per session). */
  visits: number;
  /** Distinct devices that arrived; the denominator of every count below. */
  devices: number;
  /** Devices that arrived without an account; the denominator of `createdAccount`. */
  guests: number;
  startedBok: number;
  finishedBok: number;
  /** Opened the landed bok's production (cinema or immersive poem). */
  openedFormat: number;
  /** Finished at least one bok other than the one they landed on. */
  readAnother: number;
  finishedThree: number;
  /** Read again on a later UTC day than they arrived. */
  cameBack: number;
  /** Guests at arrival who then read as an account created after arriving. */
  createdAccount: number;
  minutes: number;
  medianMinutes: number | null;
  firstVisit: string | null;
  lastVisit: string | null;
};

export type TrackedLinkReport = {
  code: string;
  label: string;
  bokId: string | null;
  bokTitle: string | null;
  bokAuthor: string | null;
  createdAt: string;
  archived: boolean;
  referrers: { value: string; visits: number }[];
  stats: LinkArrivalStats;
};

export type LandedBokReport = {
  bokId: string;
  bokTitle: string;
  bokAuthor: string | null;
  /** Of the arriving devices, how many came through a tracked link rather than a reader's share. */
  throughLinks: number;
  stats: LinkArrivalStats;
};

export type LinkAttribution = {
  days: number;
  since: string;
  /** When visits started carrying the landed bok and the link. */
  trackedSince: string | null;
  links: TrackedLinkReport[];
  boks: LandedBokReport[];
};
