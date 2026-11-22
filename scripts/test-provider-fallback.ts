/**
 * Ad-hoc verification for the provider failover layer (not part of CI).
 * 1. Circuit breaker: trips after 3 failures, excludes provider from the chain
 * 2. Circuit breaker: success resets the failure count
 * 3. attemptWithFallback: first provider fails → second succeeds
 * 4. attemptWithFallback: all fail → typed error listing each provider
 * 5. attemptWithFallback: thrown exception becomes a typed error, failover continues
 * 6. attemptWithFallback: empty chain → not_configured
 * 7. espeak adapter: honest dependency_missing when no binary is installed
 * 8. pollinations.generateText: input validation needs no network
 * 9. Router chains: script includes pollinations, tts includes espeak
 */
import {
  attemptWithFallback,
} from "../src/lib/providers/fallback";
import {
  getProviderStatus,
  isCircuitOpen,
  providersForTask,
  recordProviderFailure,
  recordProviderSuccess,
  resetProviderCircuit,
  type ProviderStatusEntry,
} from "../src/lib/providers/router";
import { errResult, okResult } from "../src/lib/providers/types";
import * as espeakTts from "../src/lib/providers/espeak-tts";
import * as pollinations from "../src/lib/providers/pollinations";

async function main() {

  let failures = 0;
  function check(name: string, cond: boolean, detail = "") {
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    if (!cond) failures++;
  }

  function fakeProvider(key: string): ProviderStatusEntry {
    return { key, name: `Test ${key}`, capabilities: ["script"], status: "configured", detail: "test double" };
  }

  // ---- 1. circuit trips after 3 failures ----
  resetProviderCircuit("fake-a");
  recordProviderFailure("fake-a");
  recordProviderFailure("fake-a");
  check("circuit closed after 2 failures", !isCircuitOpen("fake-a"));
  recordProviderFailure("fake-a");
  check("circuit opens after 3 failures", isCircuitOpen("fake-a"));

  // real provider exclusion: pollinations is always "configured" (no key needed)
  const before = providersForTask("script").map((p) => p.key);
  check("pollinations usable for script before trip", before.includes("pollinations"), before.join(","));
  recordProviderFailure("pollinations");
  recordProviderFailure("pollinations");
  recordProviderFailure("pollinations");
  const afterTrip = providersForTask("script").map((p) => p.key);
  check("pollinations excluded while circuit open", !afterTrip.includes("pollinations"), afterTrip.join(","));
  const tripStatus = getProviderStatus().find((p) => p.key === "pollinations")?.status;
  check("pollinations status is circuit_open", tripStatus === "circuit_open", String(tripStatus));
  resetProviderCircuit("pollinations");
  check("pollinations usable again after reset", providersForTask("script").map((p) => p.key).includes("pollinations"));
  resetProviderCircuit("fake-a");

  // ---- 2. success resets the count ----
  recordProviderFailure("fake-a");
  recordProviderFailure("fake-a");
  recordProviderSuccess("fake-a");
  recordProviderFailure("fake-a");
  recordProviderFailure("fake-a");
  check("two failures after a success do not trip", !isCircuitOpen("fake-a"));
  resetProviderCircuit("fake-a");

  // ---- 3. failover: first fails, second succeeds ----
  {
    const res = await attemptWithFallback("script", async (p) => {
      if (p.key === "fake-a") return errResult<string>("fake-a", { code: "unavailable", message: "fake-a down", retryable: true });
      return okResult<string>("fake-b", "hello from b");
    }, [fakeProvider("fake-a"), fakeProvider("fake-b")]);
    check("failover returns success", res.ok === true);
    check("failover data from second provider", res.data === "hello from b");
    check("attempted order recorded", res.attempted.join(",") === "fake-a,fake-b", res.attempted.join(","));
    check("first failure recorded", res.failures.length === 1 && res.failures[0].includes("fake-a down"), res.failures.join("|"));
  }
  resetProviderCircuit("fake-a");

  // ---- 4. all fail → typed aggregated error ----
  {
    const res = await attemptWithFallback("script", async (p) =>
      errResult<string>(p.key, { code: "unavailable", message: `${p.key} down`, retryable: p.key === "fake-b" }),
      [fakeProvider("fake-a"), fakeProvider("fake-b")]
    );
    check("all-fail returns ok:false", res.ok === false);
    check("error lists both providers", !!res.error && res.error.message.includes("fake-a") && res.error.message.includes("fake-b"));
    check("error code is unavailable", res.error?.code === "unavailable");
    check("retryable reflects last failure", res.error?.retryable === true);
  }
  resetProviderCircuit("fake-a");
  resetProviderCircuit("fake-b");

  // ---- 5. thrown exception → typed, failover continues ----
  {
    const res = await attemptWithFallback("script", async (p) => {
      if (p.key === "fake-a") throw new Error("boom");
      return okResult<string>("fake-b", "recovered");
    }, [fakeProvider("fake-a"), fakeProvider("fake-b")]);
    check("exception does not crash runner", res.ok === true && res.data === "recovered");
    check("exception recorded as failure", res.failures.length === 1 && res.failures[0].includes("boom"), res.failures.join("|"));
  }
  resetProviderCircuit("fake-a");

  // ---- 6. empty chain → not_configured ----
  {
    const res = await attemptWithFallback("script", async () => okResult<string>("x", "never"), []);
    check("empty chain is not_configured", res.ok === false && res.error?.code === "not_configured");
  }

  // ---- 7. espeak honesty without a binary ----
  {
    const configured = espeakTts.isConfigured();
    console.log(`INFO  espeak binary present on this machine: ${configured}`);
    if (!configured) {
      const r = await espeakTts.synthesize({ text: "namaste" });
      check("espeak without binary → dependency_missing", !r.ok && (r as { error: { code: string } }).error.code === "dependency_missing");
    } else {
      const r = await espeakTts.synthesize({ text: "namaste" });
      check("espeak with binary synthesizes wav", r.ok === true && Buffer.isBuffer(r.data) && r.data.length > 44, r.ok ? `${r.data.length} bytes` : (r as { error: { message: string } }).error.message);
    }
  }

  // ---- 8. pollinations text input validation (no network) ----
  {
    const r = await pollinations.generateText({ prompt: "" } as never);
    check("empty prompt → invalid_input", !r.ok && (r as { error: { code: string } }).error.code === "invalid_input");
  }

  // ---- 9. router chains expose the new fallbacks ----
  {
    const scriptCaps = getProviderStatus().filter((p) => p.capabilities.includes("script")).map((p) => p.key);
    check("script capability includes hf + pollinations", scriptCaps.includes("hf") && scriptCaps.includes("pollinations"), scriptCaps.join(","));
    const ttsCaps = getProviderStatus().filter((p) => p.capabilities.includes("tts")).map((p) => p.key);
    check("tts capability includes edge-tts + hf + espeak", ttsCaps.includes("edge-tts") && ttsCaps.includes("hf") && ttsCaps.includes("espeak"), ttsCaps.join(","));
    check("espeak provider registered", getProviderStatus().some((p) => p.key === "espeak"));
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);

}

main().catch((err) => { console.error("FATAL", err); process.exit(1); });
