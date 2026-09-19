import { Bricolage_Grotesque, Figtree } from "next/font/google";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-display",
});
const body = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
});

// Wraps the login and dashboard pages with the product's fonts and colors.
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${display.variable} ${body.variable} min-h-screen bg-[#F6F8F5] text-[#12251F]`}
      style={{ fontFamily: "var(--font-body), system-ui, sans-serif" }}
    >
      {children}
    </div>
  );
}

export const displayFont = { fontFamily: "var(--font-display), system-ui, sans-serif" };
