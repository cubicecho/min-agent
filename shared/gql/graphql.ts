import type { DocumentTypeDecoration } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** A date-time string at UTC, such as 2007-12-03T10:15:30Z, compliant with the `date-time` format outlined in section 5.6 of the RFC 3339 profile of the ISO 8601 standard for representation of dates and times using the Gregorian calendar. */
  DateTime: { input: string; output: string; }
  /** The `JSON` scalar type represents JSON values as specified by [ECMA-404](http://www.ecma-international.org/publications/files/ECMA-ST/ECMA-404.pdf). */
  JSON: { input: unknown; output: unknown; }
};

/** Compares an aggregated value. Several operators in one filter are ANDed together. */
export type AggregateNumberFilter = {
  eq?: InputMaybe<Scalars['Float']['input']>;
  gt?: InputMaybe<Scalars['Float']['input']>;
  gte?: InputMaybe<Scalars['Float']['input']>;
  lt?: InputMaybe<Scalars['Float']['input']>;
  lte?: InputMaybe<Scalars['Float']['input']>;
  ne?: InputMaybe<Scalars['Float']['input']>;
};

export type BooleanFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<BooleanFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<BooleanFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<BooleanFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<Scalars['Boolean']['input']>;
  /** Greater than */
  gt?: InputMaybe<Scalars['Boolean']['input']>;
  /** Greater than or equal to */
  gte?: InputMaybe<Scalars['Boolean']['input']>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  /** When true, every comparison operator in this object matches case-insensitively — `eq`, `ne`, the ordering operators, `inArray`/`notInArray` and the pattern operators all compare `lower(column)` against `lower(operand)`. Applies only to the operators beside it; a nested `AND`/`OR`/`NOT` branch sets its own. */
  insensitive?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<Scalars['Boolean']['input']>;
  /** Less than or equal to */
  lte?: InputMaybe<Scalars['Boolean']['input']>;
  /** Not equal to */
  ne?: InputMaybe<Scalars['Boolean']['input']>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type CreateSessionInput = {
  compaction?: InputMaybe<Scalars['JSON']['input']>;
  createdAt?: InputMaybe<Scalars['DateTime']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  loadedTools?: InputMaybe<Scalars['JSON']['input']>;
  messageCount?: InputMaybe<Scalars['Int']['input']>;
  model?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
  updatedAt?: InputMaybe<Scalars['DateTime']['input']>;
  usage?: InputMaybe<Scalars['JSON']['input']>;
};

export type DateTimeFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<DateTimeFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<DateTimeFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<DateTimeFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<Scalars['DateTime']['input']>;
  /** Greater than */
  gt?: InputMaybe<Scalars['DateTime']['input']>;
  /** Greater than or equal to */
  gte?: InputMaybe<Scalars['DateTime']['input']>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<Scalars['DateTime']['input']>>;
  /** When true, every comparison operator in this object matches case-insensitively — `eq`, `ne`, the ordering operators, `inArray`/`notInArray` and the pattern operators all compare `lower(column)` against `lower(operand)`. Applies only to the operators beside it; a nested `AND`/`OR`/`NOT` branch sets its own. */
  insensitive?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<Scalars['DateTime']['input']>;
  /** Less than or equal to */
  lte?: InputMaybe<Scalars['DateTime']['input']>;
  /** Not equal to */
  ne?: InputMaybe<Scalars['DateTime']['input']>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<Scalars['DateTime']['input']>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type Embed = {
  /** Opaque cursor of this row's position in the query's ordering. Pass it as `after` to resume from here. Only set on rows returned by a list query. */
  cursor?: Maybe<Scalars['String']['output']>;
  enabled: Scalars['Boolean']['output'];
  icon: Scalars['String']['output'];
  id: Scalars['String']['output'];
  label: Scalars['String']['output'];
  mode: EmbedsModeEnum;
  position: Scalars['Int']['output'];
  url: Scalars['String']['output'];
};

export type EmbedAggregate = {
  avg?: Maybe<EmbedAvgAggregate>;
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<EmbedCountDistinctAggregate>;
  countNonNull?: Maybe<EmbedCountNonNullAggregate>;
  max?: Maybe<EmbedMaxAggregate>;
  min?: Maybe<EmbedMinAggregate>;
  sum?: Maybe<EmbedSumAggregate>;
};

export type EmbedAvgAggregate = {
  position?: Maybe<Scalars['Float']['output']>;
};

export type EmbedAvgHaving = {
  position?: InputMaybe<AggregateNumberFilter>;
};

export type EmbedCountDistinctAggregate = {
  icon: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  label: Scalars['Int']['output'];
  mode: Scalars['Int']['output'];
  position: Scalars['Int']['output'];
  url: Scalars['Int']['output'];
};

export type EmbedCountDistinctHaving = {
  icon?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  label?: InputMaybe<AggregateNumberFilter>;
  mode?: InputMaybe<AggregateNumberFilter>;
  position?: InputMaybe<AggregateNumberFilter>;
  url?: InputMaybe<AggregateNumberFilter>;
};

export type EmbedCountNonNullAggregate = {
  enabled: Scalars['Int']['output'];
  icon: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  label: Scalars['Int']['output'];
  mode: Scalars['Int']['output'];
  position: Scalars['Int']['output'];
  url: Scalars['Int']['output'];
};

export type EmbedCountNonNullHaving = {
  enabled?: InputMaybe<AggregateNumberFilter>;
  icon?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  label?: InputMaybe<AggregateNumberFilter>;
  mode?: InputMaybe<AggregateNumberFilter>;
  position?: InputMaybe<AggregateNumberFilter>;
  url?: InputMaybe<AggregateNumberFilter>;
};

/** Columns of Embed that a query can be made distinct on */
export enum EmbedDistinctColumn {
  Enabled = 'enabled',
  Icon = 'icon',
  Id = 'id',
  Label = 'label',
  Mode = 'mode',
  Position = 'position',
  Url = 'url'
}

export type EmbedFilters = {
  /** Every branch matches */
  AND?: InputMaybe<Array<EmbedFilters>>;
  /** Negates the nested filters */
  NOT?: InputMaybe<EmbedFilters>;
  /** At least one branch matches; ANDed with any sibling fields */
  OR?: InputMaybe<Array<EmbedFilters>>;
  enabled?: InputMaybe<BooleanFilter>;
  icon?: InputMaybe<StringFilter>;
  id?: InputMaybe<StringFilter>;
  label?: InputMaybe<StringFilter>;
  mode?: InputMaybe<EmbedsModeEnumFilter>;
  position?: InputMaybe<IntFilter>;
  url?: InputMaybe<StringFilter>;
};

export type EmbedGroupBy = {
  avg?: Maybe<EmbedAvgAggregate>;
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<EmbedCountDistinctAggregate>;
  countNonNull?: Maybe<EmbedCountNonNullAggregate>;
  group: EmbedGroupKeys;
  max?: Maybe<EmbedMaxAggregate>;
  min?: Maybe<EmbedMinAggregate>;
  sum?: Maybe<EmbedSumAggregate>;
};

/** Columns of Embed that a query can group by */
export enum EmbedGroupByColumn {
  Enabled = 'enabled',
  Icon = 'icon',
  Id = 'id',
  Label = 'label',
  Mode = 'mode',
  Position = 'position',
  Url = 'url'
}

/** The grouped column values of one Embed group. A column the query did not group by is null. */
export type EmbedGroupKeys = {
  enabled?: Maybe<Scalars['Boolean']['output']>;
  icon?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  label?: Maybe<Scalars['String']['output']>;
  mode?: Maybe<EmbedsModeEnum>;
  position?: Maybe<Scalars['Int']['output']>;
  url?: Maybe<Scalars['String']['output']>;
};

/** Filters Embed groups by their aggregated values */
export type EmbedHaving = {
  avg?: InputMaybe<EmbedAvgHaving>;
  /** Filters groups by how many rows they contain */
  count?: InputMaybe<AggregateNumberFilter>;
  countDistinct?: InputMaybe<EmbedCountDistinctHaving>;
  countNonNull?: InputMaybe<EmbedCountNonNullHaving>;
  max?: InputMaybe<EmbedMaxHaving>;
  min?: InputMaybe<EmbedMinHaving>;
  sum?: InputMaybe<EmbedSumHaving>;
};

/** One row of the embed list. Reads come from the generated `embeds` query. */
export type EmbedInput = {
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  icon?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['String']['input'];
  label?: InputMaybe<Scalars['String']['input']>;
  mode?: InputMaybe<EmbedMode>;
  url?: InputMaybe<Scalars['String']['input']>;
};

export type EmbedMaxAggregate = {
  icon?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  label?: Maybe<Scalars['String']['output']>;
  mode?: Maybe<EmbedsModeEnum>;
  position?: Maybe<Scalars['Int']['output']>;
  url?: Maybe<Scalars['String']['output']>;
};

export type EmbedMaxHaving = {
  position?: InputMaybe<AggregateNumberFilter>;
};

export type EmbedMinAggregate = {
  icon?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  label?: Maybe<Scalars['String']['output']>;
  mode?: Maybe<EmbedsModeEnum>;
  position?: Maybe<Scalars['Int']['output']>;
  url?: Maybe<Scalars['String']['output']>;
};

export type EmbedMinHaving = {
  position?: InputMaybe<AggregateNumberFilter>;
};

export enum EmbedMode {
  External = 'external',
  Iframe = 'iframe'
}

export type EmbedOrderBy = {
  enabled?: InputMaybe<InnerOrder>;
  icon?: InputMaybe<InnerOrder>;
  id?: InputMaybe<InnerOrder>;
  label?: InputMaybe<InnerOrder>;
  mode?: InputMaybe<InnerOrder>;
  position?: InputMaybe<InnerOrder>;
  url?: InputMaybe<InnerOrder>;
};

export type EmbedSumAggregate = {
  position?: Maybe<Scalars['Float']['output']>;
};

