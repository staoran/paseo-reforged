import esbuild from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "../..");
const entry = path.join(appRoot, "src/mermaid/webview/mermaid-webview-entry.ts");
const output = path.join(appRoot, "src/mermaid/webview/mermaid-webview.html");

async function resolveTsPath(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js"),
    path.join(basePath, "index.jsx"),
  ];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // Try the next supported source extension.
    }
  }
  return basePath;
}

const aliasPlugin = {
  name: "paseo-alias",
  setup(build) {
    build.onResolve({ filter: /^@\// }, async (args) => ({
      path: await resolveTsPath(path.join(appRoot, "src", args.path.slice(2))),
    }));
  },
};

const result = await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["ios15", "chrome100"],
  minify: true,
  plugins: [aliasPlugin],
  logLevel: "info",
});

const bundledJavaScript = result.outputFiles[0]?.text;
if (!bundledJavaScript) {
  throw new Error("Mermaid WebView bundle produced no JavaScript");
}
const safeJavaScript = bundledJavaScript.replace(/<\/script/gi, "<\\/script");

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; media-src 'none'; base-uri 'none'; form-action 'none'"
    />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
    />
  </head>
  <body>
    <script>${safeJavaScript}</script>
  </body>
</html>`;

await fs.writeFile(output, html);
console.log(`Wrote ${path.relative(repoRoot, output)} (${html.length} bytes)`);
