// AgentDock fork: brings the projects and threads of a T3 Code install on this computer into
// AgentDock's own database, once, so work started there shows up here.
import * as NodeWorkerThreads from "node:worker_threads";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import { migrationManifest, runMigrations } from "./Migrations.ts";
import { recordedMigrations } from "./databaseMigrationHead.ts";

const MARKER_FILE = "t3-code-import.json";
const MAX_ATTEMPTS = 3;

/** Named for T3 Code's own "No project" project, which AgentDock cannot use as its scratch home. */
export const T3_SCRATCH_PROJECT_TITLE = "No project (T3 Code)";

export class T3CodeImportError extends Schema.TaggedError<T3CodeImportError>()(
  "T3CodeImportError",
  { sourcePath: Schema.String, cause: Schema.Defect() },
) {
  override get message() {
    return `Could not import the T3 Code data at ${this.sourcePath}. AgentDock's own data was not changed.`;
  }
}

const Marker = Schema.Struct({
  status: Schema.Literals(["imported", "failed"]),
  attempts: Schema.Number,
  at: Schema.String,
  threads: Schema.optional(Schema.Number),
  projects: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
});
type Marker = typeof Marker.Type;
const decodeMarker = Schema.decodeUnknownOption(Schema.fromJsonString(Marker));

export interface T3CodeImportInput {
  /** T3 Code's home, usually ~/.t3. */
  readonly sourceBaseDir: string;
  /** AgentDock's home; its scratch project takes over T3 Code's "No project" threads. */
  readonly baseDir: string;
  readonly stateDir: string;
  readonly dbPath: string;
  readonly attachmentsDir: string;
}

export interface T3CodeImportResult {
  readonly threads: number;
  readonly projects: number;
}

// Rows keyed by thread_id. Search and count tables fill through triggers; receipts, outbox,
// auth, links and schedules belong to the T3 Code install and stay there.
const THREAD_TABLES = [
  "orchestration_v2_projection_threads",
  "projection_threads",
  "orchestration_v2_projection_checkpoint_scopes",
  "orchestration_v2_projection_checkpoints",
  "orchestration_v2_projection_context_handoffs",
  "orchestration_v2_projection_messages",
  "orchestration_v2_projection_nodes",
  "orchestration_v2_projection_plans",
  "orchestration_v2_projection_provider_sessions",
  "orchestration_v2_projection_provider_session_bindings",
  "orchestration_v2_projection_provider_threads",
  "orchestration_v2_projection_provider_turns",
  "orchestration_v2_projection_run_attempts",
  "orchestration_v2_projection_runs",
  "orchestration_v2_projection_runtime_requests",
  "orchestration_v2_projection_subagents",
  "orchestration_v2_projection_turn_items",
  "orchestration_v2_turn_item_positions",
  "orchestration_v2_legacy_imports",
  "projection_thread_messages",
  "projection_thread_sessions",
  "projection_thread_pull_requests",
  "provider_session_runtime",
  "mcp_app_model_context",
] as const;

const snapshotWorkerSource = `
const { workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");
const database = new DatabaseSync(workerData.sourcePath, { readOnly: true });
try {
  database.exec("PRAGMA busy_timeout = 5000");
  database.prepare("VACUUM INTO ?").run(workerData.snapshotPath);
} finally {
  database.close();
}
`;

// T3 Code may be running; VACUUM INTO reads one consistent state without touching its files.
const snapshot = (sourcePath: string, snapshotPath: string) =>
  Effect.callback<void, T3CodeImportError>((resume) => {
    const fail = (cause: unknown) =>
      resume(Effect.fail(new T3CodeImportError({ sourcePath, cause })));
    const worker = new NodeWorkerThreads.Worker(snapshotWorkerSource, {
      eval: true,
      workerData: { sourcePath, snapshotPath },
    });
    worker.once("error", fail);
    worker.once("exit", (code) =>
      code === 0 ? resume(Effect.void) : fail(new Error(`Snapshot worker exited with ${code}`)),
    );
    return Effect.promise(() => worker.terminate());
  });

/** A history this build can migrate forward: every recorded id is this build's migration of that name. */
const isKnownHistory = (
  recorded: ReadonlyArray<{ readonly id: number; readonly name: string }> | null,
): boolean => {
  if (recorded === null || recorded.length === 0) return false;
  const names = new Map<number, string>(migrationManifest.map(([id, name]) => [id, name]));
  return recorded.every((row) => names.get(row.id) === row.name);
};

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

