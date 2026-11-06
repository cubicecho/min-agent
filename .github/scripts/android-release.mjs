#!/usr/bin/env node
// Records what the Android workflow just shipped as a GitHub Release, so the
// repo's Releases page answers "what is on people's phones right now?" without
// anyone opening the Actions tab.
//
// One release per *binary*, not per push: the tag is the channel plus the
// native fingerprint, a build creates it, and every later over-the-air update
// published against that same fingerprint appends a line to it. That is what a
// phone actually runs — one APK plus the newest update its runtime accepts — so
// the list stays one row per native runtime instead of one row per merge.
//
// It runs only once EAS has *finished* the binary it describes: the workflow
// waits for the build (see android-build.mjs) and skips this step when the
// build fails. A release recorded when EAS merely accepted the job could, and
// did, point at a build that later errored.
//
// The body is generated, never appended to as text: the state below is embedded
// as JSON in an HTML comment (which GitHub does not render), read back on the
// next ship, and the whole body re-rendered from it. Formatting changes apply
// retroactively, and an entry keyed on the commit and the update group makes a
// re-run idempotent rather than double-posting.
//
// Run from mobile/, where the EAS JSON and app.json live. Everything else
// arrives in the environment; see .github/workflows/android.yml.

import { execFileSync } from "node:child_process";
import { appendFileSync, createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const STATE_PATTERN = /<!-- min-agent-release\n([\s\S]*?)\n-->/;
// Out of the working tree: this runs from mobile/, and the body is `gh`'s
// input, not an artifact of the repo.
const NOTES_FILE = join(tmpdir(), "min-agent-release-notes.md");

const action = process.env.ACTION ?? "";
const profile = process.env.PROFILE ?? "preview";
const fingerprint = process.env.FINGERPRINT ?? "";
const sha = process.env.GITHUB_SHA ?? "";
const subject = process.env.COMMIT_SUBJECT ?? "";
const repoUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`;

/** Reads a file the EAS steps wrote, or undefined when that step never ran. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

// `allowFailure` is for the one lookup that is *expected* to fail — asking for a
// release that does not exist yet — so its "release not found" stays out of the
// log, where it would read like a problem.
function gh(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      stdio: allowFailure ? ["ignore", "pipe", "ignore"] : ["ignore", "pipe", "inherit"],
    }).trim();
  } catch (error) {
    if (allowFailure) {
      return undefined;
    }
    throw error;
  }
}

function summarize(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
  process.stdout.write(`${markdown}\n`);
}

/** The links the EAS CLI prints, rebuilt from the account, the slug and an id. */
function easUrl(project, kind, id) {
  if (!(project.account && project.slug && id)) {
    return undefined;
  }
  return `https://expo.dev/accounts/${project.account}/projects/${project.slug}/${kind}/${id}`;
}

function assetUrl(tag, name) {
  return `${repoUrl}/releases/download/${tag}/${name}`;
}

function commitLink(hash, text) {
  const short = hash.slice(0, 7);
  return `[\`${short}\`](${repoUrl}/commit/${hash})${text ? ` ${text}` : ""}`;
}

function link(text, url) {
  return url ? `[${text}](${url})` : text;
}

function day(iso) {
  return (iso ?? new Date().toISOString()).slice(0, 10);
}

function hasExpired(iso) {
  return Boolean(iso) && Date.parse(iso) <= Date.now();
}

// ---------------------------------------------------------------------------

// EAS keeps an internal build's download for two weeks and then deletes it, so
// a release that only links to expo.dev stops being installable from long
// before the binary stops being what phones run. The copy attached here does
// not expire.
function renderDownload(tag, binary) {
  if (binary.apk) {
    return [
      `- **${link("Download the APK", assetUrl(tag, binary.apk))}** — \`${binary.apk}\``,
      "",
      "The APK is attached to this release because EAS deletes its own copy two weeks after the build" +
        (binary.expiresAt ? ` (this one on ${day(binary.expiresAt)}).` : "."),
    ];
  }
  if (hasExpired(binary.expiresAt)) {
    return [
      "",
      `EAS deleted this build's download on ${day(binary.expiresAt)}, and no copy was attached here. Run the workflow with **force_build** for a fresh one.`,
    ];
  }
  if (binary.expiresAt) {
    return [
      "",
      `It downloads from the build page until EAS deletes it on ${day(binary.expiresAt)}.`,
    ];
  }
  return ["", "It downloads from the build page."];
}

