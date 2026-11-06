import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ParsedRef } from "./registries";

export type QueueItemType = "image" | "chart";

export interface ImageQueueItem {
  id: string;
  type: "image";
  ref: ParsedRef;
  arch: string;
  addedAt: number;
}

export interface ChartQueueItem {
  id: string;
  type: "chart";
  repoName?: string;
  chartName: string;
  version?: string;
  directUrl?: string;
  addedAt: number;
}

export type QueueItem = ImageQueueItem | ChartQueueItem;

export interface HistoryEntry {
  id: string;
  label: string;
  kind: "image" | "chart" | "batch";
  bytes: number;
  at: number;
  filename: string;
}

interface StoreState {
  queue: QueueItem[];
  history: HistoryEntry[];
  addImage: (ref: ParsedRef, arch: string) => void;
  addChart: (c: Omit<ChartQueueItem, "id" | "type" | "addedAt">) => void;
  remove: (id: string) => void;
  clearQueue: () => void;
  pushHistory: (e: Omit<HistoryEntry, "id" | "at">) => void;
  clearHistory: () => void;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const useAppStore = create<StoreState>()(
  persist(
    (set) => ({
      queue: [],
      history: [],
      addImage: (ref, arch) =>
        set((s) => ({
          queue: [
            ...s.queue,
            { id: uid(), type: "image", ref, arch, addedAt: Date.now() },
          ],
        })),
      addChart: (c) =>
        set((s) => ({
          queue: [
            ...s.queue,
            { id: uid(), type: "chart", addedAt: Date.now(), ...c },
          ],
        })),
      remove: (id) => set((s) => ({ queue: s.queue.filter((q) => q.id !== id) })),
      clearQueue: () => set({ queue: [] }),
      pushHistory: (e) =>
        set((s) => ({
          history: [
            { id: uid(), at: Date.now(), ...e },
            ...s.history,
          ].slice(0, 50),
        })),
      clearHistory: () => set({ history: [] }),
    }),
    { name: "airgap-packager-v1" },
  ),
);
