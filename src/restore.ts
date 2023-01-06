import * as cache from "@actions/cache";
import * as core from "@actions/core";

import { cleanTargetDir, getCargoBins } from "./cleanup";
import { CacheConfig, STATE_BINS, STATE_KEY } from "./config";
import os from "os";
import path from "path";

process.on("uncaughtException", (e) => {
  core.info(`[warning] ${e.message}`);
  if (e.stack) {
    core.info(e.stack);
  }
});

function fixupPath(somePath: string) {
  return somePath.replace('~', os.homedir()).replaceAll("/", path.sep);
}

async function run() {
  const fixedCachePaths: Array<string> = [];

  if (!cache.isFeatureAvailable()) {
    setCacheHitOutput(false);
    return;
  }

  try {
    var cacheOnFailure = core.getInput("cache-on-failure").toLowerCase();
    if (cacheOnFailure !== "true") {
      cacheOnFailure = "false";
    }
    core.exportVariable("CACHE_ON_FAILURE", cacheOnFailure);
    core.exportVariable("CARGO_INCREMENTAL", 0);

    const config = await CacheConfig.new();
    config.printInfo();
    core.info("");

    const bins = await getCargoBins();
    core.saveState(STATE_BINS, JSON.stringify([...bins]));

    // Normalize paths according to OS
    for await (const cachePath of config.cachePaths) {
      fixedCachePaths.push(fixupPath(cachePath));
    }
    // First item of fixedCachePaths is CARGO_HOME
    // If some of successive items is within CARGO_HOME, then it will be cached along with CARGO_HOME.
    // If we leave it then it will be added for the second time to the cache archive (increasing its size).
    // Therefore remove such paths.
    for  (var i = 1; i < fixedCachePaths.length; i++) {
        if (fixedCachePaths[i].startsWith(fixedCachePaths[0])) {
            fixedCachePaths.splice(i,1);
        }
    }

    core.info(`... Restoring cache ...`);
    const key = config.cacheKey;
    const restoreKey = await cache.restoreCache(fixedCachePaths, key, [config.restoreKey]);
    if (restoreKey) {
      core.info(`Restored from cache key "${restoreKey}".`);
      core.saveState(STATE_KEY, restoreKey);

      if (restoreKey !== key) {
        // pre-clean the target directory on cache mismatch
        for (const workspace of config.workspaces) {
          try {
            await cleanTargetDir(workspace.target, [], true);
          } catch {}
        }
      }

      setCacheHitOutput(restoreKey === key);
    } else {
      core.info("No cache found.");

      setCacheHitOutput(false);
    }
  } catch (e) {
    setCacheHitOutput(false);

    core.info(`[warning] ${(e as any).stack}`);
  }
}

function setCacheHitOutput(cacheHit: boolean): void {
  core.setOutput("cache-hit", cacheHit.toString());
}

run();
