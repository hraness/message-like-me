"use client";

import { DesignPaletteProvider, StickyOffsetSync, ThemeColorSync } from "@hraness/design-kit/react";
import type { ReactNode } from "react";
import { Analytics } from "./_components/analytics";
import { FoilController } from "./_components/foil-controller";

export function Providers({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <DesignPaletteProvider defaultPreference={{ palette: "gruvbox", mode: "system" }} legacyStorageKey="hraness-design-theme-v1">
      <ThemeColorSync />
      <StickyOffsetSync />
      {children}
      <FoilController />
      <Analytics />
    </DesignPaletteProvider>
  );
}
