import { Link, useRouterState } from "@tanstack/react-router";
import { Package, Container, Ship, ListChecks, Activity, Linkedin, Github, ShieldCheck } from "lucide-react";
import { useAppStore } from "@/lib/store";

const NAV = [
  { to: "/", label: "Dashboard", icon: Activity },
  { to: "/images", label: "Images", icon: Container },
  { to: "/scan", label: "Scan & Fix", icon: ShieldCheck },
  { to: "/helm", label: "Helm", icon: Ship },
  { to: "/queue", label: "Queue", icon: ListChecks },
  { to: "/downloads", label: "Downloads", icon: Package },
] as const;

export function Header() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const queueSize = useAppStore((s) => s.queue.length);

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-6">
        <div className="flex items-center gap-2.5">
          <Link to="/" className="relative flex h-9 w-9 items-center justify-center rounded-lg gradient-primary glow-primary" aria-label="Dashboard">
            <Package className="h-4.5 w-4.5 text-primary-foreground" strokeWidth={2.5} />
          </Link>
          <div className="leading-tight">
            <Link to="/" className="block text-sm font-semibold tracking-tight hover:text-primary-glow transition-colors">
              Docker Images Downloader
            </Link>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>made by</span>
              <a
                href="https://www.linkedin.com/in/mostafa-mohamed-ali9/"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-foreground hover:text-primary-glow transition-colors"
                aria-label="Mostafa Mohamed on LinkedIn"
              >
                <Linkedin className="h-3 w-3" />
                <span>Mostafa Mohamed</span>
              </a>
              <span className="text-border">·</span>
              <a
                href="https://github.com/mostafamohamed18/docker-images-downloader"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-foreground hover:text-primary-glow transition-colors"
                aria-label="Project on GitHub"
              >
                <Github className="h-3 w-3" />
                <span>GitHub</span>
              </a>
            </div>
          </div>
        </div>

        <nav className="ml-6 flex items-center gap-1">
          {NAV.map((item) => {
            const active =
              item.to === "/"
                ? pathname === "/"
                : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={[
                  "group relative flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-primary/15 text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                ].join(" ")}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
                {item.to === "/queue" && queueSize > 0 && (
                  <span className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                    {queueSize}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 rounded-full border border-border/70 bg-surface/60 px-3 py-1 text-xs text-muted-foreground">
          <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
          <span className="font-mono">edge · online</span>
        </div>
      </div>
    </header>
  );
}
