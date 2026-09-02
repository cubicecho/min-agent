# Building the Android app

This app cannot run in Expo Go. `@react-native-vector-icons/feather` ships an Android
library and a config plugin, `expo-audio` writes the microphone permission into the
manifest, and `expo-build-properties` turns the cleartext allowance back on — three things
that are decided when the binary is compiled, and none of them are in Expo Go's. Every run
needs a native build: a **development build** to attach Metro to, and **EAS Build** for the
APKs you hand to people. A local Gradle build is the fallback if you have the Android
toolchain.

`mobile/android/` is not committed: the native project is generated from `app.json` by
`expo prebuild` (continuous native generation).

The bundle reaches outside `mobile/` for exactly one thing — `@shared/*`, which Metro
watches at the repo root — and that matters here because **EAS uploads the git repository,
not the project directory**: the archive is made from the repo root and the build then runs
in `mobile/`, so `shared/` comes along on its own. It works because `shared/gql/` is
generated but *committed* (CI enforces that it is current). Nothing to do; just don't
untrack it.

`mobile/` has its own `package.json` and its own lockfile rather than being a workspace of
the root, so EAS installs from `mobile/package-lock.json` and the server's dependencies
never reach the bundle. The root install is not involved in an EAS build at all.

## EAS builds

Nothing to install but the CLI, and no Android SDK anywhere.

```sh
npm i -g eas-cli
eas login
npm --prefix mobile run apk:eas      # eas build -p android --profile preview
```

`eas.json` has three profiles:

| profile       | output                     | for                                |
| ------------- | -------------------------- | ---------------------------------- |
| `development` | APK, dev client            | Metro-attached builds on a device  |
| `preview`     | APK, internal distribution | the test builds you hand to people |
| `production`  | AAB                        | Play Store uploads                 |

The build runs in the cloud and ends with a download link and a QR code for installing
straight onto a phone.

### Which agent it talks to

An EAS build has no `EXPO_PUBLIC_AGENT_URL`. `scripts/expo.ts` bakes that in from `.env`
when *you* start Expo, and nothing on Expo's builders reads your `.env` — so a build from
here falls back to `http://localhost:8787`, which on a phone is the phone. Set the address
on the device: **Settings → Server**. It is saved in `AsyncStorage` and wins over anything
baked in, which is the same reason an installed APK survives the agent moving.

Baking one in anyway is a matter of putting `EXPO_PUBLIC_AGENT_URL` in the profile's `env`
in `eas.json`, or in an EAS environment variable. Don't, unless the build is for one
network: it is compiled into the bundle, and the update that changes it is a new build.

### Plain-HTTP servers

Android refuses cleartext HTTP on target SDK 28+, and Expo's template waives that for
**debug** builds only — so a Metro-attached app reaches `http://server.lan:8787` happily
while a release APK of the same commit fails with `CLEARTEXT communication to … not
permitted by network security policy`.

`expo-build-properties`' `usesCleartextTraffic` in `app.json` puts it back, on every
profile including `production`. That is deliberate and not eunomia's arrangement: the agent
is a LAN server, the package name says so (`lan.minagent.app`), and a production build that
cannot talk to `http://` would be a production build that cannot talk to anything. Put the
agent behind TLS and the allowance simply goes unused.

### One-time account setup

1. **`eas init`** — done. The project is
   [`@cubicecho/min-agent`](https://expo.dev/accounts/cubicecho/projects/min-agent), and
   its id is in `extra.eas.projectId` in `app.json`, which is what every later build, and
   CI, is filed under.

2. **A keystore.** EAS generates and stores one for you, but a `--non-interactive` build
   (which is all CI ever runs) can't answer the prompt that creates it. Do it once, up
   front:

   ```sh
   cd mobile && eas credentials:configure-build -p android -e preview
   ```

   Everything EAS signs from then on shares that key, which is the point: consecutive test
   builds install over each other instead of colliding as different apps. It lives on
   Expo's servers — `eas credentials` downloads a copy, and you want one somewhere safe.

3. **`EXPO_TOKEN` for CI** — a token from
   [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens), stored as a
   repository secret named `EXPO_TOKEN` (Settings → Secrets and variables → Actions). A
   personal token carries your whole account; since this project lives under the
   `cubicecho` org, a **robot user** with a build role is the tighter choice — org settings
   on expo.dev creates one, and it can't log in anywhere, only hold a token.

### In CI

[`.github/workflows/android.yml`](../.github/workflows/android.yml) ships the app on every
push to `main` that touches it (`mobile/` outside `electron/`, or `shared/`), and on demand
from the Actions tab — **Run workflow** takes a profile, so `production` is a click away
without editing anything.

Whether shipping means an update or a build is the fingerprint's call; see "How CI chooses"
below. A build is triggered with `--no-wait` and the job exits: it doesn't hold a runner in
the EAS queue, the build page is linked from the run summary, and the APK downloads from
there once EAS finishes. An update is published outright, in seconds — so on the build path
a green run means EAS accepted the job, while on the update path it means the update is
already live. Until `EXPO_TOKEN` exists the workflow skips with a warning instead of
failing — nothing is red just because the secret hasn't been added yet.

Version numbers are EAS's job (`cli.appVersionSource` is `remote`, with `autoIncrement` on
`preview` and `production`), so `versionCode` climbs on its own and no build needs a commit
to bump it. The `versionCode` still in `app.json` is ignored by EAS and used only by a
local Gradle build.

