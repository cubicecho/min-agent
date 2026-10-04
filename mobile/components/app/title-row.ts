import { Platform } from "react-native";

/**
 * Centres a `PageHeader`'s title in the row it sits in — pass it as the header's `className`.
 *
 * The row has a floor (`min-h-14` at level 1) and wraps, and a wrapping row packs its lines at
 * the top: the title is centred in a line as tall as itself and the rest of the floor is an
 * empty band under it. Web only, where a child can be reached from the root; on a device the
 * band stays until the row centres its own lines (cubicecho/cubeui#248).
 */
export const TITLE_ROW = Platform.select({
  web: "[&>[data-testid=page-header-title-row]]:content-center",
  default: undefined,
});
