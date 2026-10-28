declare namespace Cloudflare {
  interface Env {
    BUCKET?: R2Bucket;
    /** Yandex AI Studio, for the fragment cutter's model stages: Worker secrets, never in source. */
    YANDEX_API_KEY?: string;
    YANDEX_FOLDER_ID?: string;
  }
}