export type EmbedSumHaving = {
  position?: InputMaybe<AggregateNumberFilter>;
};

export enum EmbedsModeEnum {
  /** Value: external */
  External = 'external',
  /** Value: iframe */
  Iframe = 'iframe'
}

export type EmbedsModeEnumFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<EmbedsModeEnumFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<EmbedsModeEnumFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<EmbedsModeEnumFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<EmbedsModeEnum>;
  /** Greater than */
  gt?: InputMaybe<EmbedsModeEnum>;
  /** Greater than or equal to */
  gte?: InputMaybe<EmbedsModeEnum>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<EmbedsModeEnum>>;
  /** When true, every comparison operator in this object matches case-insensitively — `eq`, `ne`, the ordering operators, `inArray`/`notInArray` and the pattern operators all compare `lower(column)` against `lower(operand)`. Applies only to the operators beside it; a nested `AND`/`OR`/`NOT` branch sets its own. */
  insensitive?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<EmbedsModeEnum>;
  /** Less than or equal to */
  lte?: InputMaybe<EmbedsModeEnum>;
  /** Not equal to */
  ne?: InputMaybe<EmbedsModeEnum>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<EmbedsModeEnum>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type FloatFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<FloatFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<FloatFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<FloatFilter>>;
  /** Equal to */
  eq?: InputMaybe<Scalars['Float']['input']>;
  /** Greater than */
  gt?: InputMaybe<Scalars['Float']['input']>;
  /** Greater than or equal to */
  gte?: InputMaybe<Scalars['Float']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<Scalars['Float']['input']>>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** Less than */
  lt?: InputMaybe<Scalars['Float']['input']>;
  /** Less than or equal to */
  lte?: InputMaybe<Scalars['Float']['input']>;
  /** Not equal to */
  ne?: InputMaybe<Scalars['Float']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<Scalars['Float']['input']>>;
};

export type Health = {
  baseUrl: Scalars['String']['output'];
  hasApiKey: Scalars['Boolean']['output'];
  model: Scalars['String']['output'];
  ok: Scalars['Boolean']['output'];
};

export type InnerOrder = {
  direction: OrderDirection;
  /** Sort by this column's position in the `inArray` list the same request's `where` gives it, rather than by the column's own value — `direction: asc` keeps the list's order, `desc` reverses it. Requires an `inArray` filter on the same column at the top level of `where`, and cannot be combined with `after` or `distinct`. */
  matchFilterOrder?: InputMaybe<Scalars['Boolean']['input']>;
  /** Where NULL values sort. Defaults to the database's own rule (PostgreSQL: last on asc, first on desc; MySQL/SQLite: first on asc, last on desc) */
  nulls?: InputMaybe<OrderNulls>;
  /** Priority of current field */
  priority: Scalars['Int']['input'];
};

export type IntFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<IntFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<IntFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<IntFilter>>;
  /** Equal to */
  eq?: InputMaybe<Scalars['Int']['input']>;
  /** Greater than */
  gt?: InputMaybe<Scalars['Int']['input']>;
  /** Greater than or equal to */
  gte?: InputMaybe<Scalars['Int']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<Scalars['Int']['input']>>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** Less than */
  lt?: InputMaybe<Scalars['Int']['input']>;
  /** Less than or equal to */
  lte?: InputMaybe<Scalars['Int']['input']>;
  /** Not equal to */
  ne?: InputMaybe<Scalars['Int']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<Scalars['Int']['input']>>;
};

export type JsonFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<JsonFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<JsonFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<JsonFilter>>;
  /** Value structurally contains this JSON (Postgres `@>` / MySQL JSON_CONTAINS) */
  contains?: InputMaybe<Scalars['JSON']['input']>;
  /** JSON equality on the whole value */
  eq?: InputMaybe<Scalars['JSON']['input']>;
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** JSON inequality on the whole value */
  ne?: InputMaybe<Scalars['JSON']['input']>;
  /** Compares the value at one path inside the document. Several entries are ANDed; a single object may be passed without the list brackets. */
  path?: InputMaybe<Array<JsonPathFilter>>;
};

/** How to read the value at a JSON path before comparing it */
export enum JsonPathCast {
  /** Compare as a boolean */
  Boolean = 'BOOLEAN',
  /** Compare as a number; a non-numeric value never matches */
  Number = 'NUMBER',
  /** Compare as text (lexicographic ordering) */
  Text = 'TEXT'
}

export type JsonPathFilter = {
  /** Overrides how the value is read before comparing */
  as?: InputMaybe<JsonPathCast>;
  /** Extracted value contains this string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Extracted value ends with this string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<Scalars['JSON']['input']>;
  /** Greater than */
  gt?: InputMaybe<Scalars['JSON']['input']>;
  /** Greater than or equal to */
  gte?: InputMaybe<Scalars['JSON']['input']>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  /** When true, matches rows where the path holds a value */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the path is missing or holds JSON null */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** Less than */
  lt?: InputMaybe<Scalars['JSON']['input']>;
  /** Less than or equal to */
  lte?: InputMaybe<Scalars['JSON']['input']>;
  /** Not equal to */
  ne?: InputMaybe<Scalars['JSON']['input']>;
  /** Keys to walk from the document root, e.g. `["profile", "level"]`. An all-digits key indexes an array. */
  path: Array<Scalars['String']['input']>;
  /** Extracted value starts with this string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type McpServer = {
  args: Scalars['JSON']['output'];
  command: Scalars['String']['output'];
  /** Opaque cursor of this row's position in the query's ordering. Pass it as `after` to resume from here. Only set on rows returned by a list query. */
  cursor?: Maybe<Scalars['String']['output']>;
  enabled: Scalars['Boolean']['output'];
  env: Scalars['JSON']['output'];
  headers: Scalars['JSON']['output'];
  id: Scalars['String']['output'];
  label: Scalars['String']['output'];
  position: Scalars['Int']['output'];
  transport: McpServersTransportEnum;
  url: Scalars['String']['output'];
};

export type McpServerAggregate = {
  avg?: Maybe<McpServerAvgAggregate>;
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<McpServerCountDistinctAggregate>;
  countNonNull?: Maybe<McpServerCountNonNullAggregate>;
  max?: Maybe<McpServerMaxAggregate>;
  min?: Maybe<McpServerMinAggregate>;
  sum?: Maybe<McpServerSumAggregate>;
};

export type McpServerAvgAggregate = {
  position?: Maybe<Scalars['Float']['output']>;
};

export type McpServerAvgHaving = {
  position?: InputMaybe<AggregateNumberFilter>;
};

/** A configured MCP server. `id` is the namespace its tools are exposed under. */
export type McpServerConfig = {
  args: Array<Scalars['String']['output']>;
  command: Scalars['String']['output'];
  enabled: Scalars['Boolean']['output'];
  env: Scalars['JSON']['output'];
  headers: Scalars['JSON']['output'];
  id: Scalars['String']['output'];
  label: Scalars['String']['output'];
  transport: McpTransport;
  url: Scalars['String']['output'];
};

export type McpServerCountDistinctAggregate = {
  command: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  label: Scalars['Int']['output'];
  position: Scalars['Int']['output'];
  transport: Scalars['Int']['output'];
  url: Scalars['Int']['output'];
};

export type McpServerCountDistinctHaving = {
  command?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  label?: InputMaybe<AggregateNumberFilter>;
  position?: InputMaybe<AggregateNumberFilter>;
  transport?: InputMaybe<AggregateNumberFilter>;
  url?: InputMaybe<AggregateNumberFilter>;
};

export type McpServerCountNonNullAggregate = {
  args: Scalars['Int']['output'];
  command: Scalars['Int']['output'];
  enabled: Scalars['Int']['output'];
  env: Scalars['Int']['output'];
  headers: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  label: Scalars['Int']['output'];
  position: Scalars['Int']['output'];
  transport: Scalars['Int']['output'];
  url: Scalars['Int']['output'];
};

export type McpServerCountNonNullHaving = {
  args?: InputMaybe<AggregateNumberFilter>;
  command?: InputMaybe<AggregateNumberFilter>;
  enabled?: InputMaybe<AggregateNumberFilter>;
  env?: InputMaybe<AggregateNumberFilter>;
  headers?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  label?: InputMaybe<AggregateNumberFilter>;
  position?: InputMaybe<AggregateNumberFilter>;
  transport?: InputMaybe<AggregateNumberFilter>;
  url?: InputMaybe<AggregateNumberFilter>;
};

/** Columns of McpServer that a query can be made distinct on */
export enum McpServerDistinctColumn {
  Args = 'args',
  Command = 'command',
  Enabled = 'enabled',
  Env = 'env',
  Headers = 'headers',
  Id = 'id',
  Label = 'label',
  Position = 'position',
  Transport = 'transport',
  Url = 'url'
}

export type McpServerFilters = {
  /** Every branch matches */
  AND?: InputMaybe<Array<McpServerFilters>>;
  /** Negates the nested filters */
  NOT?: InputMaybe<McpServerFilters>;
  /** At least one branch matches; ANDed with any sibling fields */
  OR?: InputMaybe<Array<McpServerFilters>>;
  args?: InputMaybe<JsonFilter>;
  command?: InputMaybe<StringFilter>;
  enabled?: InputMaybe<BooleanFilter>;
  env?: InputMaybe<JsonFilter>;
  headers?: InputMaybe<JsonFilter>;
  id?: InputMaybe<StringFilter>;
  label?: InputMaybe<StringFilter>;
  position?: InputMaybe<IntFilter>;
  transport?: InputMaybe<McpServersTransportEnumFilter>;
  url?: InputMaybe<StringFilter>;
};

export type McpServerGroupBy = {
  avg?: Maybe<McpServerAvgAggregate>;
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<McpServerCountDistinctAggregate>;
  countNonNull?: Maybe<McpServerCountNonNullAggregate>;
  group: McpServerGroupKeys;
  max?: Maybe<McpServerMaxAggregate>;
  min?: Maybe<McpServerMinAggregate>;
  sum?: Maybe<McpServerSumAggregate>;
};

