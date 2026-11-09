import { BoksErrorBoundary } from "@/components/boks/error-boundary";
import { AuthorCabinet } from "../boks-client";

export default function AuthorPage() {
  return (
    <BoksErrorBoundary>
      <AuthorCabinet />
    </BoksErrorBoundary>
  );
}
