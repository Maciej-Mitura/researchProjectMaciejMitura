import { HomePageClient } from "./components/homepage/HomePageClient";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-12 max-w-4xl">
        <HomePageClient />
      </main>
    </div>
  );
}