function renderBinary(tag, state) {
  const { binary, project } = state;
  const version = binary.appVersion
    ? `**${binary.appVersion}${binary.appBuildVersion ? ` (${binary.appBuildVersion})` : ""}**`
    : "**version unknown**";
  const finished = binary.finishedAt ? `, finished ${day(binary.finishedAt)}` : "";
  const lines = [
    "## Binary",
    "",
    `- ${version} — profile \`${state.profile}\`${finished}, ${link("open in EAS", easUrl(project, "builds", binary.id)) || `build \`${binary.id ?? "unknown"}\``}`,
  ];
  if (binary.sha) {
    lines.push(
      `- Built from ${commitLink(binary.sha, binary.subject ? `— ${binary.subject}` : "")}`,
    );
  }
  lines.push(`- Fingerprint \`${state.fingerprint}\``);
  lines.push(...renderDownload(tag, binary));
  return lines.join("\n");
}

function renderUpdates(state) {
  const lines = ["## Updates on this binary", ""];
  if (state.updates.length === 0) {
    lines.push("None yet — the binary is the newest thing on this channel.");
    return lines.join("\n");
  }
  // What mobile/lib/updates.ts does: expo-updates checks on a cold start, the
  // app checks again when it comes back to the foreground, and either way the
  // restart is offered, never forced.
  lines.push(
    `Newest first. Each went live on \`${state.profile}\` the moment it published. A phone downloads it the next time the app starts from cold or comes back to the screen, then offers a restart.`,
    "",
  );
  for (const update of state.updates) {
    const target =
      link("open in EAS", easUrl(state.project, "updates", update.group)) || "this run’s log";
    lines.push(
      `- **${day(update.publishedAt)}** — ${commitLink(update.sha, update.subject)} — ${target}`,
    );
  }
  return lines.join("\n");
}

function renderBody(tag, state) {
  return [
    `Phones on the **${state.profile}** channel run this binary plus the newest update below.`,
    "",
    renderBinary(tag, state),
    "",
    renderUpdates(state),
    "",
    `<!-- min-agent-release\n${JSON.stringify(state, null, 2)}\n-->`,
    "",
  ].join("\n");
}

