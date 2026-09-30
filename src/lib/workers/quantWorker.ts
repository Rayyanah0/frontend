/// <reference lib="webworker" />
import {
  scenarioGrid,
  type ScenarioAxis,
  type ScenarioMode,
} from "../risk";
import type { Position } from "../api/types";

export type QuantWorkerRequest = {
  type: "scenarioGrid";
  positions: Position[];
  spots: Record<string, number>;
  vols: Record<string, number>;
  axis: ScenarioAxis;
  mode: ScenarioMode;
};

export type QuantWorkerResponse = {
  type: "scenarioGridResult";
  result: ReturnType<typeof scenarioGrid>;
};

self.onmessage = (ev: MessageEvent<QuantWorkerRequest>) => {
  const msg = ev.data;
  if (msg?.type === "scenarioGrid") {
    const result = scenarioGrid(msg.positions, msg.spots, msg.vols, msg.axis, msg.mode);
    const response: QuantWorkerResponse = { type: "scenarioGridResult", result };
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(response);
  }
};

export {};