/** Columns of McpServer that a query can group by */
export enum McpServerGroupByColumn {
  Command = 'command',
  Enabled = 'enabled',
  Id = 'id',
  Label = 'label',
  Position = 'position',
  Transport = 'transport',
  Url = 'url'
}

/** The grouped column values of one McpServer group. A column the query did not group by is null. */
export type McpServerGroupKeys = {
  command?: Maybe<Scalars['String']['output']>;
  enabled?: Maybe<Scalars['Boolean']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  label?: Maybe<Scalars['String']['output']>;
  position?: Maybe<Scalars['Int']['output']>;
  transport?: Maybe<McpServersTransportEnum>;
  url?: Maybe<Scalars['String']['output']>;
};

/** Filters McpServer groups by their aggregated values */
export type McpServerHaving = {
  avg?: InputMaybe<McpServerAvgHaving>;
  /** Filters groups by how many rows they contain */
  count?: InputMaybe<AggregateNumberFilter>;
  countDistinct?: InputMaybe<McpServerCountDistinctHaving>;
  countNonNull?: InputMaybe<McpServerCountNonNullHaving>;
  max?: InputMaybe<McpServerMaxHaving>;
  min?: InputMaybe<McpServerMinHaving>;
  sum?: InputMaybe<McpServerSumHaving>;
};

export type McpServerInput = {
  args?: InputMaybe<Array<Scalars['String']['input']>>;
  command?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  env?: InputMaybe<Scalars['JSON']['input']>;
  headers?: InputMaybe<Scalars['JSON']['input']>;
  id: Scalars['String']['input'];
  label?: InputMaybe<Scalars['String']['input']>;
  transport?: InputMaybe<McpTransport>;
  url?: InputMaybe<Scalars['String']['input']>;
};

export type McpServerMaxAggregate = {
  command?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  label?: Maybe<Scalars['String']['output']>;
  position?: Maybe<Scalars['Int']['output']>;
  transport?: Maybe<McpServersTransportEnum>;
  url?: Maybe<Scalars['String']['output']>;
};

export type McpServerMaxHaving = {
  position?: InputMaybe<AggregateNumberFilter>;
};

export type McpServerMinAggregate = {
  command?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  label?: Maybe<Scalars['String']['output']>;
  position?: Maybe<Scalars['Int']['output']>;
  transport?: Maybe<McpServersTransportEnum>;
  url?: Maybe<Scalars['String']['output']>;
};

export type McpServerMinHaving = {
  position?: InputMaybe<AggregateNumberFilter>;
};

export type McpServerOrderBy = {
  args?: InputMaybe<InnerOrder>;
  command?: InputMaybe<InnerOrder>;
  enabled?: InputMaybe<InnerOrder>;
  env?: InputMaybe<InnerOrder>;
  headers?: InputMaybe<InnerOrder>;
  id?: InputMaybe<InnerOrder>;
  label?: InputMaybe<InnerOrder>;
  position?: InputMaybe<InnerOrder>;
  transport?: InputMaybe<InnerOrder>;
  url?: InputMaybe<InnerOrder>;
};

/** A configured server and what the connection to it is currently doing. */
export type McpServerState = {
  config: McpServerConfig;
  error?: Maybe<Scalars['String']['output']>;
  /** disabled | connecting | ready | error */
  status: Scalars['String']['output'];
  tools: Array<McpTool>;
};

export type McpServerSumAggregate = {
  position?: Maybe<Scalars['Float']['output']>;
};

export type McpServerSumHaving = {
  position?: InputMaybe<AggregateNumberFilter>;
};

export enum McpServersTransportEnum {
  /** Value: http */
  Http = 'http',
  /** Value: stdio */
  Stdio = 'stdio'
}

export type McpServersTransportEnumFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<McpServersTransportEnumFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<McpServersTransportEnumFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<McpServersTransportEnumFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<McpServersTransportEnum>;
  /** Greater than */
  gt?: InputMaybe<McpServersTransportEnum>;
  /** Greater than or equal to */
  gte?: InputMaybe<McpServersTransportEnum>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<McpServersTransportEnum>>;
  /** When true, every comparison operator in this object matches case-insensitively — `eq`, `ne`, the ordering operators, `inArray`/`notInArray` and the pattern operators all compare `lower(column)` against `lower(operand)`. Applies only to the operators beside it; a nested `AND`/`OR`/`NOT` branch sets its own. */
  insensitive?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<McpServersTransportEnum>;
  /** Less than or equal to */
  lte?: InputMaybe<McpServersTransportEnum>;
  /** Not equal to */
  ne?: InputMaybe<McpServersTransportEnum>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<McpServersTransportEnum>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type McpTool = {
  description: Scalars['String']['output'];
  name: Scalars['String']['output'];
};

export enum McpTransport {
  Http = 'http',
  Stdio = 'stdio'
}

export type Message = {
  content?: Maybe<Scalars['JSON']['output']>;
  createdAt: Scalars['DateTime']['output'];
  /** Opaque cursor of this row's position in the query's ordering. Pass it as `after` to resume from here. Only set on rows returned by a list query. */
  cursor?: Maybe<Scalars['String']['output']>;
  followups?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['String']['output'];
  idx: Scalars['Int']['output'];
  reasoningContent?: Maybe<Scalars['String']['output']>;
  role: MessagesRoleEnum;
  session: Session;
  sessionId: Scalars['String']['output'];
  stats?: Maybe<Scalars['JSON']['output']>;
  toolCallId?: Maybe<Scalars['String']['output']>;
  toolCalls?: Maybe<Scalars['JSON']['output']>;
};


export type MessageSessionArgs = {
  where?: InputMaybe<SessionFilters>;
};

export type MessageAggregate = {
  avg?: Maybe<MessageAvgAggregate>;
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<MessageCountDistinctAggregate>;
  countNonNull?: Maybe<MessageCountNonNullAggregate>;
  max?: Maybe<MessageMaxAggregate>;
  min?: Maybe<MessageMinAggregate>;
  sum?: Maybe<MessageSumAggregate>;
};

export type MessageAvgAggregate = {
  idx?: Maybe<Scalars['Float']['output']>;
};

export type MessageAvgHaving = {
  idx?: InputMaybe<AggregateNumberFilter>;
};

export type MessageCountDistinctAggregate = {
  createdAt: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  idx: Scalars['Int']['output'];
  reasoningContent: Scalars['Int']['output'];
  role: Scalars['Int']['output'];
  sessionId: Scalars['Int']['output'];
  toolCallId: Scalars['Int']['output'];
};

export type MessageCountDistinctHaving = {
  createdAt?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  idx?: InputMaybe<AggregateNumberFilter>;
  reasoningContent?: InputMaybe<AggregateNumberFilter>;
  role?: InputMaybe<AggregateNumberFilter>;
  sessionId?: InputMaybe<AggregateNumberFilter>;
  toolCallId?: InputMaybe<AggregateNumberFilter>;
};

export type MessageCountNonNullAggregate = {
  content: Scalars['Int']['output'];
  createdAt: Scalars['Int']['output'];
  followups: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  idx: Scalars['Int']['output'];
  reasoningContent: Scalars['Int']['output'];
  role: Scalars['Int']['output'];
  sessionId: Scalars['Int']['output'];
  stats: Scalars['Int']['output'];
  toolCallId: Scalars['Int']['output'];
  toolCalls: Scalars['Int']['output'];
};

export type MessageCountNonNullHaving = {
  content?: InputMaybe<AggregateNumberFilter>;
  createdAt?: InputMaybe<AggregateNumberFilter>;
  followups?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  idx?: InputMaybe<AggregateNumberFilter>;
  reasoningContent?: InputMaybe<AggregateNumberFilter>;
  role?: InputMaybe<AggregateNumberFilter>;
  sessionId?: InputMaybe<AggregateNumberFilter>;
  stats?: InputMaybe<AggregateNumberFilter>;
  toolCallId?: InputMaybe<AggregateNumberFilter>;
  toolCalls?: InputMaybe<AggregateNumberFilter>;
};

/** Columns of Message that a query can be made distinct on */
export enum MessageDistinctColumn {
  Content = 'content',
  CreatedAt = 'createdAt',
  Followups = 'followups',
  Id = 'id',
  Idx = 'idx',
  ReasoningContent = 'reasoningContent',
  Role = 'role',
  SessionId = 'sessionId',
  Stats = 'stats',
  ToolCallId = 'toolCallId',
  ToolCalls = 'toolCalls'
}

export type MessageFilters = {
  /** Every branch matches */
  AND?: InputMaybe<Array<MessageFilters>>;
  /** Negates the nested filters */
  NOT?: InputMaybe<MessageFilters>;
  /** At least one branch matches; ANDed with any sibling fields */
  OR?: InputMaybe<Array<MessageFilters>>;
  content?: InputMaybe<JsonFilter>;
  createdAt?: InputMaybe<DateTimeFilter>;
  followups?: InputMaybe<JsonFilter>;
  id?: InputMaybe<StringFilter>;
  idx?: InputMaybe<IntFilter>;
  reasoningContent?: InputMaybe<StringFilter>;
  role?: InputMaybe<MessagesRoleEnumFilter>;
  /** Matches rows whose session matches these filters */
  session?: InputMaybe<SessionFilters>;
  sessionId?: InputMaybe<StringFilter>;
  stats?: InputMaybe<JsonFilter>;
  toolCallId?: InputMaybe<StringFilter>;
  toolCalls?: InputMaybe<JsonFilter>;
};

export type MessageGroupBy = {
  avg?: Maybe<MessageAvgAggregate>;
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<MessageCountDistinctAggregate>;
  countNonNull?: Maybe<MessageCountNonNullAggregate>;
  group: MessageGroupKeys;
  max?: Maybe<MessageMaxAggregate>;
  min?: Maybe<MessageMinAggregate>;
  sum?: Maybe<MessageSumAggregate>;
};