function parseState(body) {
  const match = body?.match(STATE_PATTERN);
  if (!match) {
    return undefined;
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------

function releaseTitle(state) {
  const { appVersion, appBuildVersion } = state.binary;
  const version = appVersion
    ? ` — ${appVersion}${appBuildVersion ? ` (${appBuildVersion})` : ""}`
    : "";
  return `Android ${state.profile}${version}`;
}

/** `--prerelease` keeps the "Latest" badge, and /releases/latest, on production. */
function prominenceFlags(state, verb) {
  const value = verb === "create" ? "" : "=true";
  return state.profile === "production" ? [`--latest${value}`] : [`--prerelease${value}`];
}

function publish(tag, state, existing) {
  writeFileSync(NOTES_FILE, renderBody(tag, state));
  if (existing) {
    gh([
      "release",
      "edit",
      tag,
      "--title",
      releaseTitle(state),
      "--notes-file",
      NOTES_FILE,
      ...prominenceFlags(state, "edit"),
    ]);
    return existing.url;
  }
  return gh([
    "release",
    "create",
    tag,
    "--target",
    state.binary.sha || sha,
    "--title",
    releaseTitle(state),
    "--notes-file",
    NOTES_FILE,
    ...prominenceFlags(state, "create"),
  ]);
}

// ---------------------------------------------------------------------------

/** Versioned, so a download names the build it came from. */
function apkName(state) {
  const { appVersion, appBuildVersion, id } = state.binary;
  const version = [appVersion, appBuildVersion].filter(Boolean).join("-") || id.slice(0, 8);
  return `min-agent-${state.profile}-${version}.apk`;
}

/**
 * Copies the APK from EAS onto the release, and drops any APK an earlier binary
 * of this fingerprint left there, so the release carries exactly the binary it
 * describes. Returns whether `state.binary.apk` changed.
 *
 * A failure here is a warning, not a red run: the binary and the release are
 * both real. It is also retried — every later ship on this fingerprint finds the
 * asset missing and tries again for as long as EAS still has the file.
 *
 * An AAB is left alone. Nobody installs one by hand, and Play already has it.
 */
async function attachApk(tag, state, assets) {
  const { binary } = state;
  if (!binary.artifactUrl?.endsWith(".apk")) {
    return false;
  }
  const name = apkName(state);
  const before = binary.apk;
  if (assets.some((asset) => asset.name === name)) {
    binary.apk = name;
    return before !== name;
  }
  binary.apk = undefined;
  if (hasExpired(binary.expiresAt)) {
    return before !== undefined;
  }

  try {
    const file = join(tmpdir(), name);
    const response = await fetch(binary.artifactUrl);
    if (!(response.ok && response.body)) {
      throw new Error(`EAS answered ${response.status} for ${binary.artifactUrl}`);
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
    gh(["release", "upload", tag, file, "--clobber"]);
    for (const stale of assets) {
      if (stale.name.endsWith(".apk") && stale.name !== name) {
        gh(["release", "delete-asset", tag, stale.name, "--yes"]);
      }
    }
    binary.apk = name;
  } catch (error) {
    process.stdout.write(
      `::warning title=APK not attached::${error.message}. The release links to EAS instead; the next ship on this fingerprint tries again.\n`,
    );
  }
  return before !== binary.apk;
}

// ---------------------------------------------------------------------------

function projectFromAppJson() {
  const { expo } = readJson("app.json") ?? {};
  return { account: expo?.owner, slug: expo?.slug };
}

function projectFromBuild(build) {
  const owned = { account: build.app?.ownerAccount?.name, slug: build.app?.slug };
  return owned.account && owned.slug ? owned : projectFromAppJson();
}

// EAS records the commit it was handed for every build, so that is the one to
// show; this run's own commit stands in only on the build lane, where it is the
// commit that was uploaded. On the update lane a build EAS can't place claims no
// commit rather than the wrong one, and `publish` still anchors the tag
// somewhere real.
function binaryFromBuild(build) {
  const built = action === "build";
  return {
    id: build.id,
    appVersion: build.appVersion,
    appBuildVersion: build.appBuildVersion,
    sha: build.gitCommitHash ?? (built ? sha : undefined),
    subject: build.gitCommitMessage?.split("\n")[0] ?? (built ? subject : undefined),
    finishedAt: build.completedAt,
    expiresAt: build.expirationDate,
    artifactUrl: build.artifacts?.applicationArchiveUrl ?? build.artifacts?.buildUrl,
  };
}

function fail(markdown) {
  summarize(`## Release\n\n${markdown}`);
  process.exitCode = 1;
}

async function main() {
  if (action !== "build" && action !== "update") {
    summarize("## Release\n\nNothing shipped, so there is nothing to record.");
    return;
  }

  // Written by android-build.mjs: on the update lane the newest finished build
  // with this fingerprint, on the build lane the one this run waited for.
  const build = readJson("binary.json");
  if (build?.status !== "FINISHED") {
    fail("There is no finished build in `binary.json`, so no release was recorded.");
    return;
  }
  const update = action === "update" ? [].concat(readJson("update.json") ?? [])[0] : undefined;
  if (action === "update" && !update) {
    fail("EAS wrote no readable `update.json`, so no release was recorded.");
    return;
  }

  const tag = `android-${profile}-${fingerprint.slice(0, 12)}`;
  const existing = JSON.parse(
    gh(["release", "view", tag, "--json", "body,url,assets"], { allowFailure: true }) || "null",
  );
  const prior = parseState(existing?.body);

  const state = prior ?? {
    profile,
    fingerprint,
    project: projectFromAppJson(),
    binary: {},
    updates: [],
  };
  state.project = projectFromBuild(build);

  // Refreshed from EAS on every ship, not only on a build: a release recorded
  // before this one waited for its build may name one that never finished, and
  // the newest finished build is the one to describe. A forced rebuild of a
  // fingerprint keeps the updates, since the new binary accepts them too; what
  // it drops is the old binary's APK, which `attachApk` replaces.
  const apk = state.binary.id === build.id ? state.binary.apk : undefined;
  state.binary = { ...binaryFromBuild(build), apk };

  if (update) {
    const entry = {
      sha,
      subject,
      group: update.group,
      publishedAt: update.createdAt ?? new Date().toISOString(),
    };
    state.updates = [
      entry,
      ...state.updates.filter((u) => u.sha !== entry.sha && u.group !== entry.group),
    ];
  }

  // The asset can only go on a release that exists, so the body is written
  // first and rewritten if the APK changed what it should say.
  const url = publish(tag, state, existing);
  if (await attachApk(tag, state, existing?.assets ?? [])) {
    publish(tag, state, { url });
  }

  const headline =
    action === "build"
      ? "The native runtime changed, so this commit needed a binary, and EAS has finished building it."
      : "The native runtime is unchanged, so this commit shipped as JavaScript — it is live now, not queued.";
  summarize(`## Release\n\n${headline}\n\n${link(tag, url)}\n`);
}

await main();
