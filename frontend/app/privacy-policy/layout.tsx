// Shared helper that builds a Next.js Metadata object (SEO tags, Open Graph, etc.)
import { buildMetadata } from "@/lib/seo";

// Next.js reads this exported `metadata` constant to set the page <head> tags
// (title, description, keywords) for every route under this layout.
export const metadata = buildMetadata({
  title: "Privacy Policy",
  description:
    "Learn how Oraculum collects, uses, and protects your personal data. Your privacy matters to us.",
  keywords: ["privacy policy", "data protection", "Oraculum", "privacy"],
});

// Pass-through layout: adds no markup of its own. It exists only so the
// segment can export `metadata` (a page marked "use client" can't export it).
export default function PrivacyPolicyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Render the page content unchanged
  return children;
}