/** Columns of Message that a query can group by */
export enum MessageGroupByColumn {
  CreatedAt = 'createdAt',
  Id = 'id',
  Idx = 'idx',
  ReasoningContent = 'reasoningContent',
  Role = 'role',
  SessionId = 'sessionId',
  ToolCallId = 'toolCallId'
}

/** The grouped column values of one Message group. A column the query did not group by is null. */
export type MessageGroupKeys = {
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  idx?: Maybe<Scalars['Int']['output']>;
  reasoningContent?: Maybe<Scalars['String']['output']>;
  role?: Maybe<MessagesRoleEnum>;
  sessionId?: Maybe<Scalars['String']['output']>;
  toolCallId?: Maybe<Scalars['String']['output']>;
};

/** Filters Message groups by their aggregated values */
export type MessageHaving = {
  avg?: InputMaybe<MessageAvgHaving>;
  /** Filters groups by how many rows they contain */
  count?: InputMaybe<AggregateNumberFilter>;
  countDistinct?: InputMaybe<MessageCountDistinctHaving>;
  countNonNull?: InputMaybe<MessageCountNonNullHaving>;
  max?: InputMaybe<MessageMaxHaving>;
  min?: InputMaybe<MessageMinHaving>;
  sum?: InputMaybe<MessageSumHaving>;
};

export type MessageListRelationFilter = {
  /** Every related row matches */
  every?: InputMaybe<MessageFilters>;
  /** No related row matches */
  none?: InputMaybe<MessageFilters>;
  /** At least one related row matches */
  some?: InputMaybe<MessageFilters>;
};

export type MessageMaxAggregate = {
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  idx?: Maybe<Scalars['Int']['output']>;
  reasoningContent?: Maybe<Scalars['String']['output']>;
  role?: Maybe<MessagesRoleEnum>;
  sessionId?: Maybe<Scalars['String']['output']>;
  toolCallId?: Maybe<Scalars['String']['output']>;
};

export type MessageMaxHaving = {
  idx?: InputMaybe<AggregateNumberFilter>;
};

export type MessageMinAggregate = {
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  idx?: Maybe<Scalars['Int']['output']>;
  reasoningContent?: Maybe<Scalars['String']['output']>;
  role?: Maybe<MessagesRoleEnum>;
  sessionId?: Maybe<Scalars['String']['output']>;
  toolCallId?: Maybe<Scalars['String']['output']>;
};

export type MessageMinHaving = {
  idx?: InputMaybe<AggregateNumberFilter>;
};

export type MessageOrderBy = {
  content?: InputMaybe<InnerOrder>;
  createdAt?: InputMaybe<InnerOrder>;
  followups?: InputMaybe<InnerOrder>;
  id?: InputMaybe<InnerOrder>;
  idx?: InputMaybe<InnerOrder>;
  reasoningContent?: InputMaybe<InnerOrder>;
  role?: InputMaybe<InnerOrder>;
  /** Order by columns of the related session row */
  session?: InputMaybe<SessionOrderBy>;
  sessionId?: InputMaybe<InnerOrder>;
  stats?: InputMaybe<InnerOrder>;
  toolCallId?: InputMaybe<InnerOrder>;
  toolCalls?: InputMaybe<InnerOrder>;
};

export type MessageSumAggregate = {
  idx?: Maybe<Scalars['Float']['output']>;
};

export type MessageSumHaving = {
  idx?: InputMaybe<AggregateNumberFilter>;
};

export enum MessagesRoleEnum {
  /** Value: assistant */
  Assistant = 'assistant',
  /** Value: developer */
  Developer = 'developer',
  /** Value: system */
  System = 'system',
  /** Value: tool */
  Tool = 'tool',
  /** Value: user */
  User = 'user'
}

export type MessagesRoleEnumFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<MessagesRoleEnumFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<MessagesRoleEnumFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<MessagesRoleEnumFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<MessagesRoleEnum>;
  /** Greater than */
  gt?: InputMaybe<MessagesRoleEnum>;
  /** Greater than or equal to */
  gte?: InputMaybe<MessagesRoleEnum>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<MessagesRoleEnum>>;
  /** When true, every comparison operator in this object matches case-insensitively — `eq`, `ne`, the ordering operators, `inArray`/`notInArray` and the pattern operators all compare `lower(column)` against `lower(operand)`. Applies only to the operators beside it; a nested `AND`/`OR`/`NOT` branch sets its own. */
  insensitive?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<MessagesRoleEnum>;
  /** Less than or equal to */
  lte?: InputMaybe<MessagesRoleEnum>;
  /** Not equal to */
  ne?: InputMaybe<MessagesRoleEnum>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<MessagesRoleEnum>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type ModelInfo = {
  /** The model's window, when the server reports one. Null when it does not. */
  contextLength?: Maybe<Scalars['Int']['output']>;
  id: Scalars['String']['output'];
};

export type Mutation = {
  createSession: Session;
  createSessions: Array<Session>;
  deleteSession: Array<Session>;
  deleteSessionSingle?: Maybe<Session>;
  /** Tears down one server's connection and dials it again. */
  reconnectMcpServer: Array<McpServerState>;
  /** Replaces the configured embeds. Saved whole rather than row by row: an embed's id is the route its view lives at, so a rename is a new destination and the screen edits the list as a list. */
  saveEmbeds: Array<Embed>;
  /** Replaces the configured set and reconnects. The list is edited and saved whole — a server's id is the namespace its tools live under, so renaming one is a different server, not an edited row. */
  saveMcpServers: Array<McpServerState>;
  /** Writes the API key. Separate from the settings update because the key is write-only: it is excluded from `Setting` so it can never be read back out. An empty string clears it and falls back to $OPENAI_API_KEY. */
  setApiKey: Scalars['Boolean']['output'];
  /** Forgets every message from `fromIdx` on, and answers with how many are left. The only write that removes a message: retrying a reply and editing a question both mean going again from a point, and what follows that point is an answer to something no longer being asked. A suffix only, so `idx` stays dense. */
  truncateSession: Scalars['Int']['output'];
  updateSession: Array<Session>;
  updateSessionSingle?: Maybe<Session>;
  /** Each entry's updated rows, in entry order. An entry whose `where` matched no rows contributes `null` in its slot; an entry that matched several contributes each of its rows. */
  updateSessionsMany: Array<Maybe<Session>>;
  updateSetting: Array<Setting>;
  updateSettingSingle?: Maybe<Setting>;
  /** Each entry's updated rows, in entry order. An entry whose `where` matched no rows contributes `null` in its slot; an entry that matched several contributes each of its rows. */
  updateSettingsMany: Array<Maybe<Setting>>;
};


export type MutationCreateSessionArgs = {
  values: CreateSessionInput;
};


export type MutationCreateSessionsArgs = {
  values: Array<CreateSessionInput>;
};


export type MutationDeleteSessionArgs = {
  where?: InputMaybe<SessionFilters>;
};


export type MutationDeleteSessionSingleArgs = {
  where: SessionFilters;
};


export type MutationReconnectMcpServerArgs = {
  id: Scalars['String']['input'];
};


export type MutationSaveEmbedsArgs = {
  embeds: Array<EmbedInput>;
};


export type MutationSaveMcpServersArgs = {
  servers: Array<McpServerInput>;
};


export type MutationSetApiKeyArgs = {
  apiKey: Scalars['String']['input'];
};


export type MutationTruncateSessionArgs = {
  fromIdx: Scalars['Int']['input'];
  id: Scalars['String']['input'];
};


export type MutationUpdateSessionArgs = {
  set: UpdateSessionInput;
  where?: InputMaybe<SessionFilters>;
};


export type MutationUpdateSessionSingleArgs = {
  set: UpdateSessionInput;
  where: SessionFilters;
};


export type MutationUpdateSessionsManyArgs = {
  updates: Array<UpdateSessionManyInput>;
};


export type MutationUpdateSettingArgs = {
  set: UpdateSettingInput;
  where?: InputMaybe<SettingFilters>;
};


export type MutationUpdateSettingSingleArgs = {
  set: UpdateSettingInput;
  where: SettingFilters;
};


export type MutationUpdateSettingsManyArgs = {
  updates: Array<UpdateSettingManyInput>;
};

/** Order by direction */
export enum OrderDirection {
  /** Ascending order */
  Asc = 'asc',
  /** Descending order */
  Desc = 'desc'
}

/** Where NULL values sort relative to non-NULL values */
export enum OrderNulls {
  /** NULL values sort before all non-NULL values */
  First = 'first',
  /** NULL values sort after all non-NULL values */
  Last = 'last'
}

export type Query = {
  embed?: Maybe<Embed>;
  embeds: Array<Embed>;
  embedsAggregate: EmbedAggregate;
  embedsGroupBy: Array<EmbedGroupBy>;
  /** Whether a key is set, without saying what it is. The Config tab shows a filled placeholder rather than an empty box; the key itself is excluded from `Setting`. */
  hasApiKey: Scalars['Boolean']['output'];
  /** Answers only once the settings are loaded and the schema is up. */
  health: Health;
  mcpServer?: Maybe<McpServer>;
  mcpServers: Array<McpServer>;
  mcpServersAggregate: McpServerAggregate;
  mcpServersGroupBy: Array<McpServerGroupBy>;
  /** Every configured MCP server, with its live connection state and tools. */
  mcpStatus: Array<McpServerState>;
  message?: Maybe<Message>;
  messages: Array<Message>;
  messagesAggregate: MessageAggregate;
  messagesGroupBy: Array<MessageGroupBy>;
  /** Models the configured OpenAI-compatible server reports, id-sorted. */
  models: Array<ModelInfo>;
  session?: Maybe<Session>;
  sessions: Array<Session>;
  sessionsAggregate: SessionAggregate;
  sessionsGroupBy: Array<SessionGroupBy>;
  setting?: Maybe<Setting>;
  settings: Array<Setting>;
  settingsAggregate: SettingAggregate;
  settingsGroupBy: Array<SettingGroupBy>;
};


