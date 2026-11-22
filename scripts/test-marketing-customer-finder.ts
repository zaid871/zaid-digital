/** Tests for src/lib/marketing/customer-finder.ts (ported scoring + prospect model). */
import {
  scoreProspect,
  applyScoreCaps,
  prospectId,
  publicUrl,
  canonicalUrl,
  normalizeBusinessLead,
  BUYING_SIGNALS,
  signalById,
  matchCohort,
  emptyHistory,
  applyFeedback,
  recordOutcome,
  excludeSeen,
  unseenProspects,
  prospectsToCsv,
  PROSPECT_CSV_HEADERS,
  type CustomerProspect,
  type ProspectScores,
} from "../src/lib/marketing/customer-finder";

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

function prospect(over: Partial<CustomerProspect> = {}): CustomerProspect {
  const scores: ProspectScores = { painStrength: 4, productFit: 4, timing: 4, reachability: 4, evidenceQuality: 4 };
  return {
    id: "p-test",
    productSlug: "wedding-invite",
    entityName: "Acme Events",
    entityUrl: "https://acme-events.com",
    stage: "problem_aware",
    scores,
    total: 80,
    band: "strong",
    evidence: [],
    warmPath: null,
    draft: null,
    feedback: null,
    feedbackReason: null,
    status: "new",
    createdAt: "2026-11-16T00:00:00.000Z",
    updatedAt: "2026-11-16T00:00:00.000Z",
    ...over,
  };
}

// --- scoring ---
check("all 5s -> 100 strong", (() => { const r = scoreProspect({ painStrength: 5, productFit: 5, timing: 5, reachability: 5, evidenceQuality: 5 }); return r.total === 100 && r.band === "strong"; })());
check("all 0s -> 0 exclude", (() => { const r = scoreProspect({ painStrength: 0, productFit: 0, timing: 0, reachability: 0, evidenceQuality: 0 }); return r.total === 0 && r.band === "exclude"; })());
check("4/4/3/4/4 -> 76 promising", (() => { const r = scoreProspect({ painStrength: 4, productFit: 4, timing: 3, reachability: 4, evidenceQuality: 4 }); return r.total === 76 && r.band === "promising"; })());
check("band edge 80 -> strong", scoreProspect({ painStrength: 4, productFit: 4, timing: 4, reachability: 4, evidenceQuality: 4 }).band === "strong");
check("band edge 65 -> promising", scoreProspect({ painStrength: 3, productFit: 4, timing: 3, reachability: 3, evidenceQuality: 3 }).band === "promising");
check("band edge 50 -> plausible", scoreProspect({ painStrength: 3, productFit: 3, timing: 2, reachability: 2, evidenceQuality: 2 }).band === "plausible");
check("40 -> exclude", scoreProspect({ painStrength: 2, productFit: 2, timing: 2, reachability: 2, evidenceQuality: 2 }).band === "exclude");
check("scores clamp above 5", scoreProspect({ painStrength: 9, productFit: 5, timing: 5, reachability: 5, evidenceQuality: 5 }).total === 100);

// --- caps ---
check("unknown date caps timing at 2", applyScoreCaps({ painStrength: 5, productFit: 5, timing: 5, reachability: 5, evidenceQuality: 5 }, { signalDateKnown: false, contactRouteVerified: true }).timing === 2);
check("no route caps reachability at 1", applyScoreCaps({ painStrength: 5, productFit: 5, timing: 5, reachability: 5, evidenceQuality: 5 }, { signalDateKnown: true, contactRouteVerified: false }).reachability === 1);
check("known + verified leaves scores alone", (() => { const s = { painStrength: 5, productFit: 5, timing: 5, reachability: 5, evidenceQuality: 5 }; const c = applyScoreCaps(s, { signalDateKnown: true, contactRouteVerified: true }); return c.timing === 5 && c.reachability === 5; })());

// --- ids + urls ---
check("prospectId stable", prospectId("wedding-invite", "https://acme-events.com") === prospectId("wedding-invite", "https://acme-events.com"));
check("prospectId differs per entity", prospectId("wedding-invite", "https://a.com") !== prospectId("wedding-invite", "https://b.com"));
check("prospectId differs per product", prospectId("a", "https://x.com") !== prospectId("b", "https://x.com"));
check("canonical strips www + utm", canonicalUrl("https://www.acme.com/page?utm_source=x&y=1") === "https://acme.com/page?y=1");
check("canonical maps twitter to x", canonicalUrl("https://twitter.com/acme") === "https://x.com/acme");
check("canonical drops default port", canonicalUrl("https://acme.com:443/a") === "https://acme.com/a");
check("publicUrl rejects ftp", (() => { try { publicUrl("ftp://a.com"); return false; } catch { return true; } })());
check("publicUrl rejects credentials", (() => { try { publicUrl("https://user:pass@a.com"); return false; } catch { return true; } })());
check("publicUrl rejects empty", (() => { try { publicUrl(""); return false; } catch { return true; } })());

