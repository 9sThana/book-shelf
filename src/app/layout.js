import { Anuphan, Prompt } from "next/font/google";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";

// Body text: Anuphan, a modern Thai + Latin sans (variable font, weights 100-700)
const anuphan = Anuphan({
  variable: "--font-anuphan",
  subsets: ["thai", "latin"],
  display: "swap",
});

// Headings and numbers: Prompt, a geometric Thai + Latin display sans
const prompt = Prompt({
  variable: "--font-prompt",
  subsets: ["thai", "latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

export const metadata = {
  title: "Morrow — Your personal library",
  description: "A modern, thoughtful home for your personal book collection.",
};

// Mobile: draw under the notch (the page adds safe-area padding) and colour the browser bar dark.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0f14",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${anuphan.variable} ${prompt.variable} h-full antialiased bg-[#0b0f14]`}
    >
      <body className="min-h-full flex flex-col bg-[#0b0f14] text-slate-100">
        {/* AuthProvider = <SessionProvider> so useSession() works in the page */}
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