export type QueryEmbedArgs = {
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<EmbedOrderBy>;
  where?: InputMaybe<EmbedFilters>;
};


export type QueryEmbedsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  distinct?: InputMaybe<Array<EmbedDistinctColumn>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<EmbedOrderBy>;
  where?: InputMaybe<EmbedFilters>;
};


export type QueryEmbedsAggregateArgs = {
  where?: InputMaybe<EmbedFilters>;
};


export type QueryEmbedsGroupByArgs = {
  groupBy: Array<EmbedGroupByColumn>;
  having?: InputMaybe<EmbedHaving>;
  where?: InputMaybe<EmbedFilters>;
};


export type QueryMcpServerArgs = {
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<McpServerOrderBy>;
  where?: InputMaybe<McpServerFilters>;
};


export type QueryMcpServersArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  distinct?: InputMaybe<Array<McpServerDistinctColumn>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<McpServerOrderBy>;
  where?: InputMaybe<McpServerFilters>;
};


export type QueryMcpServersAggregateArgs = {
  where?: InputMaybe<McpServerFilters>;
};


export type QueryMcpServersGroupByArgs = {
  groupBy: Array<McpServerGroupByColumn>;
  having?: InputMaybe<McpServerHaving>;
  where?: InputMaybe<McpServerFilters>;
};


export type QueryMessageArgs = {
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<MessageOrderBy>;
  where?: InputMaybe<MessageFilters>;
};


export type QueryMessagesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  distinct?: InputMaybe<Array<MessageDistinctColumn>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<MessageOrderBy>;
  where?: InputMaybe<MessageFilters>;
};


export type QueryMessagesAggregateArgs = {
  where?: InputMaybe<MessageFilters>;
};


export type QueryMessagesGroupByArgs = {
  groupBy: Array<MessageGroupByColumn>;
  having?: InputMaybe<MessageHaving>;
  where?: InputMaybe<MessageFilters>;
};


export type QuerySessionArgs = {
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<SessionOrderBy>;
  where?: InputMaybe<SessionFilters>;
};


export type QuerySessionsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  distinct?: InputMaybe<Array<SessionDistinctColumn>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<SessionOrderBy>;
  where?: InputMaybe<SessionFilters>;
};


export type QuerySessionsAggregateArgs = {
  where?: InputMaybe<SessionFilters>;
};


export type QuerySessionsGroupByArgs = {
  groupBy: Array<SessionGroupByColumn>;
  having?: InputMaybe<SessionHaving>;
  where?: InputMaybe<SessionFilters>;
};


export type QuerySettingArgs = {
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<SettingOrderBy>;
  where?: InputMaybe<SettingFilters>;
};


export type QuerySettingsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  distinct?: InputMaybe<Array<SettingDistinctColumn>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<SettingOrderBy>;
  where?: InputMaybe<SettingFilters>;
};


export type QuerySettingsAggregateArgs = {
  where?: InputMaybe<SettingFilters>;
};


export type QuerySettingsGroupByArgs = {
  groupBy: Array<SettingGroupByColumn>;
  having?: InputMaybe<SettingHaving>;
  where?: InputMaybe<SettingFilters>;
};

export type Session = {
  compaction?: Maybe<Scalars['JSON']['output']>;
  createdAt: Scalars['DateTime']['output'];
  /** Opaque cursor of this row's position in the query's ordering. Pass it as `after` to resume from here. Only set on rows returned by a list query. */
  cursor?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  loadedTools: Scalars['JSON']['output'];
  messageCount: Scalars['Int']['output'];
  messages: Array<Message>;
  messagesAggregate: MessageAggregate;
  model: Scalars['String']['output'];
  title: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
  usage?: Maybe<Scalars['JSON']['output']>;
};


export type SessionMessagesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  distinct?: InputMaybe<Array<MessageDistinctColumn>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<MessageOrderBy>;
  where?: InputMaybe<MessageFilters>;
};


export type SessionMessagesAggregateArgs = {
  where?: InputMaybe<MessageFilters>;
};

export type SessionAggregate = {
  avg?: Maybe<SessionAvgAggregate>;
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<SessionCountDistinctAggregate>;
  countNonNull?: Maybe<SessionCountNonNullAggregate>;
  max?: Maybe<SessionMaxAggregate>;
  min?: Maybe<SessionMinAggregate>;
  sum?: Maybe<SessionSumAggregate>;
};

export type SessionAvgAggregate = {
  messageCount?: Maybe<Scalars['Float']['output']>;
};

export type SessionAvgHaving = {
  messageCount?: InputMaybe<AggregateNumberFilter>;
};

export type SessionCountDistinctAggregate = {
  createdAt: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  messageCount: Scalars['Int']['output'];
  model: Scalars['Int']['output'];
  title: Scalars['Int']['output'];
  updatedAt: Scalars['Int']['output'];
};

export type SessionCountDistinctHaving = {
  createdAt?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  messageCount?: InputMaybe<AggregateNumberFilter>;
  model?: InputMaybe<AggregateNumberFilter>;
  title?: InputMaybe<AggregateNumberFilter>;
  updatedAt?: InputMaybe<AggregateNumberFilter>;
};

export type SessionCountNonNullAggregate = {
  compaction: Scalars['Int']['output'];
  createdAt: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  loadedTools: Scalars['Int']['output'];
  messageCount: Scalars['Int']['output'];
  model: Scalars['Int']['output'];
  title: Scalars['Int']['output'];
  updatedAt: Scalars['Int']['output'];
  usage: Scalars['Int']['output'];
};

export type SessionCountNonNullHaving = {
  compaction?: InputMaybe<AggregateNumberFilter>;
  createdAt?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  loadedTools?: InputMaybe<AggregateNumberFilter>;
  messageCount?: InputMaybe<AggregateNumberFilter>;
  model?: InputMaybe<AggregateNumberFilter>;
  title?: InputMaybe<AggregateNumberFilter>;
  updatedAt?: InputMaybe<AggregateNumberFilter>;
  usage?: InputMaybe<AggregateNumberFilter>;
};

/** Columns of Session that a query can be made distinct on */
export enum SessionDistinctColumn {
  Compaction = 'compaction',
  CreatedAt = 'createdAt',
  Id = 'id',
  LoadedTools = 'loadedTools',
  MessageCount = 'messageCount',
  Model = 'model',
  Title = 'title',
  UpdatedAt = 'updatedAt',
  Usage = 'usage'
}

export type SessionFilters = {
  /** Every branch matches */
  AND?: InputMaybe<Array<SessionFilters>>;
  /** Negates the nested filters */
  NOT?: InputMaybe<SessionFilters>;
  /** At least one branch matches; ANDed with any sibling fields */
  OR?: InputMaybe<Array<SessionFilters>>;
  compaction?: InputMaybe<JsonFilter>;
  createdAt?: InputMaybe<DateTimeFilter>;
  id?: InputMaybe<StringFilter>;
  loadedTools?: InputMaybe<JsonFilter>;
  messageCount?: InputMaybe<IntFilter>;
  messages?: InputMaybe<MessageListRelationFilter>;
  model?: InputMaybe<StringFilter>;
  title?: InputMaybe<StringFilter>;
  updatedAt?: InputMaybe<DateTimeFilter>;
  usage?: InputMaybe<JsonFilter>;
};

export type SessionGroupBy = {
  avg?: Maybe<SessionAvgAggregate>;
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<SessionCountDistinctAggregate>;
  countNonNull?: Maybe<SessionCountNonNullAggregate>;
  group: SessionGroupKeys;
  max?: Maybe<SessionMaxAggregate>;
  min?: Maybe<SessionMinAggregate>;
  sum?: Maybe<SessionSumAggregate>;
};

/** Columns of Session that a query can group by */
export enum SessionGroupByColumn {
  CreatedAt = 'createdAt',
  Id = 'id',
  MessageCount = 'messageCount',
  Model = 'model',
  Title = 'title',
  UpdatedAt = 'updatedAt'
}

/** The grouped column values of one Session group. A column the query did not group by is null. */
export type SessionGroupKeys = {
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  messageCount?: Maybe<Scalars['Int']['output']>;
  model?: Maybe<Scalars['String']['output']>;
  title?: Maybe<Scalars['String']['output']>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};

/** Filters Session groups by their aggregated values */
export type SessionHaving = {
  avg?: InputMaybe<SessionAvgHaving>;
  /** Filters groups by how many rows they contain */
  count?: InputMaybe<AggregateNumberFilter>;
  countDistinct?: InputMaybe<SessionCountDistinctHaving>;
  countNonNull?: InputMaybe<SessionCountNonNullHaving>;
  max?: InputMaybe<SessionMaxHaving>;
  min?: InputMaybe<SessionMinHaving>;
  sum?: InputMaybe<SessionSumHaving>;
};

export type SessionMaxAggregate = {
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  messageCount?: Maybe<Scalars['Int']['output']>;
  model?: Maybe<Scalars['String']['output']>;
  title?: Maybe<Scalars['String']['output']>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};

export type SessionMaxHaving = {
  messageCount?: InputMaybe<AggregateNumberFilter>;
};

export type SessionMinAggregate = {
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  messageCount?: Maybe<Scalars['Int']['output']>;
  model?: Maybe<Scalars['String']['output']>;
  title?: Maybe<Scalars['String']['output']>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};

export type SessionMinHaving = {
  messageCount?: InputMaybe<AggregateNumberFilter>;
};

export type SessionOrderBy = {
  compaction?: InputMaybe<InnerOrder>;
  createdAt?: InputMaybe<InnerOrder>;
  id?: InputMaybe<InnerOrder>;
  loadedTools?: InputMaybe<InnerOrder>;
  messageCount?: InputMaybe<InnerOrder>;
  model?: InputMaybe<InnerOrder>;
  title?: InputMaybe<InnerOrder>;
  updatedAt?: InputMaybe<InnerOrder>;
  usage?: InputMaybe<InnerOrder>;
};

