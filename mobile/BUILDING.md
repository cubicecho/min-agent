# Building the Android app

This app cannot run in Expo Go: NativeWind's native stylesheet, the Feather icon
package, `expo-audio` and `expo-speech-recognition` are all native modules Expo Go
does not carry, so every
run needs a real build. Test APKs come from **EAS Build**; a local Gradle build
is a fallback if you have the Android toolchain, which you probably do not.

`android/` is not committed — the native project is generated from `app.json` by
`expo prebuild` every time, which is why every native detail in this document is
a line of `app.json` rather than a file someone edited once.

**EAS uploads what git tracks, from the repository root, not from `mobile/`.**
That matters here because half the client is in `shared/` — the transport, the
API calls, the stream reader, the usage formatting — and Metro reaches it through
`watchFolders`. It works because `shared/` is tracked; nothing needs configuring,
but don't move it somewhere ignored.

## EAS builds

Nothing to install but the CLI, and no Android SDK anywhere.

```bash
npm i -g eas-cli
eas login
npm run mobile:apk        # eas build -p android --profile preview
```

`eas.json` has three profiles:

| profile       | output                     | for                                |
| ------------- | -------------------------- | ---------------------------------- |
| `development` | APK, dev client            | Metro-attached builds on a device  |
| `preview`     | APK, internal distribution | the test builds you install        |
| `production`  | AAB                        | Play Store uploads                 |

The build runs in the cloud and ends with a download link and a QR code for
installing straight onto a phone.

### There is no default server address

A build does not know where your agent is, and it does not guess. Open
**Settings → Server** on first launch and put the address in —
`http://framework.lan:8787`, or whatever your VPN resolves. Every screen that
fails because the address is missing carries a button to that panel.

`EXPO_PUBLIC_AGENT_URL` still bakes an address in, but only via
`scripts/expo.ts`, which is the local development launcher — `npm run
mobile:web` and friends. EAS never runs it, so a downloaded APK arrives empty
rather than carrying a guess about a network it has never seen. That guess used
to be `http://localhost:8787`, which on a phone is the phone.

### Plain-HTTP servers

Android refuses cleartext HTTP on target SDK 28+, and Expo's template waives
that for **debug** builds only — so a Metro-attached app reaches
`http://framework.lan:8787` happily while an APK of the same commit fails with
`CLEARTEXT communication to … not permitted by network security policy`.

`app.json` puts it back through `expo-build-properties`, unconditionally, on
every profile including `production`. That is deliberate and it is the same
decision the server already makes: min-agent has no authentication at all, so it
is only ever safe on a network you trust, and the answer to reaching it from
outside is a VPN rather than TLS on the agent. A profile that refused cleartext
would not be more secure, only unable to talk to the server.

### The microphone

Dictation on Android goes through `expo-speech-recognition`, which is a config
plugin as well as a native module: the two permission strings under it in
`app.json` are what Android shows when the microphone button is first pressed,
and `RECORD_AUDIO` plus the `SPEECH_RECOGNITION` query are added to the manifest
by the plugin at prebuild. Editing either string is a JavaScript change; adding
or removing the plugin moves the fingerprint and needs a build.

The recogniser is the system one — the same engine behind the keyboard's
microphone key. Where the locale has an on-device model installed the app asks
for it and no audio leaves the phone; that needs Android 13 or later and the
language to have been downloaded already, under **Settings → System → Languages
→ Voice input**. Everywhere else the system falls back to whatever it normally
does, which for a Google build is Google. Point **Speech to text** at a
`tcp://` Wyoming server instead if that is not a trade you want to make.

## One-time account setup

1. **`eas init`** — done. It created `@cubicecho/min-agent` and wrote
   `extra.eas.projectId` and `owner` into `app.json`, which is why both are
   committed. Every later build, and CI, is filed under that id.

2. **A keystore.** EAS generates and stores one for you, but a
   `--non-interactive` build — which is all CI ever runs — cannot answer the
   prompt that creates it. Do it once, up front:

   ```bash
   eas credentials:configure-build -p android -e preview
   ```

   Everything EAS signs from then on shares that key, which is the point:
   consecutive test builds install over each other instead of colliding as two
   different apps. It lives on Expo's servers — `eas credentials` downloads a
   copy, and you want one somewhere safe.

3. **`EXPO_TOKEN` for CI** — a token from
   [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens),
   stored as a repository secret named `EXPO_TOKEN` (Settings → Secrets and
   variables → Actions). A personal token carries your whole account; since this
   project lives under the `cubicecho` org, a **robot user** with a build role is
   the tighter choice — org settings on expo.dev creates one, and it cannot log
   in anywhere, only hold a token.

## In CI

[`.github/workflows/android.yml`](../.github/workflows/android.yml) ships the app
on every push to `main` that touches it (`mobile/` outside `electron/`, or
`shared/`), and on demand from the Actions tab — **Run workflow** takes a
profile, so `production` is a click away without editing anything.

Whether shipping means an update or a build is the fingerprint's call.
`runtimeVersion` is `{ "policy": "fingerprint" }`: a hash over the SDK, the
native dependencies and the config plugins. If a finished build on the channel
already carries this commit's fingerprint, then the APK on your phone can run
this commit's JavaScript and only the JavaScript changed — so the run publishes
an over-the-air update, on the server in seconds. If the hash moved, the native runtime
moved with it, and only a new binary will do.

