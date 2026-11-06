import * as Updates from "expo-updates";
import { Alert } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Download, RefreshCw } from "@/components/ui/icons";
import { UPDATABLE, useForegroundUpdateCheck } from "@/lib/updates.ts";

/**
 * Says an update is downloaded and waiting, over every screen, until the app restarts into it.
 *
 * A banner rather than a toast: the update stays waiting until something is done about it, and
 * a toast would be gone while that was still true. It does not restart by itself, because a
 * restart throws away whatever is half-typed; it says so and leaves the moment to the reader.
 *
 * Nothing at all in a build that takes no updates — the browser, the desktop build, a
 * Metro-attached one — which is also what keeps `useUpdates` off the platforms it is not for.
 */
export function UpdateBanner() {
  return UPDATABLE ? <PendingUpdate /> : null;
}

function PendingUpdate() {
  useForegroundUpdateCheck();
  const { isUpdatePending, isRestarting } = Updates.useUpdates();

  const isUpToDate = isUpdatePending === false;
  if (isUpToDate) {
    return null;
  }

  return (
    <Alert
      variant="info"
      iconSlot={<Download />}
      title="Update ready"
      description="Restart to run it. Anything half-typed is lost."
      className="rounded-none"
      actionSlot={
        <Button
          size="sm"
          variant="outline"
          loading={isRestarting}
          onPress={() => void Updates.reloadAsync()}
          iconSlot={<RefreshCw className="size-4" />}
          content="Restart"
        />
      }
    />
  );
}
