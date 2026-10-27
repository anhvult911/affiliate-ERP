import type { WorkerConfig } from "../config.js";
import { GenloginProvider } from "./genlogin.js";
import { GpmLoginProvider } from "./gpm.js";
import { LocalProfileProvider } from "./local.js";
import type { AntidetectProvider } from "./types.js";

export function resolveProvider(config: WorkerConfig): AntidetectProvider {
  switch (config.provider) {
    case "gpm":
      return new GpmLoginProvider(config.gpmApiUrl);
    case "genlogin":
      return new GenloginProvider(config.genloginApiUrl);
    case "local":
      return new LocalProfileProvider(config.localProfileDir, config.browserChannel, config.browserHeadless);
  }
}

export type { AntidetectProvider, BrowserSession, OpenProfileOptions } from "./types.js";
export { launchBrowser, firstPage, parseProxy } from "./types.js";
