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
// The body is generated, never appended to as text: the state below is embedded
// as JSON in an HTML comment (which GitHub does not render), read back on the
// next ship, and the whole body re-rendered from it. Formatting changes apply
// retroactively, and an entry keyed on the commit and the update group makes a
// re-run idempotent rather than double-posting.
//
// Run from mobile/, where eas.json and app.json live. Everything else arrives
// in the environment; see .github/workflows/android.yml.

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STATE_PATTERN = /<!-- min-agent-release\n([\s\S]*?)\n-->/;
// Out of the working tree: this runs from mobile/, and the body is `gh`'s input,
// not an artifact of the repo.
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
    if (allowFailure) return undefined;
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
  if (!(project.account && project.slug && id)) return undefined;
  return `https://expo.dev/accounts/${project.account}/projects/${project.slug}/${kind}/${id}`;
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

// ---------------------------------------------------------------------------

function renderBinary(state) {
  const { binary, project } = state;
  const version = binary.appVersion
    ? `**${binary.appVersion}${binary.appBuildVersion ? ` (${binary.appBuildVersion})` : ""}**`
    : "**version unknown**";
  const lines = [
    "## Binary",
    "",
    `- ${version} — profile \`${state.profile}\`, ${link("open in EAS", easUrl(project, "builds", binary.id)) || `build \`${binary.id ?? "unknown"}\``}`,
  ];
  if (binary.sha)
    lines.push(
      `- Built from ${commitLink(binary.sha, binary.subject ? `— ${binary.subject}` : "")}`,
    );
  lines.push(`- Fingerprint \`${state.fingerprint}\``);
  lines.push("");
  lines.push(
    binary.foundOnEas
      ? "This workflow did not build this binary, so its details come from EAS rather than from the run that produced it."
      : "The installable artifact downloads from the build page once EAS finishes.",
  );
  return lines.join("\n");
}

function renderUpdates(state) {
  const lines = ["## Updates on this binary", ""];
  if (state.updates.length === 0) {
    lines.push("None yet — the binary is the newest thing on this channel.");
    return lines.join("\n");
  }
  lines.push(
    `Newest first. Each went live on \`${state.profile}\` the moment it published; phones pick it up on their next launch, background sync included.`,
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

function renderBody(state) {
  return [
    `Phones on the **${state.profile}** channel run this binary plus the newest update below.`,
    "",
    renderBinary(state),
    "",
    renderUpdates(state),
    "",
    `<!-- min-agent-release\n${JSON.stringify(state, null, 2)}\n-->`,
    "",
  ].join("\n");
}

function parseState(body) {
  const match = body?.match(STATE_PATTERN);
  if (!match) return undefined;
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
  writeFileSync(NOTES_FILE, renderBody(state));
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

function projectFromAppJson() {
  const { expo } = readJson("app.json") ?? {};
  return { account: expo?.owner, slug: expo?.slug };
}

function binaryFromBuild(build, { foundOnEas = false } = {}) {
  return {
    id: build?.id,
    appVersion: build?.appVersion,
    appBuildVersion: build?.appBuildVersion,
    // Backfilled from EAS: only EAS knows which commit that binary came from,
    // and when it doesn't say, the release claims no commit rather than the
    // wrong one. `publish` still anchors the tag somewhere real.
    sha: foundOnEas ? build?.gitCommitHash : sha,
    subject: foundOnEas ? undefined : subject,
    foundOnEas,
  };
}

function main() {
  if (action !== "build" && action !== "update") {
    summarize("## Release\n\nNothing shipped, so there is nothing to record.");
    return;
  }

  const file = action === "build" ? "build.json" : "update.json";
  const payload = [].concat(readJson(file) ?? [])[0];
  if (!payload) {
    summarize(
      `## Release\n\nEAS wrote no readable \`${file}\`, so no release was recorded — the failure is in the step above.`,
    );
    return;
  }

  const tag = `android-${profile}-${fingerprint.slice(0, 12)}`;
  const existing = JSON.parse(
    gh(["release", "view", tag, "--json", "body,url"], { allowFailure: true }) || "null",
  );
  const prior = parseState(existing?.body);

  const state = prior ?? {
    profile,
    fingerprint,
    project: projectFromAppJson(),
    binary: {},
    updates: [],
  };
  // A build published outside the workflow, or before this existed, leaves an
  // update with no release to land in. The build that matched the fingerprint
  // is already on disk from the decide step, so backfill the binary from it.
  const backfill = action === "update" && !prior;

  if (action === "build") {
    // A forced rebuild of a fingerprint that already has a release keeps the
    // updates: they were published against this runtime, so the new binary
    // accepts them too.
    state.binary = binaryFromBuild(payload);
    // The build response names its own project; the update response doesn't,
    // which is why app.json is the fallback on both lanes.
    const owned = { account: payload.project?.ownerAccount?.name, slug: payload.project?.slug };
    state.project = owned.account && owned.slug ? owned : projectFromAppJson();
  } else {
    if (backfill) {
      state.binary = binaryFromBuild([].concat(readJson("builds.json") ?? [])[0], {
        foundOnEas: true,
      });
    }
    const entry = {
      sha,
      subject,
      group: payload.group,
      publishedAt: payload.createdAt ?? new Date().toISOString(),
    };
    state.updates = [
      entry,
      ...state.updates.filter((u) => u.sha !== entry.sha && u.group !== entry.group),
    ];
  }

  const url = publish(tag, state, existing);
  const headline =
    action === "build"
      ? "The native runtime changed, so this commit needs a binary. It is building on EAS now."
      : "The native runtime is unchanged, so this commit shipped as JavaScript — it is live now, not queued.";
  summarize(`## Release\n\n${headline}\n\n${link(tag, url)}\n`);
}

main();