export type SessionSumAggregate = {
  messageCount?: Maybe<Scalars['Float']['output']>;
};

export type SessionSumHaving = {
  messageCount?: InputMaybe<AggregateNumberFilter>;
};

export type Setting = {
  baseUrl: Scalars['String']['output'];
  contextLimit: Scalars['Int']['output'];
  /** Opaque cursor of this row's position in the query's ordering. Pass it as `after` to resume from here. Only set on rows returned by a list query. */
  cursor?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  maxTokens: Scalars['Int']['output'];
  maxToolIterations: Scalars['Int']['output'];
  model: Scalars['String']['output'];
  pricing: Scalars['JSON']['output'];
  systemPrompt: Scalars['String']['output'];
  taskModels: Scalars['JSON']['output'];
  temperature: Scalars['Float']['output'];
  toolDiscovery: SettingsToolDiscoveryEnum;
};

export type SettingAggregate = {
  avg?: Maybe<SettingAvgAggregate>;
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<SettingCountDistinctAggregate>;
  countNonNull?: Maybe<SettingCountNonNullAggregate>;
  max?: Maybe<SettingMaxAggregate>;
  min?: Maybe<SettingMinAggregate>;
  sum?: Maybe<SettingSumAggregate>;
};

export type SettingAvgAggregate = {
  contextLimit?: Maybe<Scalars['Float']['output']>;
  maxTokens?: Maybe<Scalars['Float']['output']>;
  maxToolIterations?: Maybe<Scalars['Float']['output']>;
  temperature?: Maybe<Scalars['Float']['output']>;
};

export type SettingAvgHaving = {
  contextLimit?: InputMaybe<AggregateNumberFilter>;
  maxTokens?: InputMaybe<AggregateNumberFilter>;
  maxToolIterations?: InputMaybe<AggregateNumberFilter>;
  temperature?: InputMaybe<AggregateNumberFilter>;
};

export type SettingCountDistinctAggregate = {
  baseUrl: Scalars['Int']['output'];
  contextLimit: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  maxTokens: Scalars['Int']['output'];
  maxToolIterations: Scalars['Int']['output'];
  model: Scalars['Int']['output'];
  systemPrompt: Scalars['Int']['output'];
  temperature: Scalars['Int']['output'];
  toolDiscovery: Scalars['Int']['output'];
};

export type SettingCountDistinctHaving = {
  baseUrl?: InputMaybe<AggregateNumberFilter>;
  contextLimit?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  maxTokens?: InputMaybe<AggregateNumberFilter>;
  maxToolIterations?: InputMaybe<AggregateNumberFilter>;
  model?: InputMaybe<AggregateNumberFilter>;
  systemPrompt?: InputMaybe<AggregateNumberFilter>;
  temperature?: InputMaybe<AggregateNumberFilter>;
  toolDiscovery?: InputMaybe<AggregateNumberFilter>;
};

export type SettingCountNonNullAggregate = {
  baseUrl: Scalars['Int']['output'];
  contextLimit: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  maxTokens: Scalars['Int']['output'];
  maxToolIterations: Scalars['Int']['output'];
  model: Scalars['Int']['output'];
  pricing: Scalars['Int']['output'];
  systemPrompt: Scalars['Int']['output'];
  taskModels: Scalars['Int']['output'];
  temperature: Scalars['Int']['output'];
  toolDiscovery: Scalars['Int']['output'];
};

export type SettingCountNonNullHaving = {
  baseUrl?: InputMaybe<AggregateNumberFilter>;
  contextLimit?: InputMaybe<AggregateNumberFilter>;
  id?: InputMaybe<AggregateNumberFilter>;
  maxTokens?: InputMaybe<AggregateNumberFilter>;
  maxToolIterations?: InputMaybe<AggregateNumberFilter>;
  model?: InputMaybe<AggregateNumberFilter>;
  pricing?: InputMaybe<AggregateNumberFilter>;
  systemPrompt?: InputMaybe<AggregateNumberFilter>;
  taskModels?: InputMaybe<AggregateNumberFilter>;
  temperature?: InputMaybe<AggregateNumberFilter>;
  toolDiscovery?: InputMaybe<AggregateNumberFilter>;
};

/** Columns of Setting that a query can be made distinct on */
export enum SettingDistinctColumn {
  BaseUrl = 'baseUrl',
  ContextLimit = 'contextLimit',
  Id = 'id',
  MaxTokens = 'maxTokens',
  MaxToolIterations = 'maxToolIterations',
  Model = 'model',
  Pricing = 'pricing',
  SystemPrompt = 'systemPrompt',
  TaskModels = 'taskModels',
  Temperature = 'temperature',
  ToolDiscovery = 'toolDiscovery'
}

export type SettingFilters = {
  /** Every branch matches */
  AND?: InputMaybe<Array<SettingFilters>>;
  /** Negates the nested filters */
  NOT?: InputMaybe<SettingFilters>;
  /** At least one branch matches; ANDed with any sibling fields */
  OR?: InputMaybe<Array<SettingFilters>>;
  baseUrl?: InputMaybe<StringFilter>;
  contextLimit?: InputMaybe<IntFilter>;
  id?: InputMaybe<StringFilter>;
  maxTokens?: InputMaybe<IntFilter>;
  maxToolIterations?: InputMaybe<IntFilter>;
  model?: InputMaybe<StringFilter>;
  pricing?: InputMaybe<JsonFilter>;
  systemPrompt?: InputMaybe<StringFilter>;
  taskModels?: InputMaybe<JsonFilter>;
  temperature?: InputMaybe<FloatFilter>;
  toolDiscovery?: InputMaybe<SettingsToolDiscoveryEnumFilter>;
};

export type SettingGroupBy = {
  avg?: Maybe<SettingAvgAggregate>;
  count: Scalars['Int']['output'];
  countDistinct?: Maybe<SettingCountDistinctAggregate>;
  countNonNull?: Maybe<SettingCountNonNullAggregate>;
  group: SettingGroupKeys;
  max?: Maybe<SettingMaxAggregate>;
  min?: Maybe<SettingMinAggregate>;
  sum?: Maybe<SettingSumAggregate>;
};

/** Columns of Setting that a query can group by */
export enum SettingGroupByColumn {
  BaseUrl = 'baseUrl',
  ContextLimit = 'contextLimit',
  Id = 'id',
  MaxTokens = 'maxTokens',
  MaxToolIterations = 'maxToolIterations',
  Model = 'model',
  SystemPrompt = 'systemPrompt',
  Temperature = 'temperature',
  ToolDiscovery = 'toolDiscovery'
}

/** The grouped column values of one Setting group. A column the query did not group by is null. */
export type SettingGroupKeys = {
  baseUrl?: Maybe<Scalars['String']['output']>;
  contextLimit?: Maybe<Scalars['Int']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  maxTokens?: Maybe<Scalars['Int']['output']>;
  maxToolIterations?: Maybe<Scalars['Int']['output']>;
  model?: Maybe<Scalars['String']['output']>;
  systemPrompt?: Maybe<Scalars['String']['output']>;
  temperature?: Maybe<Scalars['Float']['output']>;
  toolDiscovery?: Maybe<SettingsToolDiscoveryEnum>;
};

/** Filters Setting groups by their aggregated values */
export type SettingHaving = {
  avg?: InputMaybe<SettingAvgHaving>;
  /** Filters groups by how many rows they contain */
  count?: InputMaybe<AggregateNumberFilter>;
  countDistinct?: InputMaybe<SettingCountDistinctHaving>;
  countNonNull?: InputMaybe<SettingCountNonNullHaving>;
  max?: InputMaybe<SettingMaxHaving>;
  min?: InputMaybe<SettingMinHaving>;
  sum?: InputMaybe<SettingSumHaving>;
};

export type SettingMaxAggregate = {
  baseUrl?: Maybe<Scalars['String']['output']>;
  contextLimit?: Maybe<Scalars['Int']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  maxTokens?: Maybe<Scalars['Int']['output']>;
  maxToolIterations?: Maybe<Scalars['Int']['output']>;
  model?: Maybe<Scalars['String']['output']>;
  systemPrompt?: Maybe<Scalars['String']['output']>;
  temperature?: Maybe<Scalars['Float']['output']>;
  toolDiscovery?: Maybe<SettingsToolDiscoveryEnum>;
};

export type SettingMaxHaving = {
  contextLimit?: InputMaybe<AggregateNumberFilter>;
  maxTokens?: InputMaybe<AggregateNumberFilter>;
  maxToolIterations?: InputMaybe<AggregateNumberFilter>;
  temperature?: InputMaybe<AggregateNumberFilter>;
};

export type SettingMinAggregate = {
  baseUrl?: Maybe<Scalars['String']['output']>;
  contextLimit?: Maybe<Scalars['Int']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  maxTokens?: Maybe<Scalars['Int']['output']>;
  maxToolIterations?: Maybe<Scalars['Int']['output']>;
  model?: Maybe<Scalars['String']['output']>;
  systemPrompt?: Maybe<Scalars['String']['output']>;
  temperature?: Maybe<Scalars['Float']['output']>;
  toolDiscovery?: Maybe<SettingsToolDiscoveryEnum>;
};

export type SettingMinHaving = {
  contextLimit?: InputMaybe<AggregateNumberFilter>;
  maxTokens?: InputMaybe<AggregateNumberFilter>;
  maxToolIterations?: InputMaybe<AggregateNumberFilter>;
  temperature?: InputMaybe<AggregateNumberFilter>;
};

