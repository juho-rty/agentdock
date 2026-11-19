// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlError from "effect/sql/SqlError";

import { runMigrations } from "./Migrations.ts";
import { importT3CodeDataFrom, T3_SCRATCH_PROJECT_TITLE } from "./importT3CodeData.ts";

const AT = "2026-01-01T00:00:00.000Z";

const seed = (
  filename: string,
  body: Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient>,
) =>
  Effect.gen(function* () {
    yield* runMigrations();
    yield* body;
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename })));

const project = (id: string, title: string, root: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
      VALUES (${id}, ${title}, ${root}, '[]', ${AT}, ${AT})`;
  });

const event = (input: {
  readonly kind: "project" | "thread";
  readonly stream: string;
  readonly version: number;
  readonly type: string;
  readonly payload: unknown;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO orchestration_events (
        event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
        actor_kind, payload_json, metadata_json, application_event_version
      ) VALUES (
        ${`${input.stream}:${input.version}`}, ${input.kind}, ${input.stream}, ${input.version},
        ${input.type}, ${AT}, 'user', ${JSON.stringify(input.payload)}, '{}', 2
      )`;
  });

const thread = (id: string, projectId: string, title: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const payload = { id, projectId, title };
    yield* sql`INSERT INTO orchestration_v2_projection_threads (
        thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
        created_at, updated_at, payload_json
      ) VALUES (${id}, ${projectId}, ${title}, 'codex', 'full-access', 'default', ${AT}, ${AT}, ${JSON.stringify(payload)})`;
    yield* sql`INSERT INTO orchestration_v2_projection_messages (
        message_id, thread_id, role, streaming, created_at, updated_at, payload_json, search_text
      ) VALUES (${`${id}:message`}, ${id}, 'user', 0, ${AT}, ${AT}, ${JSON.stringify({ text: `hello from ${id}` })}, ${`hello from ${id}`})`;
    yield* event({ kind: "thread", stream: id, version: 0, type: "thread.created", payload });
  });

