import { BoksErrorBoundary } from "@/components/boks/error-boundary";
import { ReaderFeed } from "./boks-client";

export default function Home() {
  return (
    <BoksErrorBoundary v44>
      <ReaderFeed />
    </BoksErrorBoundary>
  );
}