export type SettingOrderBy = {
  baseUrl?: InputMaybe<InnerOrder>;
  contextLimit?: InputMaybe<InnerOrder>;
  id?: InputMaybe<InnerOrder>;
  maxTokens?: InputMaybe<InnerOrder>;
  maxToolIterations?: InputMaybe<InnerOrder>;
  model?: InputMaybe<InnerOrder>;
  pricing?: InputMaybe<InnerOrder>;
  systemPrompt?: InputMaybe<InnerOrder>;
  taskModels?: InputMaybe<InnerOrder>;
  temperature?: InputMaybe<InnerOrder>;
  toolDiscovery?: InputMaybe<InnerOrder>;
};

export type SettingSumAggregate = {
  contextLimit?: Maybe<Scalars['Float']['output']>;
  maxTokens?: Maybe<Scalars['Float']['output']>;
  maxToolIterations?: Maybe<Scalars['Float']['output']>;
  temperature?: Maybe<Scalars['Float']['output']>;
};

export type SettingSumHaving = {
  contextLimit?: InputMaybe<AggregateNumberFilter>;
  maxTokens?: InputMaybe<AggregateNumberFilter>;
  maxToolIterations?: InputMaybe<AggregateNumberFilter>;
  temperature?: InputMaybe<AggregateNumberFilter>;
};

export enum SettingsToolDiscoveryEnum {
  /** Value: eager */
  Eager = 'eager',
  /** Value: ondemand */
  Ondemand = 'ondemand'
}

export type SettingsToolDiscoveryEnumFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<SettingsToolDiscoveryEnumFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<SettingsToolDiscoveryEnumFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<SettingsToolDiscoveryEnumFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<SettingsToolDiscoveryEnum>;
  /** Greater than */
  gt?: InputMaybe<SettingsToolDiscoveryEnum>;
  /** Greater than or equal to */
  gte?: InputMaybe<SettingsToolDiscoveryEnum>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<SettingsToolDiscoveryEnum>>;
  /** When true, every comparison operator in this object matches case-insensitively — `eq`, `ne`, the ordering operators, `inArray`/`notInArray` and the pattern operators all compare `lower(column)` against `lower(operand)`. Applies only to the operators beside it; a nested `AND`/`OR`/`NOT` branch sets its own. */
  insensitive?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<SettingsToolDiscoveryEnum>;
  /** Less than or equal to */
  lte?: InputMaybe<SettingsToolDiscoveryEnum>;
  /** Not equal to */
  ne?: InputMaybe<SettingsToolDiscoveryEnum>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<SettingsToolDiscoveryEnum>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type StringFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<StringFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<StringFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<StringFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<Scalars['String']['input']>;
  /** Greater than */
  gt?: InputMaybe<Scalars['String']['input']>;
  /** Greater than or equal to */
  gte?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<Scalars['String']['input']>>;
  /** When true, every comparison operator in this object matches case-insensitively — `eq`, `ne`, the ordering operators, `inArray`/`notInArray` and the pattern operators all compare `lower(column)` against `lower(operand)`. Applies only to the operators beside it; a nested `AND`/`OR`/`NOT` branch sets its own. */
  insensitive?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<Scalars['String']['input']>;
  /** Less than or equal to */
  lte?: InputMaybe<Scalars['String']['input']>;
  /** Not equal to */
  ne?: InputMaybe<Scalars['String']['input']>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<Scalars['String']['input']>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type Subscription = {
  /** Runs one turn and streams what it says. Subscribing starts the turn; ending the subscription stops it, keeping whatever it had already written. */
  turn: TurnEvent;
};


export type SubscriptionTurnArgs = {
  model?: InputMaybe<Scalars['String']['input']>;
  prompt: Scalars['String']['input'];
  sessionId: Scalars['String']['input'];
};

/** Something a turn did while it was running — a token, a tool call, its final cost. `type` discriminates; the fields that do not belong to it are null. */
export type TurnEvent = {
  content?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  input?: Maybe<Scalars['String']['output']>;
  isError?: Maybe<Scalars['Boolean']['output']>;
  items?: Maybe<Array<Scalars['String']['output']>>;
  message?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  /** Per-turn counter from 1. */
  seq: Scalars['Int']['output'];
  stats?: Maybe<Scalars['JSON']['output']>;
  text?: Maybe<Scalars['String']['output']>;
  title?: Maybe<Scalars['String']['output']>;
  toolUseId?: Maybe<Scalars['String']['output']>;
  /** reasoning_delta | text_delta | tool_use | tool_result | title | stats | done | followups | error. */
  type: Scalars['String']['output'];
};

export type UpdateSessionInput = {
  compaction?: InputMaybe<Scalars['JSON']['input']>;
  createdAt?: InputMaybe<Scalars['DateTime']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  loadedTools?: InputMaybe<Scalars['JSON']['input']>;
  messageCount?: InputMaybe<Scalars['Int']['input']>;
  model?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
  updatedAt?: InputMaybe<Scalars['DateTime']['input']>;
  usage?: InputMaybe<Scalars['JSON']['input']>;
};

/** One entry of a batch update of Session: the rows `where` matches get this entry's `set` applied. */
export type UpdateSessionManyInput = {
  set: UpdateSessionInput;
  /** Rows this entry updates. An omitted filter updates every row. */
  where?: InputMaybe<SessionFilters>;
};

export type UpdateSettingInput = {
  baseUrl?: InputMaybe<Scalars['String']['input']>;
  contextLimit?: InputMaybe<Scalars['Int']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  maxTokens?: InputMaybe<Scalars['Int']['input']>;
  maxToolIterations?: InputMaybe<Scalars['Int']['input']>;
  model?: InputMaybe<Scalars['String']['input']>;
  pricing?: InputMaybe<Scalars['JSON']['input']>;
  systemPrompt?: InputMaybe<Scalars['String']['input']>;
  taskModels?: InputMaybe<Scalars['JSON']['input']>;
  temperature?: InputMaybe<Scalars['Float']['input']>;
  toolDiscovery?: InputMaybe<SettingsToolDiscoveryEnum>;
};

/** One entry of a batch update of Setting: the rows `where` matches get this entry's `set` applied. */
export type UpdateSettingManyInput = {
  set: UpdateSettingInput;
  /** Rows this entry updates. An omitted filter updates every row. */
  where?: InputMaybe<SettingFilters>;
};

export type EmbedFragment = { id: string, label: string, url: string, icon: string, mode: EmbedsModeEnum, enabled: boolean };

export type EmbedsQueryVariables = Exact<{ [key: string]: never; }>;


export type EmbedsQuery = { embeds: Array<{ id: string, label: string, url: string, icon: string, mode: EmbedsModeEnum, enabled: boolean }> };

export type SaveEmbedsMutationVariables = Exact<{
  embeds: Array<EmbedInput> | EmbedInput;
}>;


export type SaveEmbedsMutation = { saveEmbeds: Array<{ id: string, label: string, url: string, icon: string, mode: EmbedsModeEnum, enabled: boolean }> };

export type McpStateFragment = { status: string, error?: string | null, config: { id: string, label: string, enabled: boolean, transport: McpTransport, command: string, args: Array<string>, env: unknown, url: string, headers: unknown }, tools: Array<{ name: string, description: string }> };

export type McpStatusQueryVariables = Exact<{ [key: string]: never; }>;


export type McpStatusQuery = { mcpStatus: Array<{ status: string, error?: string | null, config: { id: string, label: string, enabled: boolean, transport: McpTransport, command: string, args: Array<string>, env: unknown, url: string, headers: unknown }, tools: Array<{ name: string, description: string }> }> };

export type SaveMcpServersMutationVariables = Exact<{
  servers: Array<McpServerInput> | McpServerInput;
}>;


export type SaveMcpServersMutation = { saveMcpServers: Array<{ status: string, error?: string | null, config: { id: string, label: string, enabled: boolean, transport: McpTransport, command: string, args: Array<string>, env: unknown, url: string, headers: unknown }, tools: Array<{ name: string, description: string }> }> };

export type ReconnectMcpServerMutationVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export type ReconnectMcpServerMutation = { reconnectMcpServer: Array<{ status: string, error?: string | null, config: { id: string, label: string, enabled: boolean, transport: McpTransport, command: string, args: Array<string>, env: unknown, url: string, headers: unknown }, tools: Array<{ name: string, description: string }> }> };

export type SessionSummaryFragment = { id: string, title: string, createdAt: string, updatedAt: string, model: string, usage?: unknown | null, loadedTools: unknown, compaction?: unknown | null, messageCount: number };

export type MessageRowFragment = { id: string, idx: number, role: MessagesRoleEnum, content?: unknown | null, reasoningContent?: string | null, toolCalls?: unknown | null, toolCallId?: string | null, stats?: unknown | null, followups?: unknown | null };

export type SessionsQueryVariables = Exact<{ [key: string]: never; }>;


export type SessionsQuery = { sessions: Array<{ id: string, title: string, createdAt: string, updatedAt: string, model: string, usage?: unknown | null, loadedTools: unknown, compaction?: unknown | null, messageCount: number }> };

export type SessionDetailQueryVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export type SessionDetailQuery = { session?: { id: string, title: string, createdAt: string, updatedAt: string, model: string, usage?: unknown | null, loadedTools: unknown, compaction?: unknown | null, messageCount: number, messages: Array<{ id: string, idx: number, role: MessagesRoleEnum, content?: unknown | null, reasoningContent?: string | null, toolCalls?: unknown | null, toolCallId?: string | null, stats?: unknown | null, followups?: unknown | null }> } | null };

export type CreateSessionMutationVariables = Exact<{ [key: string]: never; }>;


export type CreateSessionMutation = { createSession: { id: string, title: string, createdAt: string, updatedAt: string, model: string, usage?: unknown | null, loadedTools: unknown, compaction?: unknown | null, messageCount: number } };

export type RenameSessionMutationVariables = Exact<{
  id: Scalars['String']['input'];
  title: Scalars['String']['input'];
}>;


export type RenameSessionMutation = { updateSessionSingle?: { id: string, title: string, createdAt: string, updatedAt: string, model: string, usage?: unknown | null, loadedTools: unknown, compaction?: unknown | null, messageCount: number } | null };

