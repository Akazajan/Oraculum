import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Contact Us",
  description:
    "Get in touch with the Oraculum team. We're here to help with questions, feedback, or support.",
  keywords: ["contact", "support", "help", "Oraculum"],
});

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
