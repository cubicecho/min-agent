/**
 * Every number min-agent chose and could have chosen differently, in one place.
 *
 * One frozen object per thing the numbers are about, each with a type that says what a member
 * is and what unit it is in. The code reads the member where it uses it, so a search for a
 * member's name finds both the value and everything that depends on it.
 *
 * This file imports nothing. What is not here: how units convert (`units.ts`), words a protocol
 * or a file format fixes, and the values a test makes up for itself.
 */

export interface TitleSettings {
  /** The longest title shown whole. */
  maxChars: number;
  /** How much of a longer title is kept ahead of its ellipsis. */
  keptChars: number;
  /** How much of the opening message the model is shown to name the chat from. */
  promptChars: number;
}

export const TITLE_DEFAULTS: Readonly<TitleSettings> = Object.freeze({
  maxChars: 60,
  keptChars: 57,
  promptChars: 2000,
});

export interface FollowupSettings {
  /** Cap on the suggestions offered after an answer. */
  maxCount: number;
  /** The length past which a suggestion stops reading as a chip. */
  maxChars: number;
  /** How much of the question the model is shown. */
  questionChars: number;
  /** How much of the answer the model is shown. */
  answerChars: number;
  /** The reply budget for the whole list of suggestions. */
  maxTokens: number;
}

export const FOLLOWUP_DEFAULTS: Readonly<FollowupSettings> = Object.freeze({
  maxCount: 3,
  maxChars: 80,
  questionChars: 2000,
  answerChars: 6000,
  maxTokens: 200,
});

export interface TurnSettings {
  /**
   * How many times a lost request is worth sending again before the turn gives up.
   *
   * Not a setting. min-agent talks to one endpoint, usually on the same machine or the next one
   * over, and the number that would go in that box is the same number for everyone.
   *
   * It is a budget for the round trip rather than for opening it. The loop it used to guard could
   * only ever fire on a request that never became an answer, because it wrapped the call that
   * resolves before the first chunk; `runTurn` bounds the read as well, and stops retrying the
   * moment the server has said anything. A downgrade does not spend an attempt — that is a
   * different request, not the same one again.
   */
  openRetries: number;
  /**
   * The share of the last request's prompt that has to come back from the cache. A request that
   * finds less is logged as a cache miss.
   */
  cachedShare: number;
  /** How much of a tool call's unparsable arguments the error quotes. */
  quotedArgumentChars: number;
}

export const TURN_DEFAULTS: Readonly<TurnSettings> = Object.freeze({
  openRetries: 2,
  cachedShare: 0.9,
  quotedArgumentChars: 200,
});

export interface PruningSettings {
  /**
   * How many of the latest tool results a move of the marker leaves whole. agent-core's default.
   *
   * Read where the marker is *placed*, not where the stubs are made: `planPrune` puts the marker
   * on the fifth result from the end, and `sentWithStubs` then clears everything behind it.
   * Handing this to `pruneToolResults` instead would keep the last five results *behind* the
   * marker whole, and the next move would stub them — changing the request from somewhere before
   * the old marker rather than from it. Either way the model keeps the same five results at the
   * moment of a move.
   */
  keepLast: number;
  /** A result this long or shorter is left whole wherever it is. agent-core's default. */
  maxChars: number;
  /**
   * The share of the window a move must clear before the marker moves on its own.
   *
   * A move costs one cache miss, from the old marker to the end of the request, and what it buys
   * is the window: every token cleared is one the conversation can use before a compaction — a
   * summariser's round trip, a miss from the very head, and the detail a summary loses — or, in a
   * long turn of tool steps, before the request overflows, since nothing compacts mid-turn. At a
   * quarter of the window a conversation can move the marker at most three times on its way from
   * empty to compaction's three quarters, each move hands a quarter of the window back for one
   * re-read of what lies after the old marker, and a conversation that is mostly talk never moves
   * it at all.
   *
   * A constant and not a setting, like the planner's own ratios: the number that would go in the
   * box is a share of a window that already is a setting.
   */
  windowShare: number;
}

export const PRUNING_DEFAULTS: Readonly<PruningSettings> = Object.freeze({
  keepLast: 5,
  maxChars: 256,
  windowShare: 0.25,
});

export interface ModelSettings {
  /** The reply budget of one request, in tokens. */
  maxTokens: number;
  temperature: number;
  /** Hard stop on runaway tool loops. */
  maxToolIterations: number;
}

/** What a new installation's model settings start as. */
export const MODEL_DEFAULTS: Readonly<ModelSettings> = Object.freeze({
  maxTokens: 4096,
  temperature: 0.7,
  maxToolIterations: 20,
});

/** The most each model setting may be saved as. */
export const MODEL_CEILINGS: Readonly<ModelSettings> = Object.freeze({
  maxTokens: 200_000,
  temperature: 2,
  maxToolIterations: 100,
});

export interface ServerSettings {
  /** The port the server listens on when `PORT` is not set. */
  port: number;
}

export const SERVER_DEFAULTS: Readonly<ServerSettings> = Object.freeze({
  port: 8787,
});