export type DeleteSessionMutationVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export type DeleteSessionMutation = { deleteSessionSingle?: { id: string } | null };

export type TruncateSessionMutationVariables = Exact<{
  id: Scalars['String']['input'];
  fromIdx: Scalars['Int']['input'];
}>;


export type TruncateSessionMutation = { truncateSession: number };

export type ConfigQueryVariables = Exact<{ [key: string]: never; }>;


export type ConfigQuery = { hasApiKey: boolean, setting?: { baseUrl: string, model: string, maxTokens: number, temperature: number, maxToolIterations: number, systemPrompt: string, contextLimit: number, toolDiscovery: SettingsToolDiscoveryEnum, taskModels: unknown, pricing: unknown } | null };

export type SaveConfigMutationVariables = Exact<{
  set: UpdateSettingInput;
}>;


export type SaveConfigMutation = { updateSettingSingle?: { id: string } | null };

export type SetApiKeyMutationVariables = Exact<{
  apiKey: Scalars['String']['input'];
}>;


export type SetApiKeyMutation = { setApiKey: boolean };

export type ModelsQueryVariables = Exact<{ [key: string]: never; }>;


export type ModelsQuery = { models: Array<{ id: string, contextLength?: number | null }> };

export type TurnSubscriptionVariables = Exact<{
  sessionId: Scalars['String']['input'];
  prompt: Scalars['String']['input'];
  model?: InputMaybe<Scalars['String']['input']>;
}>;


export type TurnSubscription = { turn: { seq: number, type: string, text?: string | null, id?: string | null, name?: string | null, input?: string | null, toolUseId?: string | null, content?: string | null, isError?: boolean | null, title?: string | null, stats?: unknown | null, items?: Array<string> | null, message?: string | null } };

export class TypedDocumentString<TResult, TVariables>
  extends String
  implements DocumentTypeDecoration<TResult, TVariables>
{
  __apiType?: NonNullable<DocumentTypeDecoration<TResult, TVariables>['__apiType']>;
  private value: string;
  public __meta__?: Record<string, any> | undefined;

  constructor(value: string, __meta__?: Record<string, any> | undefined) {
    super(value);
    this.value = value;
    this.__meta__ = __meta__;
  }

  override toString(): string & DocumentTypeDecoration<TResult, TVariables> {
    return this.value;
  }
}
export const EmbedFragmentDoc = new TypedDocumentString(`
    fragment Embed on Embed {
  id
  label
  url
  icon
  mode
  enabled
}
    `, {"fragmentName":"Embed"}) as unknown as TypedDocumentString<EmbedFragment, unknown>;
export const McpStateFragmentDoc = new TypedDocumentString(`
    fragment McpState on McpServerState {
  config {
    id
    label
    enabled
    transport
    command
    args
    env
    url
    headers
  }
  status
  error
  tools {
    name
    description
  }
}
    `, {"fragmentName":"McpState"}) as unknown as TypedDocumentString<McpStateFragment, unknown>;
export const SessionSummaryFragmentDoc = new TypedDocumentString(`
    fragment SessionSummary on Session {
  id
  title
  createdAt
  updatedAt
  model
  usage
  loadedTools
  compaction
  messageCount
}
    `, {"fragmentName":"SessionSummary"}) as unknown as TypedDocumentString<SessionSummaryFragment, unknown>;
export const MessageRowFragmentDoc = new TypedDocumentString(`
    fragment MessageRow on Message {
  id
  idx
  role
  content
  reasoningContent
  toolCalls
  toolCallId
  stats
  followups
}
    `, {"fragmentName":"MessageRow"}) as unknown as TypedDocumentString<MessageRowFragment, unknown>;
export const EmbedsDocument = new TypedDocumentString(`
    query Embeds {
  embeds {
    ...Embed
  }
}
    fragment Embed on Embed {
  id
  label
  url
  icon
  mode
  enabled
}`) as unknown as TypedDocumentString<EmbedsQuery, EmbedsQueryVariables>;
export const SaveEmbedsDocument = new TypedDocumentString(`
    mutation SaveEmbeds($embeds: [EmbedInput!]!) {
  saveEmbeds(embeds: $embeds) {
    ...Embed
  }
}
    fragment Embed on Embed {
  id
  label
  url
  icon
  mode
  enabled
}`) as unknown as TypedDocumentString<SaveEmbedsMutation, SaveEmbedsMutationVariables>;
export const McpStatusDocument = new TypedDocumentString(`
    query McpStatus {
  mcpStatus {
    ...McpState
  }
}
    fragment McpState on McpServerState {
  config {
    id
    label
    enabled
    transport
    command
    args
    env
    url
    headers
  }
  status
  error
  tools {
    name
    description
  }
}`) as unknown as TypedDocumentString<McpStatusQuery, McpStatusQueryVariables>;
export const SaveMcpServersDocument = new TypedDocumentString(`
    mutation SaveMcpServers($servers: [McpServerInput!]!) {
  saveMcpServers(servers: $servers) {
    ...McpState
  }
}
    fragment McpState on McpServerState {
  config {
    id
    label
    enabled
    transport
    command
    args
    env
    url
    headers
  }
  status
  error
  tools {
    name
    description
  }
}`) as unknown as TypedDocumentString<SaveMcpServersMutation, SaveMcpServersMutationVariables>;
export const ReconnectMcpServerDocument = new TypedDocumentString(`
    mutation ReconnectMcpServer($id: String!) {
  reconnectMcpServer(id: $id) {
    ...McpState
  }
}
    fragment McpState on McpServerState {
  config {
    id
    label
    enabled
    transport
    command
    args
    env
    url
    headers
  }
  status
  error
  tools {
    name
    description
  }
}`) as unknown as TypedDocumentString<ReconnectMcpServerMutation, ReconnectMcpServerMutationVariables>;
export const SessionsDocument = new TypedDocumentString(`
    query Sessions {
  sessions {
    ...SessionSummary
  }
}
    fragment SessionSummary on Session {
  id
  title
  createdAt
  updatedAt
  model
  usage
  loadedTools
  compaction
  messageCount
}`) as unknown as TypedDocumentString<SessionsQuery, SessionsQueryVariables>;
export const SessionDetailDocument = new TypedDocumentString(`
    query SessionDetail($id: String!) {
  session(where: {id: {eq: $id}}) {
    ...SessionSummary
    messages {
      ...MessageRow
    }
  }
}
    fragment SessionSummary on Session {
  id
  title
  createdAt
  updatedAt
  model
  usage
  loadedTools
  compaction
  messageCount
}
fragment MessageRow on Message {
  id
  idx
  role
  content
  reasoningContent
  toolCalls
  toolCallId
  stats
  followups
}`) as unknown as TypedDocumentString<SessionDetailQuery, SessionDetailQueryVariables>;
export const CreateSessionDocument = new TypedDocumentString(`
    mutation CreateSession {
  createSession(values: {}) {
    ...SessionSummary
  }
}
    fragment SessionSummary on Session {
  id
  title
  createdAt
  updatedAt
  model
  usage
  loadedTools
  compaction
  messageCount
}`) as unknown as TypedDocumentString<CreateSessionMutation, CreateSessionMutationVariables>;
export const RenameSessionDocument = new TypedDocumentString(`
    mutation RenameSession($id: String!, $title: String!) {
  updateSessionSingle(set: {title: $title}, where: {id: {eq: $id}}) {
    ...SessionSummary
  }
}
    fragment SessionSummary on Session {
  id
  title
  createdAt
  updatedAt
  model
  usage
  loadedTools
  compaction
  messageCount
}`) as unknown as TypedDocumentString<RenameSessionMutation, RenameSessionMutationVariables>;
export const DeleteSessionDocument = new TypedDocumentString(`
    mutation DeleteSession($id: String!) {
  deleteSessionSingle(where: {id: {eq: $id}}) {
    id
  }
}
    `) as unknown as TypedDocumentString<DeleteSessionMutation, DeleteSessionMutationVariables>;
export const TruncateSessionDocument = new TypedDocumentString(`
    mutation TruncateSession($id: String!, $fromIdx: Int!) {
  truncateSession(id: $id, fromIdx: $fromIdx)
}
    `) as unknown as TypedDocumentString<TruncateSessionMutation, TruncateSessionMutationVariables>;
export const ConfigDocument = new TypedDocumentString(`
    query Config {
  setting(where: {id: {eq: "default"}}) {
    baseUrl
    model
    maxTokens
    temperature
    maxToolIterations
    systemPrompt
    contextLimit
    toolDiscovery
    taskModels
    pricing
  }
  hasApiKey
}
    `) as unknown as TypedDocumentString<ConfigQuery, ConfigQueryVariables>;
export const SaveConfigDocument = new TypedDocumentString(`
    mutation SaveConfig($set: UpdateSettingInput!) {
  updateSettingSingle(set: $set, where: {id: {eq: "default"}}) {
    id
  }
}
    `) as unknown as TypedDocumentString<SaveConfigMutation, SaveConfigMutationVariables>;
export const SetApiKeyDocument = new TypedDocumentString(`
    mutation SetApiKey($apiKey: String!) {
  setApiKey(apiKey: $apiKey)
}
    `) as unknown as TypedDocumentString<SetApiKeyMutation, SetApiKeyMutationVariables>;
export const ModelsDocument = new TypedDocumentString(`
    query Models {
  models {
    id
    contextLength
  }
}
    `) as unknown as TypedDocumentString<ModelsQuery, ModelsQueryVariables>;
export const TurnDocument = new TypedDocumentString(`
    subscription Turn($sessionId: String!, $prompt: String!, $model: String) {
  turn(sessionId: $sessionId, prompt: $prompt, model: $model) {
    seq
    type
    text
    id
    name
    input
    toolUseId
    content
    isError
    title
    stats
    items
    message
  }
}
    `) as unknown as TypedDocumentString<TurnSubscription, TurnSubscriptionVariables>;