const merge = Effect.fn("importT3CodeData.merge")(function* (input: {
  readonly snapshotPath: string;
  readonly sourceScratchRoot: string;
  readonly scratchRoot: string;
}) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`PRAGMA busy_timeout = 5000;`;
  yield* sql`ATTACH DATABASE ${input.snapshotPath} AS t3`;

  const columns = Effect.fnUntraced(function* (schema: "main" | "t3", table: string) {
    const rows = yield* sql<{ readonly name: string }>`
      SELECT name FROM pragma_table_info(${table}, ${schema})
    `;
    return rows.map((row) => row.name);
  });
  // Both sides are at this build's schema; the intersection only guards against a table one side lacks.
  const sharedColumns = Effect.fnUntraced(function* (table: string) {
    const target = new Set(yield* columns("main", table));
    return (yield* columns("t3", table)).filter((name) => target.has(name));
  });

  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`DROP TABLE IF EXISTS temp.t3_import_threads`;
      yield* sql`DROP TABLE IF EXISTS temp.t3_import_projects`;
      // A thread AgentDock already knows, by projection or by event stream, is left alone.
      yield* sql`
        CREATE TEMP TABLE t3_import_threads AS
        SELECT thread_id FROM (
          SELECT thread_id FROM t3.orchestration_v2_projection_threads
          UNION
          SELECT thread_id FROM t3.projection_threads
        ) AS source
        WHERE NOT EXISTS (
            SELECT 1 FROM main.orchestration_v2_projection_threads AS known
            WHERE known.thread_id = source.thread_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM main.projection_threads AS known
            WHERE known.thread_id = source.thread_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM main.orchestration_events AS known
            WHERE known.aggregate_kind = 'thread' AND known.stream_id = source.thread_id
          )
      `;
      const [counted] = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM temp.t3_import_threads
      `;
      const threads = counted?.count ?? 0;
      if (threads === 0) return { threads: 0, projects: 0 };

      // A project already open in AgentDock on the same folder keeps its AgentDock identity.
      yield* sql`
        CREATE TEMP TABLE t3_import_projects AS
        SELECT
          source.project_id AS old_id,
          COALESCE(
            (
              SELECT known.project_id FROM main.projection_projects AS known
              WHERE known.deleted_at IS NULL
                AND known.workspace_root = CASE
                  WHEN source.workspace_root = ${input.sourceScratchRoot} THEN ${input.scratchRoot}
                  ELSE source.workspace_root
                END
              ORDER BY known.project_id = source.project_id DESC,
                known.archived_at IS NOT NULL,
                known.created_at
              LIMIT 1
            ),
            source.project_id
          ) AS new_id,
          0 AS inserted
        FROM t3.projection_projects AS source
        WHERE source.project_id IN (
          SELECT project_id FROM t3.orchestration_v2_projection_threads
          WHERE thread_id IN (SELECT thread_id FROM temp.t3_import_threads)
          UNION
          SELECT project_id FROM t3.projection_threads
          WHERE thread_id IN (SELECT thread_id FROM temp.t3_import_threads)
        )
      `;
      yield* sql`
        UPDATE temp.t3_import_projects SET inserted = 1
        WHERE NOT EXISTS (
          SELECT 1 FROM main.projection_projects AS known
          WHERE known.project_id = t3_import_projects.new_id
        )
      `;
      const projectColumns = (yield* sharedColumns("projection_projects")).map(quote).join(", ");
      yield* sql.unsafe(
        `INSERT INTO main.projection_projects (${projectColumns})
         SELECT ${projectColumns} FROM t3.projection_projects
         WHERE project_id IN (SELECT old_id FROM temp.t3_import_projects WHERE inserted = 1)`,
      );
      yield* sql`
        UPDATE main.projection_projects SET title = ${T3_SCRATCH_PROJECT_TITLE}
        WHERE workspace_root = ${input.sourceScratchRoot}
          AND project_id IN (SELECT old_id FROM temp.t3_import_projects WHERE inserted = 1)
      `;

      for (const table of THREAD_TABLES) {
        const shared = yield* sharedColumns(table);
        if (!shared.includes("thread_id")) continue;
        const list = shared.map(quote).join(", ");
        yield* sql.unsafe(
          `INSERT OR IGNORE INTO main.${quote(table)} (${list})
           SELECT ${list} FROM t3.${quote(table)}
           WHERE thread_id IN (SELECT thread_id FROM temp.t3_import_threads)`,
        );
      }
      const transferColumns = (yield* sharedColumns(
        "orchestration_v2_projection_context_transfers",
      ))
        .map(quote)
        .join(", ");
      if (transferColumns.length > 0) {
        yield* sql.unsafe(
          `INSERT OR IGNORE INTO main.orchestration_v2_projection_context_transfers (${transferColumns})
           SELECT ${transferColumns} FROM t3.orchestration_v2_projection_context_transfers
           WHERE source_thread_id IN (SELECT thread_id FROM temp.t3_import_threads)
              OR target_thread_id IN (SELECT thread_id FROM temp.t3_import_threads)`,
        );
      }

      const remapped = sql`
        SELECT new_id FROM temp.t3_import_projects AS map
        WHERE map.old_id = project_id AND map.new_id <> map.old_id
      `;
      yield* sql`
        UPDATE main.orchestration_v2_projection_threads
        SET payload_json = json_set(payload_json, '$.projectId', (${remapped})),
            project_id = (${remapped})
        WHERE thread_id IN (SELECT thread_id FROM temp.t3_import_threads)
          AND (${remapped}) IS NOT NULL
      `;
      yield* sql`
        UPDATE main.projection_threads
        SET project_id = (${remapped})
        WHERE thread_id IN (SELECT thread_id FROM temp.t3_import_threads)
          AND (${remapped}) IS NOT NULL
      `;

      // Imported events take sequences after AgentDock's own; a prompt anchor moves with its event.
      const [head] = yield* sql<{ readonly sequence: number }>`
        SELECT MAX(
          COALESCE((SELECT MAX(sequence) FROM main.orchestration_events), 0),
          COALESCE((SELECT seq FROM main.sqlite_sequence WHERE name = 'orchestration_events'), 0)
        ) AS sequence
      `;
      const offset = head?.sequence ?? 0;
      const eventColumns = (yield* sharedColumns("orchestration_events")).filter(
        (name) => name !== "sequence" && name !== "payload_json",
      );
      const eventList = eventColumns.map(quote).join(", ");
      yield* sql.unsafe(
        `INSERT INTO main.orchestration_events (sequence, payload_json, ${eventList})
         SELECT
           sequence + ${offset},
           CASE WHEN json_type(payload_json, '$.promptSequence') = 'integer'
             THEN json_set(
               payload_json,
               '$.promptSequence',
               json_extract(payload_json, '$.promptSequence') + ${offset}
             )
             ELSE payload_json
           END,
           ${eventList}
         FROM t3.orchestration_events AS source
         WHERE (
             source.aggregate_kind = 'thread'
             AND source.stream_id IN (SELECT thread_id FROM temp.t3_import_threads)
           )
           OR (
             source.aggregate_kind = 'project'
             AND source.stream_id IN (
               SELECT old_id FROM temp.t3_import_projects WHERE inserted = 1
             )
             AND NOT EXISTS (
               SELECT 1 FROM main.orchestration_events AS known
               WHERE known.aggregate_kind = 'project' AND known.stream_id = source.stream_id
             )
           )
         ORDER BY source.sequence`,
      );
      yield* sql`
        UPDATE main.orchestration_events
        SET payload_json = json_set(
          payload_json,
          '$.projectId',
          (
            SELECT new_id FROM temp.t3_import_projects AS map
            WHERE map.old_id = json_extract(payload_json, '$.projectId')
          )
        )
        WHERE sequence > ${offset}
          AND aggregate_kind = 'thread'
          AND json_extract(payload_json, '$.projectId') IN (
            SELECT old_id FROM temp.t3_import_projects WHERE new_id <> old_id
          )
      `;
      yield* sql`
        UPDATE main.orchestration_events
        SET payload_json = json_set(payload_json, '$.title', ${T3_SCRATCH_PROJECT_TITLE})
        WHERE sequence > ${offset}
          AND aggregate_kind = 'project'
          AND event_type = 'project.created'
          AND json_extract(payload_json, '$.workspaceRoot') = ${input.sourceScratchRoot}
      `;
      // Imported history can be pruned and so partial; clients behind this boundary take a
      // snapshot instead of replaying it.
      yield* sql`
        INSERT INTO main.orchestration_v2_projection_metadata (
          projection_name, schema_version, last_sequence, updated_at
        )
        SELECT
          'event-log-pruned-through',
          COALESCE(
            (SELECT MAX(schema_version) FROM main.orchestration_v2_projection_metadata),
            (SELECT MAX(schema_version) FROM t3.orchestration_v2_projection_metadata),
            1
          ),
          COALESCE(MAX(sequence), 0),
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        FROM main.orchestration_events
        WHERE true
        ON CONFLICT(projection_name) DO UPDATE SET
          last_sequence = MAX(last_sequence, excluded.last_sequence),
          updated_at = excluded.updated_at
      `;

      const [inserted] = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM temp.t3_import_projects WHERE inserted = 1
      `;
      return { threads, projects: inserted?.count ?? 0 };
    }),
  );
});

