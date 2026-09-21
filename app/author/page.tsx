import { BoksErrorBoundary } from "@/components/boks/error-boundary";
import { AuthorConsole } from "../boks-client";

export default function AuthorPage() {
  return (
    <BoksErrorBoundary>
      <AuthorConsole />
    </BoksErrorBoundary>
  );
}