export interface DatabaseSettings {
  /** How many times the server asks a database that is not answering yet. */
  connectAttempts: number;
  /** What the wait between two of those doubles from: 250ms, 500ms, 1s… */
  backoffBaseMs: number;
  /** The longest wait between two of them. With twelve attempts, roughly half a minute in all. */
  backoffCeilingMs: number;
  /** Enough to outlast a migration that is mid-flight, and few enough to fail a real error fast. */
  migrateAttempts: number;
  /** A raced migration waits this long times the number of attempts made so far. */
  migrateStepMs: number;
}

export const DATABASE_DEFAULTS: Readonly<DatabaseSettings> = Object.freeze({
  connectAttempts: 12,
  backoffBaseMs: 125,
  backoffCeilingMs: 4000,
  migrateAttempts: 4,
  migrateStepMs: 200,
});

export interface VoiceSettings {
  /** Whisper's own ceiling. A minute of speech is about a megabyte, so a turn is nowhere near. */
  maxAudioBody: string;
  /** OpenAI's ceiling on one `speech` call, and long enough for any reply worth hearing. */
  maxSpeechChars: number;
  /** What a device voice will take in one call, and past which the tail is silence anyway. */
  maxSpokenChars: number;
  /**
   * Where, as a share of the limit, the hunt for a sentence end starts when a reply is cut to
   * fit. The last fifth, so a merely-long reply is not cut short hunting for a full stop.
   */
  sentenceFloorShare: number;
  /** Long enough for a minute of speech on a slow disk; a clip that takes longer is not decoding. */
  decodeTimeoutSeconds: number;
  /** Long enough for a slow model on a Pi to finish a sentence, short enough to not hang a request. */
  wyomingTimeoutSeconds: number;
}

export const VOICE_DEFAULTS: Readonly<VoiceSettings> = Object.freeze({
  maxAudioBody: "25mb",
  maxSpeechChars: 4096,
  maxSpokenChars: 4000,
  sentenceFloorShare: 0.8,
  decodeTimeoutSeconds: 30,
  wyomingTimeoutSeconds: 120,
});

export interface FreshnessSettings {
  /**
   * How long the connection settings and the model list stay fresh.
   *
   * The `models` query is not a local read: it asks the configured provider to list its models,
   * so every mount of a chat pane and every trip through the Config view was another round trip
   * out to the API. Neither of these changes on its own — saving config invalidates both by hand
   * — so the only cost of holding them is a stale list for someone editing the settings row
   * underneath the running server, which a reload settles.
   */
  settingsStaleMinutes: number;
  /**
   * How long the embed list stays fresh.
   *
   * The sidebar reads it on every render of every screen, and it only changes when someone
   * saves the Apps panel — which invalidates the query by hand. Long, for the same reason the
   * settings are: this is a list of rows a person typed, not something that moves on its own.
   */
  embedsStaleMinutes: number;
  /** How often the MCP panel asks after the servers while it is the one on screen. */
  mcpPollSeconds: number;
  /**
   * How often the settings screen asks after them to put a dot on the tab.
   *
   * Slower than the MCP panel's own poll: a server that fell over while you were on Agent is
   * worth noticing, and it is not worth a request every five seconds to notice it a little
   * sooner.
   */
  mcpWatchSeconds: number;
}

export const FRESHNESS_DEFAULTS: Readonly<FreshnessSettings> = Object.freeze({
  settingsStaleMinutes: 5,
  embedsStaleMinutes: 5,
  mcpPollSeconds: 5,
  mcpWatchSeconds: 30,
});

export interface ChatSettings {
  /** How far from the bottom still counts as at it, so a stray flick does not count as leaving. */
  bottomSlackPx: number;
  /** How often the live meter's clock moves while a turn streams. */
  liveMeterTickMs: number;
  /** The live meter's estimate of a token, before the server reports the real count. */
  charsPerToken: number;
  /** How long a turn has to have run before the live meter shows a rate. */
  rateAfterSeconds: number;
  /** The share of the context window past which the meter turns to its warning colour. */
  meterWarnShare: number;
  /** The share past which it turns to its danger colour. */
  meterDangerShare: number;
  /** How long a copy button says it worked before going back to offering. */
  copiedForMs: number;
}

export const CHAT_DEFAULTS: Readonly<ChatSettings> = Object.freeze({
  bottomSlackPx: 100,
  liveMeterTickMs: 250,
  charsPerToken: 4,
  rateAfterSeconds: 0.5,
  meterWarnShare: 0.75,
  meterDangerShare: 0.9,
  copiedForMs: 1500,
});

export interface SessionListSettings {
  /** Below this many chats the search box is just something in the way, so the list hides it. */
  searchAfter: number;
}

export const SESSION_LIST_DEFAULTS: Readonly<SessionListSettings> = Object.freeze({
  searchAfter: 8,
});

export interface LayoutSettings {
  /** The window width from which the app shows its panes side by side. */
  wideWidthPx: number;
}

export const LAYOUT_DEFAULTS: Readonly<LayoutSettings> = Object.freeze({
  wideWidthPx: 768,
});