const copyAttachments = Effect.fn("importT3CodeData.copyAttachments")(function* (
  sourceDir: string,
  targetDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!(yield* fs.exists(sourceDir))) return;
  yield* fs.makeDirectory(targetDir, { recursive: true });
  for (const entry of yield* fs.readDirectory(sourceDir)) {
    const target = path.join(targetDir, entry);
    if (yield* fs.exists(target)) continue;
    yield* fs.copy(path.join(sourceDir, entry), target).pipe(Effect.ignore({ log: true }));
  }
});

/** Imports from an explicit T3 Code home. Returns undefined when there is nothing it can read. */
export const importT3CodeDataFrom = Effect.fn("importT3CodeDataFrom")(function* (
  input: T3CodeImportInput,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sourceStateDir = path.join(input.sourceBaseDir, "userdata");
  const sourcePath = path.join(sourceStateDir, "statev2.sqlite");
  if (path.resolve(sourcePath) === path.resolve(input.dbPath)) return undefined;
  if (!(yield* fs.exists(sourcePath))) return undefined;
  // A T3 Code newer than this build has a schema this build cannot read; a later build may.
  if (!isKnownHistory(recordedMigrations(sourcePath))) {
    yield* Effect.logWarning(
      "Skipped the T3 Code import: its database was written by a build this one does not know.",
    ).pipe(Effect.annotateLogs({ sourcePath }));
    return undefined;
  }

  const wrap = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.mapError((cause) => new T3CodeImportError({ sourcePath, cause })));

  return yield* Effect.gen(function* () {
    const temporaryDirectory = yield* wrap(
      fs.makeTempDirectoryScoped({
        directory: input.stateDir,
        // Shares the prefix initializeV2Database sweeps, so a crash leaves nothing behind.
        prefix: `.v2-import-${process.pid}-`,
      }),
    );
    const snapshotPath = path.join(temporaryDirectory, "t3-code.sqlite");
    yield* snapshot(sourcePath, snapshotPath);
    yield* wrap(
      runMigrations().pipe(
        Effect.provide(NodeSqliteClient.layer({ filename: snapshotPath })),
        Effect.withLogSpan("t3-code-import"),
      ),
    );
    // One plain connection, so the attached snapshot is visible to every statement.
    const result = yield* wrap(
      merge({
        snapshotPath,
        sourceScratchRoot: path.resolve(input.sourceBaseDir, "scratch"),
        scratchRoot: path.resolve(input.baseDir, "scratch"),
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: input.dbPath }))),
    );
    if (result.threads > 0) {
      yield* copyAttachments(path.join(sourceStateDir, "attachments"), input.attachmentsDir).pipe(
        Effect.ignore({ log: true }),
      );
    }
    return result satisfies T3CodeImportResult;
  }).pipe(Effect.scoped);
});

