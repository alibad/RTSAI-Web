import { installGameMeasurement } from "./game-measurement.mjs";

export function bootstrapGameMeasurement(target) {
  const sink = typeof target.rtsaiMeasurementSink === "function"
    ? target.rtsaiMeasurementSink
    : (name, parameters) => target.dispatchEvent(new CustomEvent("rtsai:measurement", { detail: { name, parameters } }));
  return installGameMeasurement(target, sink);
}
if (typeof window !== "undefined") bootstrapGameMeasurement(window);
