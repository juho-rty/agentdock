#!/usr/bin/env node

// Renders the AgentDock mark (apps/web/src/components/AgentDockMark.tsx) as tray icons.
// macOS gets black template images that the menu bar tints; Windows and Linux get a
// light mark on a dark tile that reads on both light and dark taskbars.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import sharp from "sharp";

const OUTPUT_DIRECTORY = "apps/desktop/resources/tray";
const SVG_DENSITY = 600;

const MARK_SHAPES = (fill: string) => `
  <rect x="2" y="9" width="7" height="8" rx="3" fill="${fill}" fill-opacity="0.55" />
  <rect x="15" y="9" width="7" height="8" rx="3" fill="${fill}" fill-opacity="0.55" />
  <rect x="7" y="4" width="10" height="13" rx="4.5" fill="${fill}" />
  <rect x="3" y="18.5" width="18" height="3" rx="1.5" fill="${fill}" />`;

const templateSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${MARK_SHAPES("#000000")}</svg>`;

const tileSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <rect width="24" height="24" rx="5" fill="#18181b" />
  <g transform="translate(3 3) scale(0.75)">${MARK_SHAPES("#fafafa")}</g>
</svg>`;

const OUTPUTS = [
  { fileName: "trayTemplate.png", svg: templateSvg, size: 18 },
  { fileName: "trayTemplate@2x.png", svg: templateSvg, size: 36 },
  { fileName: "tray.png", svg: tileSvg, size: 16 },
  { fileName: "tray@2x.png", svg: tileSvg, size: 32 },
] as const;

export class TrayIconRenderError extends Schema.TaggedError<TrayIconRenderError>()(
  "TrayIconRenderError",
  { fileName: Schema.String, cause: Schema.Defect() },
) {}

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const outputDirectory = path.resolve(OUTPUT_DIRECTORY);
  yield* fs.makeDirectory(outputDirectory, { recursive: true });
  for (const output of OUTPUTS) {
    const png = yield* Effect.tryPromise({
      try: () =>
        sharp(Buffer.from(output.svg), { density: SVG_DENSITY })
          .resize(output.size, output.size)
          .png()
          .toBuffer(),
      catch: (cause) => new TrayIconRenderError({ fileName: output.fileName, cause }),
    });
    yield* fs.writeFile(path.join(outputDirectory, output.fileName), png);
    yield* Console.log(`wrote ${path.join(OUTPUT_DIRECTORY, output.fileName)}`);
  }
});

program.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
