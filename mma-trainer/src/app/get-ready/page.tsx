import { Suspense } from "react";
import GetReadyClient from "./GetReadyClient";

export default function GetReadyPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        </div>
      }
    >
      <GetReadyClient />
    </Suspense>
  );
}
