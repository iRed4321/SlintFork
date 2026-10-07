// Copyright © SixtyFPS GmbH <info@slint.dev>
// SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-Slint-Royalty-free-2.0 OR LicenseRef-Slint-Software-3.0

// Follows docs/nodejs/src/content/docs/packaging.mdx.

import { test, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const [major, minor] = process.versions.node.split(".").map(Number);
const hasBuildSea = major > 25 || (major === 25 && minor >= 5);

const output = process.platform === "win32" ? "myapp.exe" : "myapp";

const files: Record<string, string | Buffer> = {
    "package.json": JSON.stringify({ type: "module" }),
    "ui/app.slint": `
        export component App inherits Window {
            out property <int> image-width: img.source.width;
            img := Image { source: @image-url("rgb.png"); }
        }`,
    "ui/loaded.slint": `
        export component Loaded { out property <image> img: @image-url("rgb.png"); }`,
    "ui/rgb.png": fs.readFileSync(path.join(dirname, "resources", "rgb.png")),
    // The top-level await is why start.cjs uses import().
    "main.ts": `
        import * as slint from "slint-ui";
        import { App } from "./ui/app.slint";
        slint.private_api.initTesting();
        const app = new (App as any)();
        const { Loaded } = slint.loadFile(new URL("./ui/loaded.slint", import.meta.url)) as any;
        await Promise.resolve();
        console.log(JSON.stringify({ image: app.image_width, loaded: new Loaded().img.width }));`,
    "start.cjs": `import("slint-ui/register").then(() => import("./main.ts"));`,
    "sea-main.cjs": `
        const { createRequire } = require("node:module");
        createRequire(__filename)("./start.cjs");`,
    "sea-config.json": JSON.stringify({
        main: "sea-main.cjs",
        output,
        disableExperimentalSEAWarning: true,
    }),
};

test.skipIf(!hasBuildSea)(
    "a single executable application starts the application it sits in",
    { timeout: 120_000 },
    () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "slint-sea-"));
        try {
            for (const [file, contents] of Object.entries(files)) {
                fs.mkdirSync(path.dirname(path.join(root, file)), {
                    recursive: true,
                });
                fs.writeFileSync(path.join(root, file), contents);
            }
            fs.mkdirSync(path.join(root, "node_modules"));
            fs.symlinkSync(
                path.join(dirname, ".."),
                path.join(root, "node_modules", "slint-ui"),
                "junction",
            );
            execFileSync(process.execPath, ["--build-sea", "sea-config.json"], {
                cwd: root,
            });
            const executable = path.join(root, output);
            if (process.platform === "darwin") {
                execFileSync("codesign", [
                    "--sign",
                    "-",
                    "--force",
                    executable,
                ]);
            }

            expect(
                JSON.parse(
                    execFileSync(executable, {
                        cwd: os.tmpdir(),
                        encoding: "utf8",
                    }),
                ),
            ).toStrictEqual({ image: 64, loaded: 64 });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    },
);