it.effect("imports T3 Code threads once, onto matching AgentDock projects", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-import-"));
  const t3 = NodePath.join(root, "t3");
  const home = NodePath.join(root, "agentdock");
  const stateDir = NodePath.join(home, "userdata");
  const dbPath = NodePath.join(stateDir, "statev2.sqlite");
  const attachmentsDir = NodePath.join(stateDir, "attachments");
  NodeFS.mkdirSync(NodePath.join(t3, "userdata", "attachments"), { recursive: true });
  NodeFS.mkdirSync(attachmentsDir, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(t3, "userdata", "attachments", "a.png"), "image");
  const t3Scratch = NodePath.resolve(t3, "scratch");
  const input = { sourceBaseDir: t3, baseDir: home, stateDir, dbPath, attachmentsDir };

  return Effect.gen(function* () {
    yield* seed(
      NodePath.join(t3, "userdata", "statev2.sqlite"),
      Effect.gen(function* () {
        yield* project("t3-shared", "Shared", "/work/shared");
        yield* project("t3-own", "Own", "/work/own");
        yield* project("t3-scratch", "No project", t3Scratch);
        yield* event({
          kind: "project",
          stream: "t3-own",
          version: 0,
          type: "project.created",
          payload: { projectId: "t3-own", title: "Own", workspaceRoot: "/work/own" },
        });
        yield* event({
          kind: "project",
          stream: "t3-scratch",
          version: 0,
          type: "project.created",
          payload: { projectId: "t3-scratch", title: "No project", workspaceRoot: t3Scratch },
        });
        yield* thread("thread-shared", "t3-shared", "On a shared folder");
        yield* thread("thread-own", "t3-own", "On a T3-only folder");
        yield* thread("thread-scratch", "t3-scratch", "No project thread");
        yield* thread("thread-known", "t3-own", "Stale copy");
        // Sequences 6 and 7: the second keeps only a pointer to the first one's prompt.
        yield* event({
          kind: "thread",
          stream: "thread-own",
          version: 1,
          type: "subagent.updated",
          payload: { id: "sub", prompt: "do it" },
        });
        yield* event({
          kind: "thread",
          stream: "thread-own",
          version: 2,
          type: "subagent.updated",
          payload: { id: "sub", prompt: "", promptSequence: 7 },
        });
      }),
    );
    yield* seed(
      dbPath,
      Effect.gen(function* () {
        yield* project("ad-shared", "Shared in AgentDock", "/work/shared");
        yield* project("ad-other", "Other", "/work/other");
        yield* thread("thread-known", "ad-other", "AgentDock copy");
        yield* thread("thread-local", "ad-shared", "Local");
      }),
    );

    const first = yield* importT3CodeDataFrom(input);
    assert.deepEqual(first, { threads: 3, projects: 2 });
    const second = yield* importT3CodeDataFrom(input);
    assert.deepEqual(second, { threads: 0, projects: 0 });

    const db = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      const all = (query: string) =>
        db
          .prepare(query)
          .all()
          .map((row) => ({ ...row }));
      assert.deepEqual(
        all(
          "SELECT thread_id, project_id, title, json_extract(payload_json, '$.projectId') AS payload_project FROM orchestration_v2_projection_threads ORDER BY thread_id",
        ),
        [
          {
            thread_id: "thread-known",
            project_id: "ad-other",
            title: "AgentDock copy",
            payload_project: "ad-other",
          },
          {
            thread_id: "thread-local",
            project_id: "ad-shared",
            title: "Local",
            payload_project: "ad-shared",
          },
          {
            thread_id: "thread-own",
            project_id: "t3-own",
            title: "On a T3-only folder",
            payload_project: "t3-own",
          },
          {
            thread_id: "thread-scratch",
            project_id: "t3-scratch",
            title: "No project thread",
            payload_project: "t3-scratch",
          },
          {
            thread_id: "thread-shared",
            project_id: "ad-shared",
            title: "On a shared folder",
            payload_project: "ad-shared",
          },
        ],
      );
      assert.deepEqual(
        all("SELECT project_id, title FROM projection_projects ORDER BY project_id"),
        [
          { project_id: "ad-other", title: "Other" },
          { project_id: "ad-shared", title: "Shared in AgentDock" },
          { project_id: "t3-own", title: "Own" },
          { project_id: "t3-scratch", title: T3_SCRATCH_PROJECT_TITLE },
        ],
      );
      // AgentDock held sequences 1 and 2, so every imported sequence moved by 2.
      assert.deepEqual(
        all(
          "SELECT sequence, stream_id, stream_version, json_extract(payload_json, '$.projectId') AS project, json_extract(payload_json, '$.title') AS title, json_extract(payload_json, '$.promptSequence') AS prompt FROM orchestration_events WHERE sequence > 2 ORDER BY sequence",
        ),
        [
          {
            sequence: 3,
            stream_id: "t3-own",
            stream_version: 0,
            project: "t3-own",
            title: "Own",
            prompt: null,
          },
          {
            sequence: 4,
            stream_id: "t3-scratch",
            stream_version: 0,
            project: "t3-scratch",
            title: T3_SCRATCH_PROJECT_TITLE,
            prompt: null,
          },
          {
            sequence: 5,
            stream_id: "thread-shared",
            stream_version: 0,
            project: "ad-shared",
            title: "On a shared folder",
            prompt: null,
          },
          {
            sequence: 6,
            stream_id: "thread-own",
            stream_version: 0,
            project: "t3-own",
            title: "On a T3-only folder",
            prompt: null,
          },
          {
            sequence: 7,
            stream_id: "thread-scratch",
            stream_version: 0,
            project: "t3-scratch",
            title: "No project thread",
            prompt: null,
          },
          {
            sequence: 9,
            stream_id: "thread-own",
            stream_version: 1,
            project: null,
            title: null,
            prompt: null,
          },
          {
            sequence: 10,
            stream_id: "thread-own",
            stream_version: 2,
            project: null,
            title: null,
            prompt: 9,
          },
        ],
      );
      assert.deepEqual(
        all(
          "SELECT last_sequence FROM orchestration_v2_projection_metadata WHERE projection_name = 'event-log-pruned-through'",
        ),
        [{ last_sequence: 10 }],
      );
      assert.deepEqual(all("SELECT COUNT(*) AS count FROM orchestration_v2_projection_messages"), [
        { count: 5 },
      ]);
    } finally {
      db.close();
    }
    assert.equal(NodeFS.readFileSync(NodePath.join(attachmentsDir, "a.png"), "utf8"), "image");
    assert.deepEqual(
      NodeFS.readdirSync(stateDir).filter((entry) => entry.startsWith(".v2-import-")),
      [],
    );
  }).pipe(Effect.provide(NodeServices.layer));
});

it.effect("leaves AgentDock alone when there is no T3 Code database", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-import-none-"));
  return importT3CodeDataFrom({
    sourceBaseDir: NodePath.join(root, "t3"),
    baseDir: root,
    stateDir: root,
    dbPath: NodePath.join(root, "statev2.sqlite"),
    attachmentsDir: NodePath.join(root, "attachments"),
  }).pipe(
    Effect.map((result) => assert.isUndefined(result)),
    Effect.provide(NodeServices.layer),
  );
});
