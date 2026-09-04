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
an over-the-air update, live in seconds. If the hash moved, the native runtime
moved with it, and only a new binary will do.

So: a screen, a component, anything under `shared/` — an update. Adding a
dependency with native code, changing a config plugin, bumping the SDK — a build.

A build is triggered with `--no-wait` and the job exits: it does not hold a
runner in the EAS queue, the build page is linked from the run summary, and the
APK downloads from there once EAS finishes. On the build path a green run means
EAS accepted the job; on the update path it means the update is already live.
Until `EXPO_TOKEN` exists the workflow skips with a warning rather than failing —
nothing is red just because the secret has not been added yet.

Version numbers are EAS's job (`cli.appVersionSource` is `remote`, with
`autoIncrement` on `preview` and `production`), so `versionCode` climbs on its
own and no build needs a commit to bump it. The `versionCode` in `app.json` is
ignored by EAS and used only by a local Gradle build.

## Where it shows up

Every ship lands on the repo's Releases page, one release per **binary** — a
channel plus a native fingerprint. A build creates it, and every update later
published against that same fingerprint appends a line to it, which is what a
phone actually runs: one APK plus the newest update its runtime accepts. So the
list stays one row per native runtime rather than one row per merge.

| you want to know               | look at                                          |
| ------------------------------ | ------------------------------------------------ |
| what production runs           | the newest release *without* a pre-release badge  |
| what you have installed        | the newest release *with* one — `preview` is always flagged, so "Latest" stays on production |
| what shipped since that binary | the update list inside that release, newest first |

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
