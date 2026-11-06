import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorRouteComponent,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Header } from "@/components/layout/header";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="font-mono text-xs uppercase tracking-widest text-primary">error · 404</div>
        <h1 className="mt-3 text-4xl font-bold">Not in the registry</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The manifest for this route couldn&apos;t be resolved.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center justify-center rounded-md gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground glow-primary"
        >
          Return to dashboard
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="font-mono text-xs uppercase tracking-widest text-destructive">
          fatal
        </div>
        <h1 className="mt-3 text-2xl font-semibold">Pipeline halted</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error.message || "Something went wrong."}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Retry
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm"
          >
            Home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Docker Images Downloader" },
      {
        name: "description",
        content:
          "Track downloads and cache usage for your air-gapped image and Helm chart packaging workflow.",
      },
      { name: "author", content: "Air-Gapped Packager" },
      { property: "og:title", content: "Docker Images Downloader" },
      {
        property: "og:description",
        content:
          "Track downloads and cache usage for your air-gapped image and Helm chart packaging workflow.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Docker Images Downloader" },
      { name: "twitter:description", content: "Track downloads and cache usage for your air-gapped image and Helm chart packaging workflow." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/e822bf28-70e9-4378-aef3-121fd83ad0b3" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/e822bf28-70e9-4378-aef3-121fd83ad0b3" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent as unknown as ErrorRouteComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
          <Outlet />
        </main>
        <footer className="border-t border-border/60 py-6">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-6 text-xs text-muted-foreground sm:flex-row">
            <span className="font-mono">docker-images-downloader · v1</span>
            <span className="flex items-center gap-1.5">
              <span>made by</span>
              <a
                href="https://www.linkedin.com/in/mostafa-mohamed-ali9/"
                target="_blank"
                rel="noreferrer noopener"
                className="text-foreground hover:text-primary-glow transition-colors"
              >
                Mostafa Mohamed (LinkedIn)
              </a>
              <span className="text-border">·</span>
              <a
                href="https://github.com/mostafamohamed18/docker-images-downloader"
                target="_blank"
                rel="noreferrer noopener"
                className="text-foreground hover:text-primary-glow transition-colors"
              >
                GitHub
              </a>
            </span>
          </div>
        </footer>
      </div>
      <Toaster theme="dark" position="bottom-right" richColors />
    </QueryClientProvider>
  );
}
