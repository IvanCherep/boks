import type { Metadata } from "next";
import { BoksErrorBoundary } from "@/components/boks/error-boundary";
import { StudyPage } from "@/components/boks/studies/study-page";

/**
 * A study participant's page (`docs/studies.md`). Not indexed: it is reached
 * by a link the team hands out, and says nothing while the study is off.
 */
export const metadata: Metadata = {
  title: "boks study",
  robots: { index: false, follow: false },
};

export default async function StudyRoute({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return (
    <BoksErrorBoundary v44>
      <StudyPage studyKey={key} />
    </BoksErrorBoundary>
  );
}
