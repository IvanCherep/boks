import { BoksErrorBoundary } from "@/components/boks/error-boundary";
import { earlyLandingFrameScript, landingFrameSlotId } from "@/components/boks/author-landing/early-frame";
import { AuthorCabinet } from "../boks-client";

export default function AuthorPage() {
  return (
    <>
      {/* A guest's page for authors starts with this HTML, not after the app has loaded (early-frame.ts). */}
      <div id={landingFrameSlotId} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: "" }} />
      <script dangerouslySetInnerHTML={{ __html: earlyLandingFrameScript }} />
      <BoksErrorBoundary>
        <AuthorCabinet />
      </BoksErrorBoundary>
    </>
  );
}
