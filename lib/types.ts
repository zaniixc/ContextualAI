/* StudyFlow — Simplified Thesis-Defense Prototype Types */

export type AssistanceMode = "explain" | "guide" | "review";

export type ServiceSource =
  | "gemini-live"
  | "gemini-backup"
  | "nvidia-live"
  | "local-fallback";

export type ServiceMode =
  | "primary"
  | "nvidia"
  | "fallback-1"
  | "fallback-2"
  | "local";

export type ResponseStatus =
  | "needs_clarification"
  | "document_overview"
  | "guided_help"
  | "answer_review"
  | "checklist";

/* ── Subject & Task ── */

export interface Subject {
  id: string;
  name: string;
}

export interface PreloadedTask {
  id: string;
  subjectId: string;
  title: string;
  instructions: string;
  content: string;
}

export interface CustomDocument {
  fileName: string;
  fileType: string;
  extractedText: string;
  parseStatus: "readable" | "simulated" | "failed";
}

/* ── Probing Questions ── */

export interface ProbingQuestion {
  question: string;
  reason: string;
}

export interface ProbingQuestionComment {
  question: string;
  comment: string;
}

/* ── Document Evidence ── */

export interface DocumentEvidenceItem {
  location: string;
  excerptOrSummary: string;
  whyItMatters: string;
}

/* ── AI Response ── */

export interface GeminiResponse {
  status: ResponseStatus;
  directResponse: string;
  documentEvidence?: DocumentEvidenceItem[];
  keyPoints: string[];
  probingQuestions: ProbingQuestion[];
  suggestedNextActions: string[];
  missingInformation?: string[];
  requiresStudentAnswer: boolean;
  requiresReview: boolean;
}

/* ── Chat Message ── */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  assistanceMode?: AssistanceMode;
  responseData?: GeminiResponse;
  source?: ServiceSource;
  probingQuestionComments?: ProbingQuestionComment[];
}

/* ── Chat Request ── */

export interface ChatRequest {
  subject: Subject;
  task: PreloadedTask | null;
  customDocument: CustomDocument | null;
  studentAnswer: string | null;
  userMessage: string;
  assistanceMode: AssistanceMode;
  previousResponse: {
    directResponse: string;
    probingQuestions: ProbingQuestion[];
  } | null;
  probingQuestionComments: ProbingQuestionComment[];
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
}

/* ── Prototype Settings ── */

export interface PrototypeSettings {
  serviceMode: ServiceMode;
  showReviewCheckpoint: boolean;
}
