export type Phase = "selecting" | "capturing" | "complete" | "cancelled";
export function transition(from: Phase, to: Phase): Phase {
  if (
    (from === "selecting" && (to === "capturing" || to === "cancelled")) ||
    (from === "capturing" && (to === "complete" || to === "cancelled"))
  )
    return to;
  throw new Error("This capture session has expired. Start a new capture.");
}
