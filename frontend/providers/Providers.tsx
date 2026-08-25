"use client";

import ReactQueryProvider from "./ReactQueryProvider";
import { AuthInitializerProvider } from "./authInitializer"; // import the new provider
  // ...compat.extends("next/core-web-vitals", "next/typescript"),
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ReactQueryProvider>
      <AuthInitializerProvider>{children}</AuthInitializerProvider>
    </ReactQueryProvider>


  );
}
