import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Terms of Service",
  description:
    "Read the Oraculum Terms of Service. Understand the rules and guidelines for using our platform.",
  keywords: ["terms of service", "legal", "Oraculum", "terms"],
});

export default function TermsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
