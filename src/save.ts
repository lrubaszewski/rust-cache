import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";

import { cleanBin, cleanGit, cleanRegistry, cleanTargetDir } from "./cleanup";
import { CacheConfig, STATE_KEY } from "./config";
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
  const save = core.getInput("save-if").toLowerCase() || "true";

  const fixedCachePaths: Array<string> = [];

  if (!(cache.isFeatureAvailable() && save === "true")) {
    return;
  }

  try {
    const config = await CacheConfig.new();
    config.printInfo();
    core.info("");

    if (core.getState(STATE_KEY) === config.cacheKey) {
      core.info(`Cache up-to-date.`);
      return;
    }

    // normalize paths according to OS
    for await (const cachePath of config.cachePaths) {
      fixedCachePaths.push(fixupPath(cachePath));
    }

    // TODO: remove this once https://github.com/actions/toolkit/pull/553 lands
    await macOsWorkaround();

    const allPackages = [];
    for (const workspace of config.workspaces) {
      const packages = await workspace.getPackages();
      allPackages.push(...packages);
      try {
        core.info(`... Cleaning ${workspace.target} ...`);
        await cleanTargetDir(workspace.target, packages);
      } catch (e) {
        core.info(`[warning] ${(e as any).stack}`);
      }
    }

    try {
      core.info(`... Cleaning cargo registry ...`);
      await cleanRegistry(allPackages, fixedCachePaths);
    } catch (e) {
      core.info(`[warning] ${(e as any).stack}`);
    }

    try {
      core.info(`... Cleaning cargo/bin ...`);
      await cleanBin();
    } catch (e) {
      core.info(`[warning] ${(e as any).stack}`);
    }

    try {
      core.info(`... Cleaning cargo git cache ...`);
      await cleanGit(allPackages);
    } catch (e) {
      core.info(`[warning] ${(e as any).stack}`);
    }

    // First item of fixedCachePaths is CARGO_HOME
    // If some of successive items is within CARGO_HOME, then it will be cached along with CARGO_HOME.
    // If we leave it then it will added for the second time to the cache archive (increasing its size).
    for  (var i = 1; i < fixedCachePaths.length; i++) {
        if (fixedCachePaths[i].startsWith(fixedCachePaths[0])) {
            fixedCachePaths.splice(i,1);
        }
    }

    core.info(`... Saving cache ...`);
    await cache.saveCache(fixedCachePaths, config.cacheKey);
  } catch (e) {
    core.info(`[warning] ${(e as any).stack}`);
  }
}

run();

async function macOsWorkaround() {
  try {
    // Workaround for https://github.com/actions/cache/issues/403
    // Also see https://github.com/rust-lang/cargo/issues/8603
    await exec.exec("sudo", ["/usr/sbin/purge"], { silent: true });
  } catch {}
}
