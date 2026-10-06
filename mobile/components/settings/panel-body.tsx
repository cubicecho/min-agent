import type { ReactNode } from "react";
import { ScrollView } from "react-native";
import { PROSE_COLUMN } from "@/components/header-content-footer.tsx";
import { cn } from "@/lib/utils.ts";

/**
 * A panel's frame: padded, scrollable, on the app background, in the same column the config
 * panels use. The sections go in `content`.
 */
export function PanelBody({ content }: { content: ReactNode }) {
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName={cn(PROSE_COLUMN, "gap-4 p-4")}
      keyboardShouldPersistTaps="handled"
    >
      {content}
    </ScrollView>
  );
}
