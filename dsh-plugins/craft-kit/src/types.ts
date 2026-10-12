/**
 * Shared types for the ArtCraft DSH plugins.
 *
 * Nothing here imports DSH at runtime: the kernel is plain Node so that it can
 * be unit-tested (and reused by the MCP bridge) without a live harness.
 * @module @dsh-artcraft/craft-kit/types
 */

/** How one craft CLI spells its one-shot, headless "run some commands" verb. */
export interface CraftRunSpec {
  /** Subcommand that runs a document headlessly, e.g. `run`. */
  readonly verb: string
  /**
   * How a source document reaches the CLI:
   * - `flag` (default): `inFlag` then the path (`--in FILE`, `--file FILE`)
   * - `positional`: the path is a bare argument to the verb (`cadcraft-cli run FILE`)
   * - `none`: the craft has no way to open an existing document headlessly (FilmCraft)
   */
  readonly inputMode?: 'flag' | 'positional' | 'none'
  /** Flag introducing a source document; ignored when `inputMode` is not `flag`. */
  readonly inFlag: string
  /** Flag naming a source document on a craft that uses `--file`. */
  readonly fileFlag?: string
  /** Flag that loads the app's built-in sample document instead of a file. */
  readonly sampleFlag: string
  /** Names of the bundled sample documents, when the CLI accepts an argument. */
  readonly samples?: readonly string[]
  /** Argument the sample flag needs on crafts where "new document" takes JSON, e.g. PhotoCraft `--new`. */
  readonly newSampleValue?: string
  /** Flag introducing one command; empty when the craft takes commands positionally. */
  readonly cmdFlag: string
  /** Separator between the command id and its JSON argument in one `--cmd` value. */
  readonly cmdSeparator: string
  /** Flag introducing the JSON argument of the preceding command (PhotoCraft/VectorCraft). */
  readonly cmdParamsFlag?: string
  /**
   * How the commands reach the CLI:
   * - `flag`: repeated `--cmd id=json` (CADCraft, GridCraft, SoundCraft, DeckCraft, WordCraft, DesignCraft)
   * - `flag-params`: repeated `--cmd id --params json` (PhotoCraft, VectorCraft)
   * - `positional-pair`: repeated positional `id json` (EffectCraft, FilmCraft)
   * - `positional-kv`: repeated positional `id key=value …` (LightCraft)
   * Defaults to `flag`.
   */
  readonly cmdStyle?: 'flag' | 'flag-params' | 'positional-pair' | 'positional-kv'
  /**
   * When true, a command's `json` is a flat map of `key=value` pairs that the
   * craft takes as positional tokens (LightCraft, PdfCraft) rather than one
   * JSON object. The run tool's description says so.
   */
  readonly positionalKeyValues?: boolean
  /** Flag importing media before running (LightCraft `--import`). */
  readonly importFlag?: string
  /** Flag opening or naming the session/library file. */
  readonly sessionFlag?: string
  /**
   * Flag that takes a generated step list, for crafts that can run a whole
   * sequence in one process (PdfCraft `run --script FILE`).
   */
  readonly scriptFlag?: string
  /**
   * The craft consumes commands as a JSON-lines script file (`{"id","params"}`
   * per line) rather than inline arguments (FilmCraft). The kernel writes the
   * file itself and passes it positionally.
   */
  readonly scriptMode?: boolean
  /**
   * How the edited document is written back:
   * - `flag` (default): `saveFlag` then the path
   * - `none`: no such flag exists, so the run tool omits `save` entirely and the
   *   craft writes through its own commands (EffectCraft `file.saveAs`, …)
   */
  readonly saveMode?: 'flag' | 'none'
  /** Flag writing the edited document back out. */
  readonly saveFlag: string
  /** Flag exporting a rendered artifact (png/svg/pdf/image/audio). */
  readonly exportFlag?: string
  /** Flag exporting every page (DesignCraft). */
  readonly exportAllPagesFlag?: string
  /** Print the resulting document state to stdout. */
  readonly printFlag?: string
}

