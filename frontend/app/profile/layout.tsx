// Shared helper that builds a Next.js Metadata object (SEO tags, Open Graph, etc.)
import { buildMetadata } from "@/lib/seo";

// Next.js reads this exported `metadata` constant to set the page <head> tags
// for every route under this layout.
export const metadata = buildMetadata({
  title: "Profile",
  description:
    "View and edit your Oraculum profile, update your personal information, and manage your account.",
  // Keep this private, user-specific page out of search engine results
  noindex: true,
});

// Pass-through layout: adds no markup of its own. It exists only so the
// segment can export `metadata` (a page marked "use client" can't export it).
export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Render the page content unchanged
  return children;
}