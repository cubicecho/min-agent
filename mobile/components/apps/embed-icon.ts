import type { EmbedIcon } from "@shared/types.ts";
import {
  Activity,
  BookOpen,
  Box,
  Clipboard,
  Columns2,
  Database,
  Globe,
  LayoutGrid,
  List,
  SquareCheck,
  SquareKanban,
} from "@/components/app/app-icons";
import { Calendar } from "@/components/ui/icons";

/**
 * The glyph for each stored embed icon name.
 *
 * The names are the ones the database already holds, from when the app drew Feather; the
 * glyphs are lucide's, which is what cubeui draws. A `Record` over `EmbedIcon`, so a name
 * added to `EMBED_ICONS` without a glyph here is a type error rather than a blank row.
 *
 * `trello` is lucide's kanban board: lucide dropped its brand marks, the Trello one included.
 */
export const EMBED_ICON: Record<EmbedIcon, typeof Calendar> = {
  grid: LayoutGrid,
  columns: Columns2,
  trello: SquareKanban,
  "check-square": SquareCheck,
  list: List,
  calendar: Calendar,
  clipboard: Clipboard,
  "book-open": BookOpen,
  database: Database,
  activity: Activity,
  box: Box,
  globe: Globe,
};