So: a screen, a component, anything under `shared/` — an update. Adding a
dependency with native code, changing a config plugin, bumping the SDK — a build.

A phone picks an update up by itself. expo-updates looks for one when the app
starts from cold, and the app looks again whenever it comes back to the screen,
at most every 15 minutes (`UPDATE_DEFAULTS` in `shared/defaults.ts`,
`mobile/lib/updates.ts`). Either way the update downloads in the background and
an **Update ready** banner offers a restart; nothing restarts on its own, because
a restart throws away whatever is half-typed. **Settings → Device → Updates**
looks right now. Only a binary with the same fingerprint takes an update, so a
phone on an older APK keeps its last compatible JavaScript until the new APK is
installed.

A build is waited for. The run holds its runner until EAS says the build
finished or failed — which can be hours when EAS's queue is long, so
the job allows close to six — and links the build page from the run summary in
the meantime. Holding a runner that long is free because the repo is public. So
a green run means what it says: on the build path the binary exists and is on
the Releases page, and on the update path the update is already live. A red
run on the build path means EAS failed the build (the error is annotated on the
run), and nothing was recorded. Builds used to be started with `--no-wait`,
which turned the run green the moment EAS accepted the job: from 4 to 20 October
ten builds in a row of one runtime failed behind green runs, and with no
finished binary for that runtime no update could ship either.

One build per runtime at a time. If a build with this commit's fingerprint is
already queued or running on the channel, the run waits on that one instead of
queueing another, then publishes this commit as an update on top of it. Runs on
a channel also take turns (a `concurrency` group per channel, never cancelled
mid-run), so pushes that land during a build queue behind it. GitHub keeps only
the newest of them waiting, and that one ships the newest commit, as an update,
once the build is done. **force_build** skips the finished builds, not one that
is still running.

On expo.dev the project is under the **cubicecho** account, and its builds are
under **Builds** in the project menu: they are `preview` builds, internal
distribution, which the overview's development and production cards do not
count. Until `EXPO_TOKEN` exists the workflow skips with a warning rather than
failing — nothing is red just because the secret has not been added yet.

To try the workflow without waiting for a push, run it from the Actions tab on
`preview`. Without **force_build** it does what a push would: an update when a
finished build has the fingerprint, and a build when none does. With it, it
always does a real build, which counts against the EAS plan.

Version numbers are EAS's job (`cli.appVersionSource` is `remote`, with
`autoIncrement` on `preview` and `production`), so `versionCode` climbs on its
own and no build needs a commit to bump it. The `versionCode` in `app.json` is
ignored by EAS and used only by a local Gradle build.

### Pulling one without waiting

An installed build checks for updates on launch, which is one relaunch more than you want while
you are working on the thing. **Settings → Device → Updates** does it on demand: one press
checks and downloads whatever is there, and a second restarts into it. The card also names what
is running — the channel, the native runtime fingerprint and the update's own id — which is the
quickest way to tell whether the phone in your hand is on the change you just pushed.

The button is absent in a Metro-attached build and on the web, because there is nothing there
for it to fetch: one serves its own JavaScript and the other is a page you can reload.

## Where it shows up

Every ship lands on the repo's Releases page, one release per **binary** — a
channel plus a native fingerprint. A build creates it once EAS has finished it,
and every update later published against that same fingerprint appends a line
to it, which is what a phone actually runs: one APK plus the newest update its
runtime accepts. So the list stays one row per native runtime rather than one
row per merge.

A preview release carries its APK as an asset, `min-agent-preview-<version>-<build>.apk`.
EAS deletes an internal build's download two weeks after the build, long before
the binary stops being what phones run, and a release asset on a public repo
downloads without a login. If copying it fails, the run warns, the release links
to EAS instead, and the next ship on that fingerprint tries again. A production
AAB is not attached: nobody installs one by hand.

| you want to know               | look at                                          |
| ------------------------------ | ------------------------------------------------ |
| what production runs           | the newest release *without* a pre-release badge  |
| what you have installed        | the newest release *with* one — `preview` is always flagged, so "Latest" stays on production |
| what shipped since that binary | the update list inside that release, newest first |
| the APK to install             | the asset on that release                         |

## The icon

`assets/icon.png`, `assets/adaptive-icon.png` and `assets/favicon.png` are
generated, not drawn: `node scripts/gen-icons.mjs` renders the mark — a terminal
prompt, `>_` — and writes all three, with the PNG encoder hand-rolled in that
file so regenerating needs no image tooling. `--preview` adds a large one to look
at. `assets/icon.svg` is the same geometry as a vector, written by hand; change
the mark and you change both.

## A local Gradle build

Only worth it if you already have the toolchain — JDK 17+ and the Android SDK,
neither of which EAS needs you to have.

```bash
npx expo prebuild -p android    # generates mobile/android/
npx expo run:android --variant release
```

Release builds are signed with Expo's template debug keystore, which is fine for
sideloading and is *not* the key EAS uses — so a locally built APK and an EAS one
will refuse to install over each other. Pick one lane per phone.

Note that `expo prebuild` rewrites this package's `android` script to
`expo run:android`. `git checkout mobile/package.json` afterwards, along with
`rm -rf mobile/android`, puts it back.
