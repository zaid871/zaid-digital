/**
 * The 15 canonical pipeline stages every job moves through.
 * Progress shown in the UI must come from persisted job-stage rows,
 * never from hardcoded animations — these constants are the source of truth.
 */

export const JOB_STAGES = [
  { key: "url_validation", label: "URL validation", order: 1 },
  { key: "product_extraction", label: "Product extraction", order: 2 },
  { key: "product_research", label: "Product research", order: 3 },
  { key: "fact_verification", label: "Fact verification", order: 4 },
  { key: "media_analysis", label: "Media analysis", order: 5 },
  { key: "compliance_review", label: "Compliance review", order: 6 },
  { key: "creative_planning", label: "Creative planning", order: 7 },
  { key: "script_generation", label: "Script generation", order: 8 },
  { key: "voiceover_generation", label: "Voiceover generation", order: 9 },
  { key: "storyboard_generation", label: "Storyboard generation", order: 10 },
  { key: "ai_visual_generation", label: "AI visual generation", order: 11 },
  { key: "ai_video_generation", label: "AI video generation", order: 12 },
  { key: "editing_rendering", label: "Editing and rendering", order: 13 },
  { key: "quality_assurance", label: "Quality assurance", order: 14 },
  { key: "final_delivery", label: "Final delivery", order: 15 },
] as const;

export type JobStageKey = (typeof JOB_STAGES)[number]["key"];

export type JobStatus =
  | "QUEUED"
  | "RESEARCHING"
  | "PLANNING"
  | "GENERATING_ASSETS"
  | "RENDERING"
  | "QA"
  | "COMPLETED"
  | "WAITING_FOR_REVIEW"
  | "RETRYING"
  | "CANCEL_REQUESTED"
  | "CANCELLED"
  | "FAILED";

export const JOB_STATUSES: JobStatus[] = [
  "QUEUED",
  "RESEARCHING",
  "PLANNING",
  "GENERATING_ASSETS",
  "RENDERING",
  "QA",
  "COMPLETED",
  "WAITING_FOR_REVIEW",
  "RETRYING",
  "CANCEL_REQUESTED",
  "CANCELLED",
  "FAILED",
];

/** Allowed transitions for job state machine (persisted in DB). */
export const JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  QUEUED: ["RESEARCHING", "CANCEL_REQUESTED", "CANCELLED", "FAILED"],
  RESEARCHING: [
    "PLANNING",
    "WAITING_FOR_REVIEW",
    "RETRYING",
    "CANCEL_REQUESTED",
    "FAILED",
  ],
  PLANNING: [
    "GENERATING_ASSETS",
    "WAITING_FOR_REVIEW",
    "RETRYING",
    "CANCEL_REQUESTED",
    "FAILED",
  ],
  GENERATING_ASSETS: [
    "RENDERING",
    "WAITING_FOR_REVIEW",
    "RETRYING",
    "CANCEL_REQUESTED",
    "FAILED",
  ],
  RENDERING: ["QA", "RETRYING", "CANCEL_REQUESTED", "FAILED"],
  QA: [
    "COMPLETED",
    "WAITING_FOR_REVIEW",
    "RETRYING",
    "CANCEL_REQUESTED",
    "FAILED",
  ],
  WAITING_FOR_REVIEW: ["RESEARCHING", "PLANNING", "GENERATING_ASSETS", "CANCELLED", "FAILED"],
  RETRYING: ["RESEARCHING", "PLANNING", "GENERATING_ASSETS", "RENDERING", "QA", "FAILED"],
  CANCEL_REQUESTED: ["CANCELLED", "FAILED"],
  CANCELLED: [],
  COMPLETED: [],
  FAILED: ["RETRYING"],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from]?.includes(to) ?? false;
}
