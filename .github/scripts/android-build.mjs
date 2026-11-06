#!/usr/bin/env node
// The EAS half of the Android workflow: which way this commit ships, and — when
// that way is a binary — whether the binary actually came out the other end.
//
//   node android-build.mjs decide       reads builds.json, writes `action`
//   node android-build.mjs wait <id>    polls one build until EAS is done with it
//
// Waiting is the point. A build started with `--no-wait` turns the run green the
// moment EAS accepts the job, so a build that fails twenty minutes later fails
// where nobody is looking: in October ten builds of one runtime errored in a row,
// every run was green, and for sixteen days no JavaScript reached a phone. Here a
// build that errors makes the run that is waiting on it fail.
//
// Run from mobile/, like the workflow's other steps. Everything else arrives in
// the environment; see .github/workflows/android.yml.

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

// EAS's own status strings, as `build:list` and `build:view` print them. A build
// in any of these will still become a binary, so it is worth waiting for rather
// than queueing another one beside it. PENDING_CANCEL is not here: it is on its
// way to CANCELED.
const IN_FLIGHT = ["NEW", "IN_QUEUE", "IN_PROGRESS"];

// What the wait does when the API hiccups. One failed poll in a five-hour wait
// is the network, not the build; five in a row is something to stop for.
const POLL_SECONDS = Number(process.env.POLL_SECONDS ?? 60);
const WAIT_MINUTES = Number(process.env.WAIT_MINUTES ?? 300);
const MAX_POLL_FAILURES = 5;

/** The build a release should describe. The release script reads it back. */
const BINARY_FILE = "binary.json";

function summarize(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
  process.stdout.write(`${markdown}\n`);
}

function output(values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value ?? ""}\n`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, lines.join(""));
  } else {
    process.stdout.write(lines.join(""));
  }
}

/** A workflow command: shown on the run's page, not just buried in its log. */
function annotate(level, title, message) {
  process.stdout.write(`::${level} title=${title}::${message}\n`);
}

function buildPage(build) {
  const account = build.app?.ownerAccount?.name;
  const slug = build.app?.slug;
  if (!(account && slug)) {
    return undefined;
  }
  return `https://expo.dev/accounts/${account}/projects/${slug}/builds/${build.id}`;
}

function describe(build) {
  const number = build.appBuildVersion ? `build ${build.appBuildVersion}` : `build ${build.id}`;
  const page = buildPage(build);
  return page ? `[${number}](${page})` : number;
}

