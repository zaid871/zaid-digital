"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PipelineOverview } from "@/components/stage-list";

interface ApiEnvelope<T> {
  ok: boolean;
  apiVersion: string;
  requestId: string;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

export default function DashboardPage() {
  const router = useRouter();
  const [productUrl, setProductUrl] = useState("");
  const [durationSeconds, setDurationSeconds] = useState(45);
  const [language, setLanguage] = useState("hinglish");
  const [platform, setPlatform] = useState("instagram_reels");
  const [visualStyle, setVisualStyle] = useState("clean_studio");
  const [scriptStyle, setScriptStyle] = useState("standard");
  const [storyboardChain, setStoryboardChain] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Marketing campaigns — the system analyzes the product and markets
  // it where/when appropriate, pushing toward the target by the deadline.
  const [cmpUrl, setCmpUrl] = useState("");
  const [cmpTitle, setCmpTitle] = useState("");
  const [cmpType, setCmpType] = useState("website");
  const [cmpMetric, setCmpMetric] = useState("views");
  const [cmpTargetValue, setCmpTargetValue] = useState(1000);
  const [cmpDeadlineDays, setCmpDeadlineDays] = useState(30);
  const [cmpHasTarget, setCmpHasTarget] = useState(true);
  const [cmpSubmitting, setCmpSubmitting] = useState(false);
  const [cmpError, setCmpError] = useState<string | null>(null);
  const [cmpResult, setCmpResult] = useState<{ title: string; fit: string } | null>(null);
  const [promoSubmitting, setPromoSubmitting] = useState(false);
  const [campaigns, setCampaigns] = useState<Array<{
    id: string; title: string; url: string; productType: string; status: string;
    posts: number; progress: number | null; lastDecision: string | null;
    target?: { metric: string; value: number; deadlineDays: number; deadlineAt: string };
    pace: { label: string; ratio: number | null; elapsedFrac: number };
    fit: { auto: string[]; manual: string[] };
    salesWarning: string | null;
    daysLeft: number | null;
  }>>([]);

  async function loadCampaigns() {
    try {
      const res = await fetch("/api/v1/marketing/campaigns");
      const json = (await res.json()) as ApiEnvelope<{ campaigns: Array<{
        id: string; title: string; url: string; productType: string; status: string;
        posts: number; progress: number | null; lastDecision: string | null;
        target?: { metric: string; value: number; deadlineDays: number; deadlineAt: string };
        pace: { label: string; ratio: number | null; elapsedFrac: number };
        fit: { auto: string[]; manual: string[] };
        salesWarning: string | null;
        daysLeft: number | null;
      }> }>;
      if (json.ok && json.data) setCampaigns(json.data.campaigns);
    } catch {
      // List is best-effort; starting a campaign still works without it.
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/marketing/campaigns")
      .then((res) => res.json())
      .then((json) => {
        const data = json as ApiEnvelope<{ campaigns: Array<{
          id: string; title: string; url: string; productType: string; status: string;
          posts: number; progress: number | null; lastDecision: string | null;
          target?: { metric: string; value: number; deadlineDays: number; deadlineAt: string };
          pace: { label: string; ratio: number | null; elapsedFrac: number };
          fit: { auto: string[]; manual: string[] };
          salesWarning: string | null;
          daysLeft: number | null;
        }> }>;
        if (!cancelled && data.ok && data.data) setCampaigns(data.data.campaigns);
      })
      .catch(() => {
        // List is best-effort.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleStartCampaign(e: React.FormEvent) {
    e.preventDefault();
    setCmpSubmitting(true);
    setCmpError(null);
    setCmpResult(null);
    try {
      const res = await fetch("/api/v1/marketing/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: cmpUrl,
          title: cmpTitle.trim() || undefined,
          productType: cmpType,
          target: cmpHasTarget
            ? { metric: cmpMetric, value: cmpTargetValue, deadlineDays: cmpDeadlineDays }
            : undefined,
        }),
      });
      const json = (await res.json()) as ApiEnvelope<{
        title: string; fit: { auto: string[]; manual: string[] };
      }>;
      if (!json.ok || !json.data) {
        setCmpError(json.error?.message ?? "Campaign shuru nahi ho payi.");
        return;
      }
      setCmpResult({ title: json.data.title, fit: [...json.data.fit.auto, ...json.data.fit.manual].join(", ") || "reels" });
      setCmpUrl("");
      setCmpTitle("");
      loadCampaigns();
    } catch (err) {
      setCmpError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setCmpSubmitting(false);
    }
  }

  async function handleCampaignAction(id: string, action: "pause" | "resume") {
    try {
      await fetch(`/api/v1/marketing/campaigns/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      loadCampaigns();
    } catch {
      // Pause/resume is best-effort; the list refresh shows the truth.
    }
  }

  // One-off manual override: promote right now, once (the campaign
  // engine decides the rest by itself).
  async function handlePromoteNow() {
    if (!cmpUrl.trim()) {
      setCmpError("Pehle link daalo — phir 'Abhi ek baar promote karo' dabao.");
      return;
    }
    setPromoSubmitting(true);
    setCmpError(null);
    try {
      const res = await fetch("/api/v1/marketing/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: cmpUrl,
          title: cmpTitle.trim() || undefined,
          productType: cmpType,
          publish: true,
        }),
      });
      const json = (await res.json()) as ApiEnvelope<{ status: string; note: string; title: string }>;
      if (!json.ok || !json.data) {
        setCmpError(json.error?.message ?? "Promote nahi ho paya.");
        return;
      }
      setCmpResult({ title: json.data.title, fit: json.data.note });
    } catch (err) {
      setCmpError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setPromoSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productUrl,
          durationSeconds,
          language,
          platform,
          visualStyle,
          scriptStyle,
          storyboardChain,
        }),
      });
      const json = (await res.json()) as ApiEnvelope<{ id: string }>;
      if (!json.ok || !json.data) {
        setError(json.error?.message ?? "Failed to create job.");
        return;
      }
      router.push(`/jobs/${json.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Create a product video</CardTitle>
            <CardDescription>
              Paste a product page URL. The platform researches the product,
              verifies facts, writes a Hinglish script, and renders a 9:16
              vertical MP4 — no price shown, no music, Shariah-compliant.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4">
              <div>
                <Label htmlFor="product-url">Product URL</Label>
                <Input
                  id="product-url"
                  type="url"
                  required
                  placeholder="https://example.com/product/…"
                  value={productUrl}
                  onChange={(e) => setProductUrl(e.target.value)}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <Label htmlFor="duration">Duration (seconds)</Label>
                  <Input
                    id="duration"
                    type="number"
                    min={15}
                    max={180}
                    value={durationSeconds}
                    onChange={(e) => setDurationSeconds(Number(e.target.value))}
                  />
                </div>
                <div>
                  <Label htmlFor="language">Language</Label>
                  <select
                    id="language"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                  >
                    <option value="hinglish">Hinglish</option>
                    <option value="hindi">Hindi</option>
                    <option value="english">English</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="platform">Target platform</Label>
                  <select
                    id="platform"
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                  >
                    <option value="instagram_reels">Instagram Reels</option>
                    <option value="facebook_reels">Facebook Reels</option>
                    <option value="youtube_shorts">YouTube Shorts</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="style">Visual style</Label>
                  <select
                    id="style"
                    value={visualStyle}
                    onChange={(e) => setVisualStyle(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                  >
                    <option value="clean_studio">Clean studio</option>
                    <option value="lifestyle">Lifestyle</option>
                    <option value="minimal_dark">Minimal dark</option>
                    <option value="premium_dark">Premium Dark (cinematic ad look)</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="scriptStyle">Script style</Label>
                  <select
                    id="scriptStyle"
                    value={scriptStyle}
                    onChange={(e) => setScriptStyle(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                  >
                    <option value="standard">Standard</option>
                    <option value="numbered">Numbered (Pehli baat, Dusri baat…)</option>
                    <option value="brand_story">Brand story (Hook → Origin → Twist → Proof → Lesson)</option>
                    <option value="macro_hero">Macro hero (Ingredient → Craft → Hero, pack untouched)</option>
                    <option value="banner_unroll">Banner unroll (Hook → banner rolls down → hold)</option>
                    <option value="attar_luxury">Attar luxury (Hero → Drop → Ritual → serif end card)</option>
                    <option value="wedding_invite">Wedding invite (Names → Functions → Date & Venue → RSVP)</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 pt-7">
                  <input
                    id="storyboardChain"
                    type="checkbox"
                    checked={storyboardChain}
                    onChange={(e) => setStoryboardChain(e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-orange-500"
                  />
                  <Label htmlFor="storyboardChain">Storyboard chain (5 ideas → best → 9-scene storyboard)</Label>
                </div>
              </div>
              {error && (
                <p role="alert" className="text-sm text-red-400">
                  {error}
                </p>
              )}
              <div className="flex items-center gap-3">
                <Button type="submit" size="lg" disabled={submitting}>
                  {submitting ? "Starting…" : "Start generation"}
                </Button>
                <Badge tone="warning">Phase 2 — jobs are stubs, not persisted</Badge>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.08 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Marketing campaign</CardTitle>
            <CardDescription>
              Apna digital product daalo — system khud analyze karke
              decide karega kahan aur kab market kare (sirf fit platforms,
              sirf peak time par). Target do to deadline tak uske liye
              ji-jaan lagayega: peeche hua to zyada platforms, zyada baar.
              Hamesha marketing nahi — sirf jab munasib ho.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleStartCampaign} className="grid gap-4">
              <div>
                <Label htmlFor="cmp-url">Website / product link</Label>
                <Input
                  id="cmp-url"
                  type="url"
                  required
                  placeholder="https://meri-website.com/…"
                  value={cmpUrl}
                  onChange={(e) => setCmpUrl(e.target.value)}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <Label htmlFor="cmp-title">Title (khali ho to site ka naam)</Label>
                  <Input
                    id="cmp-title"
                    type="text"
                    placeholder="Meri dukaan"
                    value={cmpTitle}
                    onChange={(e) => setCmpTitle(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="cmp-type">Type</Label>
                  <select
                    id="cmp-type"
                    value={cmpType}
                    onChange={(e) => setCmpType(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                  >
                    <option value="website">Website</option>
                    <option value="ebook">Ebook</option>
                    <option value="template_pack">Template pack</option>
                    <option value="pod">Print-on-demand</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="cmp-metric">Target (kya chahiye)</Label>
                  <select
                    id="cmp-metric"
                    value={cmpMetric}
                    onChange={(e) => setCmpMetric(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                  >
                    <option value="views">Views</option>
                    <option value="clicks">Clicks</option>
                    <option value="posts">Posts published</option>
                    <option value="sales">Sales (selling layer chahiye)</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="cmp-value">Kam se kam kitna</Label>
                  <Input
                    id="cmp-value"
                    type="number"
                    min={1}
                    value={cmpTargetValue}
                    onChange={(e) => setCmpTargetValue(Number(e.target.value))}
                  />
                </div>
                <div>
                  <Label htmlFor="cmp-days">Kitne din mein</Label>
                  <Input
                    id="cmp-days"
                    type="number"
                    min={1}
                    max={90}
                    value={cmpDeadlineDays}
                    onChange={(e) => setCmpDeadlineDays(Number(e.target.value))}
                  />
                </div>
                <div className="flex items-center gap-2 pt-7">
                  <input
                    id="cmp-has-target"
                    type="checkbox"
                    checked={cmpHasTarget}
                    onChange={(e) => setCmpHasTarget(e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-orange-500"
                  />
                  <Label htmlFor="cmp-has-target">Target set karo (band ho to bina target ke chalega)</Label>
                </div>
              </div>
              {cmpError && (
                <p role="alert" className="text-sm text-red-400">
                  {cmpError}
                </p>
              )}
              {cmpResult && (
                <p role="status" className="text-sm text-green-400">
                  {cmpResult.title} — fit platforms: {cmpResult.fit}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" size="lg" disabled={cmpSubmitting}>
                  {cmpSubmitting ? "Shuru ho raha hai…" : "Campaign shuru karo"}
                </Button>
                <Button
                  type="button"
                  size="lg"
                  disabled={promoSubmitting}
                  onClick={handlePromoteNow}
                >
                  {promoSubmitting ? "Bhej raha hoon…" : "Abhi ek baar promote karo"}
                </Button>
                <Badge tone="warning">Har publish slot (07:30/08:30/19:30/20:30 IST) par system khud decide karega</Badge>
              </div>
            </form>
            {campaigns.length > 0 && (
              <div className="mt-6">
                <p className="mb-2 text-sm font-medium text-zinc-300">Chalti campaigns</p>
                <ul className="grid gap-3">
                  {campaigns.map((c) => (
                    <li key={c.id} className="rounded-lg border border-zinc-800 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium text-zinc-100">
                          {c.title} · {c.productType}
                        </span>
                        <span className="flex items-center gap-2">
                          <Badge tone={c.status === "active" ? "success" : c.status === "paused" ? "warning" : "default"}>
                            {c.status}
                          </Badge>
                          {c.status === "active" && (
                            <button
                              type="button"
                              className="text-xs text-zinc-400 underline"
                              onClick={() => handleCampaignAction(c.id, "pause")}
                            >
                              Pause
                            </button>
                          )}
                          {c.status === "paused" && (
                            <button
                              type="button"
                              className="text-xs text-zinc-400 underline"
                              onClick={() => handleCampaignAction(c.id, "resume")}
                            >
                              Resume
                            </button>
                          )}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-zinc-400">
                        {c.target
                          ? `${c.target.metric}: ${c.progress ?? "—"} / ${c.target.value} · ${c.daysLeft ?? 0} din bache · pace: ${c.pace.label}${c.pace.ratio !== null ? ` (${Math.round(c.pace.ratio * 100)}%)` : ""}`
                          : `Bina target · ${c.posts} post${c.posts === 1 ? "" : "s"}`}
                        {" · "}platforms: {[...c.fit.auto, ...c.fit.manual].join(", ") || "reels"}
                      </p>
                      {c.salesWarning && (
                        <p className="mt-1 text-xs text-yellow-400">{c.salesWarning}</p>
                      )}
                      {c.lastDecision && (
                        <p className="mt-1 text-xs text-zinc-500">Aakhri faisla: {c.lastDecision}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <Card>
        <CardHeader>
          <CardTitle>Generation history</CardTitle>
          <CardDescription>
            Persistent job history lands in Phase 3 with the database.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-500">
            No jobs yet. Submitted jobs will appear here with live stage progress,
            retry controls, and downloadable results.
          </p>
        </CardContent>
      </Card>

      <PipelineOverview />
    </div>
  );
}