// --- business lead (gosom Entry) ---
check("normalize accepts legacy longtitude", normalizeBusinessLead({ title: "D", latitude: 1, longtitude: 2 }).longitude === 2);
check("normalize prefers longitude", normalizeBusinessLead({ title: "D", latitude: 1, longitude: 3, longtitude: 2 }).longitude === 3);
check("normalize defaults missing fields", (() => { const l = normalizeBusinessLead({ title: "D" }); return l.reviewCount === 0 && l.source === "maps" && l.category === ""; })());
check("normalize keeps categories", normalizeBusinessLead({ title: "D", categories: ["Dentist"], category: "Dentist" }).categories[0] === "Dentist");

// --- signals ---
check("all buying signals are free", BUYING_SIGNALS.every((s) => s.cost === "free"));
check("26 signals in catalog", BUYING_SIGNALS.length === 26, `got ${BUYING_SIGNALS.length}`);
check("signalById finds NO_WEBSITE", signalById("NO_WEBSITE")?.group === "discovery");
check("signalById misses unknown", signalById("NOPE") === undefined);

// --- cohort ---
const scored = { lead: normalizeBusinessLead({ title: "D" }), signals: ["NO_WEBSITE", "RUNNING_GOOGLE_ADS"], numeric: { REVIEW_RATING: 4.0, REVIEW_COUNT: 12 } };
check("cohort match happy path", matchCohort(scored, { mustHave: ["NO_WEBSITE"], mustNotHave: ["NO_ONLINE_BOOKING"], ranges: { REVIEW_RATING: { min: 3, max: 4.5 } } }));
check("cohort fails missing mustHave", !matchCohort(scored, { mustHave: ["BLOG_STALE"], mustNotHave: [], ranges: {} }));
check("cohort fails present mustNotHave", !matchCohort(scored, { mustHave: [], mustNotHave: ["RUNNING_GOOGLE_ADS"], ranges: {} }));
check("cohort fails range out", !matchCohort(scored, { mustHave: [], mustNotHave: [], ranges: { REVIEW_RATING: { min: 4.5 } } }));
check("cohort fails missing numeric", !matchCohort(scored, { mustHave: [], mustNotHave: [], ranges: { OPEN_ROLES: { min: 1 } } }));

// --- history + feedback ---
{
  const h = emptyHistory("wedding-invite");
  const p = prospect();
  h.prospects[p.id] = p;
  const h2 = applyFeedback(h, p.id, "reject", "enterprise, not a fit");
  check("feedback saved with reason", h2.prospects[p.id].feedback === "reject" && h2.prospects[p.id].feedbackReason === "enterprise, not a fit");
  const h3 = recordOutcome(h2, p.id, "contacted");
  check("outcome recorded", h3.prospects[p.id].status === "contacted");
  check("unseen excludes rejected/contacted", unseenProspects(h3).length === 0);
  const h4 = emptyHistory("wedding-invite");
  const fresh = prospect({ id: "p-fresh" });
  h4.prospects[fresh.id] = fresh;
  check("unseen keeps fresh new prospects", unseenProspects(h4).length === 1);
  const cands = [{ entityUrl: "https://www.acme-events.com/?utm_source=x" }, { entityUrl: "https://other.com" }];
  check("excludeSeen dedups canonical urls", excludeSeen(cands, h4).length === 1);
}

// --- csv ---
{
  const p = prospect({ draft: { targetRole: "Owner", roleBasis: "observed", contactRoute: "https://acme-events.com/contact", nextStep: "Send walkthrough", cta: "Should I send it?", opener: "Hi", caution: "" } });
  const csv = prospectsToCsv([p]);
  check("csv has headers", csv.startsWith(PROSPECT_CSV_HEADERS.join(",")));
  check("csv has one row", csv.split("\n").length === 2);
  const evil = prospect({ id: "p-evil", entityName: "=2+5", draft: { targetRole: "x", roleBasis: "observed", contactRoute: null, nextStep: "@cmd", cta: "ok", opener: "hi", caution: "" } });
  const row = prospectsToCsv([evil]).split("\n")[1];
  check("csv escapes formula cells", row.includes("'=2+5") && row.includes("'@cmd"), row);
  const quoted = prospect({ id: "p-q", entityName: 'Acme, "Events"' });
  check("csv quotes commas and quotes", prospectsToCsv([quoted]).includes('"Acme, ""Events"""'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
