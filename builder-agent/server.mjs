#!/usr/bin/env node
// Docker Fix Builder Agent
// Receives a rebuild spec, runs `docker build` + `docker save`, streams tar back.
// Auth: HMAC-SHA256 of raw body, sent as `Authorization: Bearer <hex>`.

import http from "node:http";
import { spawn } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = Number(process.env.PORT || 8443);
const SECRET = process.env.SHARED_SECRET;
if (!SECRET || SECRET.length < 16) {
  console.error("FATAL: SHARED_SECRET env var is required (>=16 chars)");
  process.exit(1);
}

function verifySig(rawBody, header) {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = header.slice(7).trim();
  const expected = createHmac("sha256", SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

// Escape a reference for inclusion in a Dockerfile FROM/RUN line.
// Only allow: alnum, `.`, `-`, `_`, `:`, `/`, `@`, `+`, `=`.
function safeToken(s, maxLen = 256) {
  if (typeof s !== "string" || s.length === 0 || s.length > maxLen) return null;
  return /^[A-Za-z0-9._:\/@+=-]+$/.test(s) ? s : null;
}

function buildDockerfile(spec) {
  const from = safeToken(spec.baseImage);
  if (!from) throw new Error("invalid baseImage");
  const pm = spec.packageManager;
  const upgrades = Array.isArray(spec.upgrades) ? spec.upgrades : [];
  const pkgs = upgrades
    .map((u) => safeToken(u, 200))
    .filter(Boolean);

  let installCmd;
  if (pm === "apt") {
    // Always run a full `upgrade` so security patches for transitive deps land
    // too. Then best-effort `--only-upgrade` the specific packages the scanner
    // flagged (harmless if they were already covered above).
    const targeted = pkgs.length
      ? ` && (apt-get install -y --only-upgrade ${pkgs.join(" ")} || true)`
      : "";
    installCmd = `apt-get update && apt-get -y upgrade${targeted} && rm -rf /var/lib/apt/lists/*`;
    return `FROM ${from}\nUSER 0\nRUN ${installCmd}\n`;
  }
  if (pm === "apk") {
    // `apk upgrade` covers everything; targeted `add --upgrade` for the flagged
    // packages ensures they're pulled in even if not previously installed.
    const targeted = pkgs.length ? ` && (apk add --no-cache --upgrade ${pkgs.join(" ")} || true)` : "";
    installCmd = `apk update && apk upgrade --no-cache${targeted}`;
    return `FROM ${from}\nUSER 0\nRUN ${installCmd}\n`;
  }
  if (pm === "dnf" || pm === "yum") {
    installCmd = `${pm} -y update && ${pm} clean all`;
    return `FROM ${from}\nUSER 0\nRUN ${installCmd}\n`;
  }
  throw new Error(`unsupported packageManager: ${pm}`);
}

async function handleBuild(req, res, spec) {
  let dockerfile;
  try {
    dockerfile = buildDockerfile(spec);
  } catch (e) {
    return json(res, 400, { error: e.message });
  }

  const workdir = await mkdtemp(path.join(tmpdir(), "dfxa-"));
  const dfPath = path.join(workdir, "Dockerfile");
  await writeFile(dfPath, dockerfile, "utf8");
  // Tag must not contain a slash — with BuildKit/containerd image store,
  // `foo/bar` gets interpreted as `registry=foo`, causing a pull attempt.
  const tag = `docker-fix-${Date.now()}:latest`;

  console.log(`[build] tag=${tag} baseImage=${spec.baseImage} pkgs=${(spec.upgrades || []).length}`);

  const build = spawn("docker", ["build", "-t", tag, "-f", dfPath, workdir], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buildErr = "";
  build.stdout.on("data", (d) => process.stdout.write(d));
  build.stderr.on("data", (d) => {
    buildErr += d.toString();
    process.stderr.write(d);
  });

  const buildCode = await new Promise((r) => build.on("close", r));
  if (buildCode !== 0) {
    await rm(workdir, { recursive: true, force: true });
    return json(res, 500, {
      error: "docker build failed",
      exitCode: buildCode,
      log: buildErr.slice(-4000),
    });
  }

  // Stream docker save output straight to client.
  const safeName = spec.baseImage.replace(/[^A-Za-z0-9._-]/g, "_");
  res.writeHead(200, {
    "Content-Type": "application/x-tar",
    "Content-Disposition": `attachment; filename="${safeName}-fixed.tar"`,
    "X-Fixed-Image-Tag": tag,
  });

  const save = spawn("docker", ["save", tag], { stdio: ["ignore", "pipe", "pipe"] });
  save.stdout.pipe(res);
  save.stderr.on("data", (d) => process.stderr.write(d));

  save.on("close", async (code) => {
    console.log(`[save] tag=${tag} exit=${code}`);
    // Best-effort cleanup: remove built image + workdir
    spawn("docker", ["rmi", "-f", tag], { stdio: "ignore" });
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
    if (!res.writableEnded) res.end();
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/healthz") {
      return json(res, 200, { ok: true });
    }
    if (req.method !== "POST" || req.url !== "/build") {
      return json(res, 404, { error: "not found" });
    }
    const body = await readBody(req);
    if (!verifySig(body, req.headers["authorization"])) {
      return json(res, 401, { error: "invalid signature" });
    }
    let spec;
    try {
      spec = JSON.parse(body.toString("utf8"));
    } catch {
      return json(res, 400, { error: "invalid json" });
    }
    await handleBuild(req, res, spec);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: String(err?.message || err) });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`docker-fix-agent listening on :${PORT}`);
});