/** One read-only subcommand the craft CLI exposes beyond `run`. */
export interface CraftReadSpec {
  /** Tool-facing name, e.g. `inspect`. */
  readonly name: string
  /** CLI subcommand, e.g. `info`. */
  readonly verb: string
  /** What the model gets from it. */
  readonly summary: string
  /**
   * What the subcommand expects after its verb:
   * - `file` (default): the document path
   * - `section`: a fixed word such as `project`/`sequence` (FilmCraft)
   * - `none`: no argument (LightCraft `commands`)
   */
  readonly arg?: 'file' | 'section' | 'none'
  /** Fixed word passed when `arg` is `section`. */
  readonly section?: string
  /** Flag naming the project this subcommand reads, when the verb is not `run`. */
  readonly projectFlag?: string
  /** Extra argv always appended to this subcommand. */
  readonly extraArgs?: readonly string[]
}

/** Everything the kernel needs to drive one craft app. */
export interface CraftProfile {
  /** Plugin/registry name, e.g. `gridcraft`. */
  readonly id: string
  /** Human-facing product name, e.g. `GridCraft`. */
  readonly product: string
  /** CLI executable basename, e.g. `gridcraft-cli`. */
  readonly bin: string
  /** Environment variable that overrides binary discovery, e.g. `GRIDCRAFT_CLI`. */
  readonly envVar: string
  /** Absolute directories searched for the binary, in order. */
  readonly searchDirs: readonly string[]
  /** Document file extensions this app owns, for guidance only. */
  readonly extensions: readonly string[]
  /** One-line description of what the app is for. */
  readonly blurb: string
  /** The headless-run verb spelling. */
  readonly run: CraftRunSpec
  /** Read-only subcommands to surface as separate tools. */
  readonly reads?: readonly CraftReadSpec[]
  /**
   * `commands --json` support. `true` means the CLI prints a JSON array on
   * stdout; `false` means the catalog is read from a bundled snapshot.
   */
  readonly catalogJson: boolean
  /** Exact argv that prints the catalog, e.g. `['commands', '--json']`. */
  readonly catalogArgs?: readonly string[]
  /**
   * Subcommand that prints one command's full record, when the catalog itself
   * omits parameter grammar (SoundCraft's `commands` table has no params
   * column). The command id is appended; JSON output is parsed for `params`.
   */
  readonly describeArgs?: readonly string[]
  /**
   * The headless verb accepts exactly one command per invocation (PdfCraft),
   * so the run tool sends the first command and reports the rest as skipped
   * rather than silently producing a confusing CLI error.
   */
  readonly oneToolPerRun?: boolean
  /** Extra flags every invocation of this CLI needs. */
  readonly baseArgs?: readonly string[]
  /**
   * MCP server invocation, when the craft ships one (every craft app does).
   * Its tools carry real JSON Schemas, so the plugins expose them alongside the
   * generic `--cmd` surface. Omit to skip the bridge entirely.
   */
  readonly mcpArgs?: readonly string[]
  /**
   * Arguments the MCP server needs to open something at startup, e.g.
   * `['--demo']`. A craft whose server starts empty reports its own state.
   */
  readonly mcpSessionArgs?: readonly string[]
}

/** One entry of a craft's command catalog. */
export interface CraftCommand {
  readonly id: string
  readonly label?: string
  /** Human-readable parameter grammar, e.g. `{cell?: "B2", input: "…"}`. */
  readonly params?: string
  readonly menu?: readonly string[]
  readonly shortcut?: string | null
  readonly aliases?: readonly string[]
  readonly interactive?: boolean
  readonly enabled?: boolean
  readonly description?: string
  /** Category inferred from the id prefix (`cell`, `insert`, …). */
  readonly group?: string
}

/** Result of one craft CLI invocation. */
export interface CraftRunResult {
  readonly ok: boolean
  readonly bin: string
  readonly argv: readonly string[]
  readonly cwd: string
  readonly exitCode: number | null
  readonly signal: string | null
  readonly stdout: string
  readonly stderr: string
  readonly truncated: boolean
  readonly durationMs: number
  readonly artifacts: readonly string[]
}

/** A resolved craft binary. */
export interface CraftBinary {
  readonly path: string
  readonly version?: string
  /** Where the path came from, for diagnostics. */
  readonly source: string
}
