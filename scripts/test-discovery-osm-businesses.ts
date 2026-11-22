/** Tests for src/lib/discovery/osm-businesses.ts (Overpass API, stubbed fetch). */
import { searchOsmBusinesses, type FetchFn } from "../src/lib/discovery/osm-businesses";

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

const OSM_OK = {
  elements: [
    {
      type: "node", id: 1, lat: 52.52, lon: 13.405,
      tags: { amenity: "dentist", name: "Zahnarzt Berlin", website: "https://zahn.example", phone: "+49 30 1", "addr:street": "Hauptstr.", "addr:housenumber": "5", "addr:city": "Berlin" },
    },
    {
      type: "way", id: 2, center: { lat: 52.53, lon: 13.41 },
      tags: { amenity: "dentist", name: "Dental Plus", "contact:website": "https://dental.example" },
    },
    { type: "node", id: 3, lat: 52.5, lon: 13.4, tags: { amenity: "dentist" } }, // no name -> dropped
  ],
};

function stubFetch(body: unknown, ok = true, status = 200, capture?: { url?: string; init?: unknown }): FetchFn {
  return (async (url: unknown, init?: unknown) => {
    if (capture) {
      capture.url = String(url);
      capture.init = init;
    }
    return { ok, status, json: async () => body } as unknown as Response;
  }) as unknown as FetchFn;
}

async function main() {
  // happy path
  const capture: { url?: string; init?: unknown } = {};
  const r = await searchOsmBusinesses({ category: "dentist", bbox: [52.5, 13.3, 52.55, 13.45] }, stubFetch(OSM_OK, true, 200, capture));
  check("osm returns 2 named leads", r.leads.length === 2, `got ${r.leads.length}`);
  check("osm maps name + website + phone + address", r.leads[0].title === "Zahnarzt Berlin" && r.leads[0].website === "https://zahn.example" && r.leads[0].phone === "+49 30 1" && r.leads[0].address.includes("Hauptstr."));
  check("osm maps center coords for ways", r.leads[1].latitude === 52.53 && r.leads[1].longitude === 13.41);
  check("osm source is osm", r.leads.every((l) => l.source === "osm"));
  check("osm category from amenity tag", r.leads[0].category === "dentist");
  check("osm posts to overpass", capture.url === "https://overpass-api.de/api/interpreter");
  check("osm query uses dentist tags", typeof (capture.init as { body?: string })?.body === "string" && ((capture.init as { body: string }).body.includes("dentist") || (capture.init as { body: string }).body.includes("amenity")));

  // failures never throw, always report the gap
  const http500 = await searchOsmBusinesses({ category: "dentist", bbox: [0, 0, 1, 1] }, stubFetch({}, false, 500));
  check("http 500 -> empty + error", http500.leads.length === 0 && !!http500.error);
  const throwing: FetchFn = (async () => { throw new Error("boom"); }) as unknown as FetchFn;
  const netFail = await searchOsmBusinesses({ category: "dentist", bbox: [0, 0, 1, 1] }, throwing);
  check("fetch throw -> empty + error", netFail.leads.length === 0 && !!netFail.error);
  const badJson: FetchFn = (async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad"); } }) as unknown as Response) as unknown as FetchFn;
  const bad = await searchOsmBusinesses({ category: "dentist", bbox: [0, 0, 1, 1] }, badJson);
  check("invalid json -> empty + error", bad.leads.length === 0 && !!bad.error);
  const empty = await searchOsmBusinesses({ category: "dentist", bbox: [0, 0, 1, 1] }, stubFetch({ elements: [] }));
  check("no businesses -> empty + honest coverage error", empty.leads.length === 0 && !!empty.error && empty.error.includes("coverage"));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