### Where it shows up

Every ship lands on the repo's Releases page, one release per **binary** — a channel plus a
native fingerprint. A build creates it, and every update later published against that same
fingerprint appends a line to it, which is what a phone actually runs: one APK plus the
newest update its runtime accepts. So the list stays one row per native runtime rather than
one row per merge.

| you want to know               | look at                                                    |
| ------------------------------ | ---------------------------------------------------------- |
| what production runs           | the newest release *without* a pre-release badge            |
| what the testers hold          | the newest release *with* one — `preview` is always flagged, so "Latest" stays on production |
| what shipped since that binary | the update list inside that release, newest first           |
| the APK, or a build's progress | the *open in EAS* link in the release's Binary section      |

The tag — `android-preview-9f3c1a2b4d5e` — is the channel and the first twelve characters
of the fingerprint. Ugly on purpose: it is the one name both lanes can compute, since an
update knows the fingerprint it was published against but not the version number of the
binary it will land on.

These releases are the Android app's, and they are not the repo's Docker releases: those
come from semantic-release on the same branch and are tagged `v1.13.2`. Two tag shapes, two
things being shipped, no overlap.

Nothing is attached to the release. EAS keeps the artifact, and the build step returns
before it exists — so the release links to the build page instead, which is also where the
QR code for installing onto a phone lives. A release whose binary was built by hand rather
than by CI says so in its Binary section.

The body is generated from a JSON block embedded in it (an HTML comment, so it does not
render), read back and re-rendered on every ship. Editing a release by hand is therefore
fine for prose that will be overwritten and pointless for anything else; change
[`.github/scripts/android-release.mjs`](../.github/scripts/android-release.mjs) instead,
and the next ship re-renders the whole history in the new shape.

To run a profile on your own machine instead — same recipe, no queue, but it needs the
toolchain below:

```sh
npm --prefix mobile run apk:eas:local
```

## Over-the-air updates

Most commits here change TypeScript and nothing else, and a twenty-minute build to ship a
changed string is twenty minutes plus an APK everyone has to reinstall by hand. EAS Update
publishes the JavaScript bundle and its assets to a channel; the installed app fetches it
and runs it on its next launch. No build, no reinstall.

What an update can carry, and what it can't:

| changed                                       | ships as  |
| --------------------------------------------- | --------- |
| anything under `app/`, `components/`, `lib/`  | an update |
| `shared/` — the client half, the types, the generated GraphQL | an update |
| `global.css` and the NativeWind styles        | an update |
| assets the bundler resolves                   | an update |
| the plugin list, or any plugin's options      | a build   |
| the cleartext allowance, the microphone permission | a build |
| the app icon, the package name, the scheme    | a build   |
| the SDK, or any native dependency             | a build   |

Nobody has to remember that table. `runtimeVersion` is `{ "policy": "fingerprint" }` — a
hash over everything that determines the binary: the SDK, the native dependency set, the
config plugins. An update carries the fingerprint it was published against and a build only
accepts updates that match, so an update needing native code the phone doesn't have is not
something it can install.

The alternative, `appVersion`, would have tied compatibility to `"version": "1.0.0"` — a
string nobody in this repo maintains, since the version that moves is the server's, in the
root `package.json`, and EAS owns the build numbers.

### Channels

A build carries the channel of the profile that made it, and an update is published to a
channel — so the profile table above is also the routing table:

