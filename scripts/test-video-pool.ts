/**
 * Video-pool tests: env parsing, LRU ordering, cooldown, failure backoff,
 * and the ZeroGPU quota ledger. Run: npx tsx scripts/test-video-pool.ts
 */
import {
  buildVideoPool,
  parseList,
  pollinationsModelEntries,
  spacesPoolEntries,
  VideoPoolState,
} from "../src/lib/providers/video-pool";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name} ${extra}`);
  }
}

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const T0 = 1_700_000_000_000;

// parseList
check("parseList splits and trims", JSON.stringify(parseList("a, b ,c")) === JSON.stringify(["a", "b", "c"]));
check("parseList drops empties", parseList("a,, ,b").length === 2);
check("parseList undefined -> []", parseList(undefined).length === 0);

// spaces pool entries
withEnv({ HF_SPACES_VIDEO_ENABLED: undefined, HF_SPACES_VIDEO_POOL: "x/y", HF_SPACE_ID: "s/t" }, () => {
  check("spaces gate off -> no entries", spacesPoolEntries().length === 0);
});
withEnv({ HF_SPACES_VIDEO_ENABLED: "true", HF_SPACES_VIDEO_POOL: "a/b, c/d", HF_SPACE_ID: "s/t" }, () => {
  const e = spacesPoolEntries();
  check("pool list wins over single", e.length === 2 && e[0] === "a/b");
});
withEnv({ HF_SPACES_VIDEO_ENABLED: "true", HF_SPACES_VIDEO_POOL: undefined, HF_SPACE_ID: "s/t" }, () => {
  check("single HF_SPACE_ID fallback", spacesPoolEntries().join() === "s/t");
});

// pollinations models
withEnv({ POLLINATIONS_VIDEO_MODELS: "wan,ltx-2", POLLINATIONS_VIDEO_MODEL: "veo" }, () => {
  check("model list wins", pollinationsModelEntries().join() === "wan,ltx-2");
});
withEnv({ POLLINATIONS_VIDEO_MODELS: undefined, POLLINATIONS_VIDEO_MODEL: undefined }, () => {
  check("default ltx-2", pollinationsModelEntries().join() === "ltx-2");
});

// buildVideoPool shape
withEnv(
  {
    HF_SPACES_VIDEO_ENABLED: "true",
    HF_SPACES_VIDEO_POOL: "u/wan,u/ltx",
    POLLINATIONS_VIDEO_MODELS: "wan",
    REMOTION_ENABLED: "true",
  },
  () => {
    const pool = buildVideoPool();
    const kinds = pool.map((p) => p.kind).join();
    check("pool order spaces,pollinations,remotion,ffmpeg", kinds === "spaces,spaces,pollinations,remotion,ffmpeg", kinds);
    check("ffmpeg always present", pool.some((p) => p.kind === "ffmpeg"));
    check("endpoint keys unique", new Set(pool.map((p) => p.key)).size === pool.length);
  }
);
withEnv(
  {
    HF_SPACES_VIDEO_ENABLED: undefined,
    HF_SPACES_VIDEO_POOL: undefined,
    HF_SPACE_ID: undefined,
    POLLINATIONS_VIDEO_MODELS: undefined,
    POLLINATIONS_VIDEO_MODEL: undefined,
    REMOTION_ENABLED: undefined,
  },
  () => {
    const pool = buildVideoPool();
    check("minimal pool = pollinations + ffmpeg", pool.map((p) => p.kind).join() === "pollinations,ffmpeg");
  }
);

// LRU ordering
{
  const dir = mkdtempSync(join(tmpdir(), "vpool-"));
  withEnv(
    {
      HF_SPACES_VIDEO_ENABLED: "true",
      HF_SPACES_VIDEO_POOL: "u/a,u/b",
      POLLINATIONS_VIDEO_MODELS: undefined,
      POLLINATIONS_VIDEO_MODEL: "ltx-2",
      REMOTION_ENABLED: undefined,
      VIDEO_POOL_COOLDOWN_SEC: "60",
      VIDEO_POOL_LEDGER_PATH: join(dir, "ledger.json"),
      ZERO_GPU_DAILY_MINUTES: "5",
    },
    () => {
      const pool = buildVideoPool();
      const st = new VideoPoolState(join(dir, "ledger.json"));
      const first = st.orderedEndpoints(pool, T0).map((p) => p.key);
      check("fresh state keeps configured order", first[0] === "spaces:u/a" && first[1] === "spaces:u/b", first.join());
      st.recordUse("spaces:u/a", T0);
      const second = st.orderedEndpoints(pool, T0 + 61_000).map((p) => p.key);
      check(
        "used endpoint sinks below never-used (LRU)",
        second.indexOf("spaces:u/a") > second.indexOf("spaces:u/b") &&
          second.indexOf("spaces:u/a") > second.indexOf("pollinations:ltx-2"),
        second.join()
      );
      const during = st.orderedEndpoints(pool, T0 + 30_000).map((p) => p.key);
      check("cooldown hides just-used endpoint", !during.includes("spaces:u/a"), during.join());
      check("ffmpeg stays last", second[second.length - 1] === "ffmpeg");
    }
  );
}

// failure backoff
{
  const dir = mkdtempSync(join(tmpdir(), "vpool-"));
  withEnv(
    {
      HF_SPACES_VIDEO_ENABLED: "true",
      HF_SPACES_VIDEO_POOL: "u/a,u/b",
      POLLINATIONS_VIDEO_MODELS: undefined,
      POLLINATIONS_VIDEO_MODEL: "ltx-2",
      REMOTION_ENABLED: undefined,
      VIDEO_POOL_COOLDOWN_SEC: "0",
      VIDEO_POOL_MAX_FAILS: "3",
      VIDEO_POOL_FAIL_BACKOFF_MIN: "30",
      VIDEO_POOL_LEDGER_PATH: join(dir, "ledger.json"),
      ZERO_GPU_DAILY_MINUTES: "5",
    },
    () => {
      const pool = buildVideoPool();
      const st = new VideoPoolState(join(dir, "ledger.json"));
      st.recordFailure("spaces:u/a", T0);
      st.recordFailure("spaces:u/a", T0 + 1000);
      let keys = st.orderedEndpoints(pool, T0 + 2000).map((p) => p.key);
      check("2 fails still eligible", keys.includes("spaces:u/a"), keys.join());
      st.recordFailure("spaces:u/a", T0 + 3000);
      keys = st.orderedEndpoints(pool, T0 + 4000).map((p) => p.key);
      check("3 fails -> backoff hides endpoint", !keys.includes("spaces:u/a"), keys.join());
      st.recordSuccess("spaces:u/a");
      keys = st.orderedEndpoints(pool, T0 + 5000).map((p) => p.key);
      check("success clears backoff", keys.includes("spaces:u/a"), keys.join());
    }
  );
}

// quota ledger
{
  const dir = mkdtempSync(join(tmpdir(), "vpool-"));
  const ledgerPath = join(dir, "ledger.json");
  withEnv(
    {
      HF_SPACES_VIDEO_ENABLED: "true",
      HF_SPACES_VIDEO_POOL: "u/a",
      POLLINATIONS_VIDEO_MODELS: undefined,
      POLLINATIONS_VIDEO_MODEL: "ltx-2",
      REMOTION_ENABLED: undefined,
      VIDEO_POOL_COOLDOWN_SEC: "0",
      VIDEO_POOL_LEDGER_PATH: ledgerPath,
      ZERO_GPU_DAILY_MINUTES: "5",
    },
    () => {
      const pool = buildVideoPool();
      const st = new VideoPoolState(ledgerPath);
      check("fresh quota = 5", st.quotaRemainingMin(T0) === 5);
      st.recordSpacesUsage(4.5, T0);
      check("quota decreases", Math.abs(st.quotaRemainingMin(T0 + 1000) - 0.5) < 1e-9);
      const keys = st.orderedEndpoints(pool, T0 + 2000).map((p) => p.key);
      check("spaces still eligible with 0.5 left", keys.includes("spaces:u/a"), keys.join());
      st.recordSpacesUsage(1, T0 + 3000);
      const keys2 = st.orderedEndpoints(pool, T0 + 4000).map((p) => p.key);
      check("quota spent -> spaces hidden, ffmpeg remains", !keys2.includes("spaces:u/a") && keys2.includes("ffmpeg"), keys2.join());
      // ledger persisted
      const raw = JSON.parse(readFileSync(ledgerPath, "utf8")) as { minutesUsed: number };
      check("ledger persisted to disk", raw.minutesUsed > 5, JSON.stringify(raw));
      // 24h rollover
      const st2 = new VideoPoolState(ledgerPath);
      check("24h rollover resets quota", st2.quotaRemainingMin(T0 + 25 * 3600 * 1000) === 5);
      // corrupt ledger -> fail-safe fresh
      const st3dir = mkdtempSync(join(tmpdir(), "vpool-"));
      const badPath = join(st3dir, "ledger.json");
      writeFileSync(badPath, "not json{{{", "utf8");
      const st3 = new VideoPoolState(badPath);
      check("corrupt ledger fails safe", st3.quotaRemainingMin(T0) === 5);
    }
  );
}

// ffmpeg never hidden
{
  const dir = mkdtempSync(join(tmpdir(), "vpool-"));
  withEnv(
    {
      HF_SPACES_VIDEO_ENABLED: "true",
      HF_SPACES_VIDEO_POOL: "u/a",
      POLLINATIONS_VIDEO_MODELS: undefined,
      POLLINATIONS_VIDEO_MODEL: "ltx-2",
      REMOTION_ENABLED: undefined,
      VIDEO_POOL_COOLDOWN_SEC: "99999",
      VIDEO_POOL_LEDGER_PATH: join(dir, "ledger.json"),
      ZERO_GPU_DAILY_MINUTES: "0",
    },
    () => {
      const pool = buildVideoPool();
      const st = new VideoPoolState(join(dir, "ledger.json"));
      const keys = st.orderedEndpoints(pool, T0).map((p) => p.key);
      check("ffmpeg eligible even with spaces blocked", keys.includes("ffmpeg"), keys.join());
    }
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
