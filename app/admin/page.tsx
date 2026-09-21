import { BoksErrorBoundary } from "@/components/boks/error-boundary";
import { AdminDashboard } from "../boks-client";

export default function AdminPage() {
  return (
    <BoksErrorBoundary>
      <AdminDashboard />
    </BoksErrorBoundary>
  );
}