/**
 * Runs once per AgentDock home, after its own migrations. Only the default home imports, from
 * the default T3 Code home, so tests and side-by-side homes never read a real install.
 * Deleting t3-code-import.json from the state folder makes the next start import again.
 */
export const importT3CodeData = Effect.fn("importT3CodeData")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const home = yield* HostProcess.HomeDirectory;
  if (path.resolve(config.baseDir) !== path.resolve(home, ".agentdock-next")) return;
  if (path.basename(config.stateDir) !== "userdata") return;

  const markerPath = path.join(config.stateDir, MARKER_FILE);
  const previous = yield* fs.readFileString(markerPath).pipe(
    Effect.map((text) => decodeMarker(text)),
    Effect.orElseSucceed(() => undefined),
  );
  const marker: Marker | undefined =
    previous !== undefined && previous._tag === "Some" ? previous.value : undefined;
  if (marker?.status === "imported") return;
  if (marker !== undefined && marker.attempts >= MAX_ATTEMPTS) return;

  const writeMarker = (next: Marker) =>
    fs
      .writeFileString(markerPath, `${JSON.stringify(next, null, 2)}\n`)
      .pipe(Effect.ignore({ log: true }));
  const attempts = (marker?.attempts ?? 0) + 1;
  const at = DateTime.formatIso(yield* DateTime.now);
  yield* importT3CodeDataFrom({
    sourceBaseDir: path.join(home, ".t3"),
    baseDir: config.baseDir,
    stateDir: config.stateDir,
    dbPath: config.dbPath,
    attachmentsDir: config.attachmentsDir,
  }).pipe(
    Effect.flatMap((result) => {
      if (result === undefined) return Effect.void;
      return Effect.log("Imported T3 Code projects and threads").pipe(
        Effect.annotateLogs({ threads: result.threads, projects: result.projects }),
        Effect.andThen(writeMarker({ status: "imported", attempts, at, ...result })),
      );
    }),
    // A failed import never keeps AgentDock from starting; its transaction left the database as it was.
    Effect.catchCause((cause) =>
      Effect.logWarning("The T3 Code import failed; AgentDock starts without it.", cause).pipe(
        Effect.andThen(writeMarker({ status: "failed", attempts, at, error: String(cause) })),
      ),
    ),
  );
});
