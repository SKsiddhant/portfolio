// Heavy research jobs (144-run sweeps, walk-forward) run off the main thread.
import { sweep, walkForward } from "./analysis.js";

self.onmessage = ({ data: msg }) => {
  try {
    const result =
      msg.kind === "sweep"
        ? sweep(msg.data, msg.strategy, msg.params, msg.config)
        : walkForward(msg.data, msg.strategy, msg.params, msg.config, msg.folds);
    self.postMessage({ id: msg.id, result });
  } catch (e) {
    self.postMessage({ id: msg.id, error: e.message });
  }
};
