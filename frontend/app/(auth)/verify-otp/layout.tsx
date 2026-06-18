import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Verify Email",
  description:
    "Enter the verification code sent to your email to complete your Oraculum account setup.",
  noindex: true,
});

export default function VerifyOtpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
