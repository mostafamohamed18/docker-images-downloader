import { Badge } from "@/components/ui/badge";
import { REGISTRIES, type RegistryId } from "@/lib/registries";
import { cn } from "@/lib/utils";

const COLORS: Record<RegistryId, string> = {
  docker: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  ghcr: "border-slate-400/30 bg-slate-400/10 text-slate-200",
  gcr: "border-red-500/30 bg-red-500/10 text-red-300",
  chainguard: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  quay: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  custom: "border-primary/30 bg-primary/10 text-primary-glow",
};

export function RegistryBadge({ id, className }: { id: RegistryId; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("font-mono text-[10px] uppercase tracking-wider", COLORS[id], className)}
    >
      {REGISTRIES[id].label.split(" ")[0]}
    </Badge>
  );
}