| profile / channel | who is on it                            |
| ----------------- | --------------------------------------- |
| `development`     | dev builds (updates are off in them)    |
| `preview`         | the testers holding an APK              |
| `production`      | Play Store installs                     |

A locally built APK (`npm --prefix mobile run apk`) is on no channel at all — EAS is what
stamps one into the manifest — so it never receives an update. Same separation as the
keystore: local builds are their own world.

Nothing needs creating up front. `eas build` creates the channel the first time a profile
with that name builds, and `eas update --channel preview` creates the branch it points at.
`eas channel:edit` is for later, when you want a channel pointing at a branch of a
different name — rolling `production` back onto an older one, say.

### How CI chooses

The workflow fingerprints the commit, then asks EAS whether a finished build **on that
channel** already carries the same fingerprint. If one does, the APK people have installed
can run this commit's JavaScript, so it publishes an update. If none does, the native
runtime changed and it starts a build. The run summary says which happened, and links to it
— as does the release it records the ship into.

It asks per channel rather than by hash alone because `preview` and `production` evaluate
to the same app config and therefore fingerprint identically, while shipping different
artifacts. Matching on the hash alone would find the AAB and skip the APK the testers are
actually on.

Forcing a build is a click: **Run workflow** → *Build a binary even if one already matches
the fingerprint*.

To publish by hand:

```sh
npm --prefix mobile run update -- --message "why"
```

`--environment` is required from SDK 55 on. It selects which EAS environment's variables
are visible while the app config is evaluated — a formality here, since the address the app
talks to is in Settings on the phone rather than in the bundle.

To take an update back: `eas update:rollback`, or publish the previous commit again.

### What a phone does with it

`updates.checkAutomatically` is `ON_LOAD` and `fallbackToCacheTimeout` is `0`: every launch
checks, downloads in the background, and runs the bundle it already has in the meantime.
Startup is never held up waiting on the network. The new bundle runs on the launch after
the one that fetched it.

## Local builds

### One-time setup

1. **JDK 17 or newer.** Gradle 8 / AGP 8 refuse anything older; if `java -version` says
   1.8, point `JAVA_HOME` at a modern one:

   ```sh
   export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
   ```

2. **Android SDK.** Either install Android Studio, or just the command-line tools:

   ```sh
   export ANDROID_HOME="$HOME/Android/Sdk"
   mkdir -p "$ANDROID_HOME/cmdline-tools"
   # download commandlinetools-linux-*.zip from
   # https://developer.android.com/studio#command-line-tools-only
   unzip commandlinetools-linux-*.zip -d "$ANDROID_HOME/cmdline-tools"
   mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
   export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"
   yes | sdkmanager --licenses
   sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
   ```

   Gradle downloads whatever else the build asks for. Keep `JAVA_HOME`, `ANDROID_HOME` and
   the `PATH` additions in your shell profile.

### A test APK

```sh
npm --prefix mobile run apk
```

That prebuilds `mobile/android/` and runs `./gradlew assembleRelease`, leaving

```
mobile/android/app/build/outputs/apk/release/app-release.apk
```

Sideload it with `adb install -r <path>`, or copy it to the phone.

This APK is signed with the **debug** keystore Expo's template configures for the release
variant. That installs and upgrades over itself fine, but it is a different key from the
one EAS uses — so a locally built APK and an EAS one can't replace each other on a phone,
and neither is a distribution key. Bump `app.json`'s `android.versionCode` by hand for
local builds meant to replace one another; EAS handles its own. It is also on no update
channel, so it stays exactly the commit you built until you build again.

Prefer `assembleRelease` over `assembleDebug` for anything you hand to a tester: a debug
APK expects a Metro server on the network and does nothing useful without one.

### Iterating

```sh
npm run mobile              # Metro, with the agent's address baked in; press a for Android
npm run mobile:android      # straight to a connected device or emulator
```

Both go through `scripts/expo.ts`, which is what sets `EXPO_PUBLIC_AGENT_URL` — run them
from the repo root, not `npm --prefix mobile run start`, or the app will not know where the
agent is.

Now that `expo-dev-client` is installed, these attach to a **development build** on the
device rather than to Expo Go. Install one first, from EAS:

```sh
cd mobile && eas build --platform android --profile development
```

Only re-run `prebuild` when something native changes (`app.json`, a new native dependency).
JS and TypeScript changes reload over Metro — the same line that decides update-versus-build
in CI, for the same reason.