function newestFirst(builds) {
  return [...builds].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

// ---------------------------------------------------------------------------

/**
 * Picks the lane from every build EAS has for this channel and fingerprint.
 *
 * A finished one means the APK people have installed can run this commit, so
 * the commit ships as an update — the fast path, and the common one. Failing
 * that, one that is still building is the binary this commit needs, so the run
 * waits on it rather than queueing a second copy: on 20 October three builds of
 * the same runtime were queued nine to thirteen minutes apart, because each
 * push looked only for a *finished* one. Only when there is neither does it
 * start a build.
 *
 * `force_build` skips the finished ones, which is what it is for. It does not
 * skip one in flight: that build is the fresh binary being asked for.
 */
function decide(builds, { force = false } = {}) {
  const sorted = newestFirst(builds);
  const finished = sorted.find((build) => build.status === "FINISHED");
  const inFlight = sorted.find((build) => IN_FLIGHT.includes(build.status));
  if (finished && !force) {
    return { action: "update", build: finished };
  }
  if (inFlight) {
    return { action: "wait", build: inFlight };
  }
  return { action: "build" };
}

function whyBuild(builds, force) {
  if (force) {
    return "`force_build` is set, so this run builds a fresh binary.";
  }
  if (builds.length > 0) {
    // The October case: every earlier attempt errored. Saying so here puts the
    // history next to the build that is about to try again.
    return `None of the ${builds.length} builds with this fingerprint finished and none is still running, so this run starts another.`;
  }
  return "No build has this fingerprint yet, so this commit needs one.";
}

function runDecide() {
  const builds = [].concat(JSON.parse(readFileSync("builds.json", "utf8")));
  const force = process.env.FORCE_BUILD === "true";
  const { action, build } = decide(builds, { force });
  output({ action, build_id: build?.id });

  if (action === "update") {
    writeFileSync(BINARY_FILE, JSON.stringify(build, null, 2));
    summarize(`Shipping as an update on top of ${describe(build)}, which has this fingerprint.`);
  } else if (action === "wait") {
    summarize(
      `${describe(build)} has this fingerprint and is \`${build.status}\` on EAS, so this run waits on it instead of queueing another.`,
    );
  } else {
    summarize(whyBuild(builds, force));
  }
}

// ---------------------------------------------------------------------------

function view(id) {
  return JSON.parse(
    execFileSync("eas", ["build:view", id, "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }),
  );
}

/**
 * Polls `eas build:view` until the build stops moving, and exits non-zero
 * unless it finished. The runner sits in EAS's queue for the whole time, which
 * is fine because the repo is public and its Actions minutes cost nothing; a
 * follow-up job would need somewhere to keep the build id and something to wake
 * it, for no gain.
 */
async function runWait(id) {
  if (!id) {
    throw new Error("wait needs a build id");
  }
  const started = Date.now();
  const deadline = started + WAIT_MINUTES * 60_000;
  let failures = 0;
  let lastStatus;

  for (;;) {
    let build;
    try {
      build = view(id);
      failures = 0;
    } catch (error) {
      failures += 1;
      if (failures >= MAX_POLL_FAILURES) {
        annotate(
          "error",
          "EAS unreachable",
          `Could not read build ${id} ${failures} times in a row. It carries on on EAS; the next run on this channel waits on it.`,
        );
        throw error;
      }
      process.stdout.write(`Could not read build ${id} (${failures} in a row); trying again.\n`);
    }

    if (build && build.status !== lastStatus) {
      const minutes = Math.round((Date.now() - started) / 60_000);
      process.stdout.write(`${new Date().toISOString()} ${build.status} after ${minutes} min\n`);
      lastStatus = build.status;
    }

    if (build?.status === "FINISHED") {
      writeFileSync(BINARY_FILE, JSON.stringify(build, null, 2));
      output({ commit: build.gitCommitHash });
      summarize(`${describe(build)} finished on EAS.`);
      return 0;
    }
    if (build && !IN_FLIGHT.includes(build.status)) {
      const reason = build.error?.message ?? `EAS reports it as ${build.status}.`;
      annotate("error", `EAS build ${build.status.toLowerCase().replace("_", " ")}`, reason);
      summarize(
        `${describe(build)} ended \`${build.status}\`, so nothing shipped and no release was recorded.\n\n> ${reason}`,
      );
      return 1;
    }
    if (Date.now() >= deadline) {
      // The build carries on without us. The next run on this channel finds it
      // in flight and waits on it, so giving up here does not cost a rebuild.
      annotate(
        "error",
        "EAS build still running",
        `Build ${id} was still ${lastStatus} after ${WAIT_MINUTES} minutes. It carries on on EAS; the next run on this channel waits on it rather than queueing another.`,
      );
      summarize(
        `${describe(build ?? { id })} was still \`${lastStatus}\` after ${WAIT_MINUTES} minutes, so this run stopped waiting. Nothing was recorded.`,
      );
      return 1;
    }
    await sleep(POLL_SECONDS * 1000);
  }
}

// ---------------------------------------------------------------------------

const [command, id] = process.argv.slice(2);
if (command === "decide") {
  runDecide();
} else if (command === "wait") {
  process.exitCode = await runWait(id);
} else {
  throw new Error(`usage: android-build.mjs decide | wait <build-id> (got ${command})`);
}
