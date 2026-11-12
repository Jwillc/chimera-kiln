import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { KilnPage } from "./KilnPage.tsx";

export function mount(root: HTMLElement): void {
  root.replaceChildren();
  createRoot(root).render(
    <StrictMode>
      <KilnPage />
    </StrictMode>,
  );
}
