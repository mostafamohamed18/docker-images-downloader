import { createFileRoute } from "@tanstack/react-router";
import { createHmac } from "node:crypto";
import { CORS_HEADERS, corsError, corsPreflight } from "@/lib/registry-proxy.server";
import type { FixPlan } from "@/lib/scanner/types";

export const Route = createFileRoute("/api/public/registry/rebuild")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      POST: async ({ request }) => {
        try {
          const builderUrl = process.env.DOCKER_BUILDER_URL;
          const builderSecret = process.env.DOCKER_BUILDER_SECRET;
          if (!builderUrl || !builderSecret) {
            return corsError(
              "Builder not configured. Ask the owner to set DOCKER_BUILDER_URL and DOCKER_BUILDER_SECRET.",
              503,
            );
          }

          const plan = (await request.json()) as Partial<FixPlan>;
          if (!plan?.baseImage || !plan.packageManager) {
            return corsError("missing baseImage / packageManager", 400);
          }
          if (!/^[a-zA-Z0-9._\/-]+(:[a-zA-Z0-9._-]+)?$/.test(plan.baseImage)) {
            return corsError("invalid baseImage", 400);
          }
          if (!["apt", "apk", "dnf", "yum"].includes(plan.packageManager)) {
            return corsError("invalid packageManager", 400);
          }
          const upgrades = Array.isArray(plan.upgrades) ? plan.upgrades.slice(0, 500) : [];
          for (const u of upgrades) {
            if (typeof u !== "string" || !/^[a-zA-Z0-9._+-]+$/.test(u)) {
              return corsError(`invalid package name: ${u}`, 400);
            }
          }

          const rawBody = JSON.stringify({
            baseImage: plan.baseImage,
            packageManager: plan.packageManager,
            upgrades,
          });
          const sig = createHmac("sha256", builderSecret).update(rawBody).digest("hex");

          const upstream = await fetch(`${builderUrl.replace(/\/$/, "")}/build`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${sig}`,
            },
            body: rawBody,
          });

          if (!upstream.ok || !upstream.body) {
            const text = await upstream.text().catch(() => "");
            return corsError(
              `Builder returned ${upstream.status}: ${text.slice(0, 500)}`,
              upstream.status,
            );
          }

          const safeName = plan.baseImage.replace(/[^A-Za-z0-9._-]/g, "_");
          const outHeaders: Record<string, string> = {
            ...CORS_HEADERS,
            "Content-Type": "application/x-tar",
            "Content-Disposition": `attachment; filename="${safeName}-fixed.tar"`,
            "Access-Control-Expose-Headers": "Content-Disposition, X-Fixed-Image-Tag",
          };
          const tag = upstream.headers.get("x-fixed-image-tag");
          if (tag) outHeaders["X-Fixed-Image-Tag"] = tag;

          return new Response(upstream.body, { status: 200, headers: outHeaders });
        } catch (err) {
          return corsError((err as Error).message, 500);
        }
      },
    },
  },
});
