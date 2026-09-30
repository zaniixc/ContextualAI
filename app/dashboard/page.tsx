"use client";

import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { usePrototype } from "@/lib/prototype-context";
import {
  SUBJECTS,
  getTasksForSubject,
  ASSISTANCE_MODES,
} from "@/lib/study-data";
import { parseAcademicDocument } from "@/lib/document-parser";
import type { Subject, PreloadedTask, CustomDocument } from "@/lib/types";
import { useRef, useState } from "react";
import {
  BookOpen,
  Upload,
  ChevronRight,
  FileText,
  AlertCircle,
  GraduationCap,
  Lightbulb,
  Compass,
  ClipboardCheck,
  MessageSquare,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";

export default function DashboardPage() {
  const router = useRouter();
  const {
    selectedSubject,
    setSelectedSubject,
    selectedTask,
    setSelectedTask,
    customDocument,
    setCustomDocument,
    assistanceMode,
    setAssistanceMode,
    settings,
  } = usePrototype();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [editableText, setEditableText] = useState("");

  const tasks =
    selectedSubject && selectedSubject.id !== "custom"
      ? getTasksForSubject(selectedSubject.id)
      : [];

  const handleSubjectSelect = (s: Subject) => {
    setSelectedSubject(s);
    setSelectedTask(null);
    setCustomDocument(null);
    setUploadError(null);
    setEditableText("");
  };

  const handleTaskSelect = (t: PreloadedTask) => {
    setSelectedTask(t);
    setCustomDocument(null);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setIsUploading(true);

    try {
      const parsed = await parseAcademicDocument(file);
      if (!parsed.text || parsed.text.trim().length < 10) {
        setUploadError(
          "We could not reliably read this file. You may paste the relevant content manually.",
        );
        setCustomDocument({
          fileName: file.name,
          fileType: file.name.split(".").pop() || "unknown",
          extractedText: "",
          parseStatus: "failed",
        });
        setEditableText("");
      } else {
        const doc: CustomDocument = {
          fileName: file.name,
          fileType: file.name.split(".").pop() || "unknown",
          extractedText: parsed.text,
          parseStatus: "readable",
        };
        setCustomDocument(doc);
        setEditableText(parsed.text);
      }
    } catch {
      setUploadError(
        "We could not reliably read this file. You may paste the relevant content manually.",
      );
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleEditableTextChange = (text: string) => {
    setEditableText(text);
    if (customDocument) {
      setCustomDocument({
        ...customDocument,
        extractedText: text,
        parseStatus: text.trim().length > 10 ? "readable" : "failed",
      });
    }
  };

  const canProceed =
    selectedSubject &&
    (selectedTask ||
      (selectedSubject.id === "custom" && customDocument?.extractedText));

  const modeIcons = {
    explain: Lightbulb,
    guide: Compass,
    review: ClipboardCheck,
  };

  const statusColor =
    settings.serviceMode === "primary" || settings.serviceMode === "nvidia"
      ? "bg-green-500"
      : settings.serviceMode === "local"
        ? "bg-red-500"
        : "bg-yellow-500";

  const statusLabel =
    settings.serviceMode === "primary"
      ? "Live AI (Gemini / NVIDIA)"
      : settings.serviceMode === "nvidia"
        ? "Live AI (NVIDIA DeepSeek)"
        : settings.serviceMode === "local"
          ? "Local Fallback"
          : "Backup AI";

  return (
    <AppShell>
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            StudyFlow Dashboard
          </h1>
          <p className="text-muted mt-1">
            Select a subject and task, then open the contextual chat to receive
            guided academic assistance.
          </p>
        </div>

        {/* Workflow Steps */}
        <div className="flex items-center gap-2 flex-wrap text-xs text-muted">
          {[
            "Select Subject",
            "Select Task",
            "View Instructions",
            "Open Chat",
            "Receive Guidance",
            "Review Questions",
            "Add Comments",
            "Continue",
          ].map((step, i) => (
            <span key={step} className="flex items-center gap-1">
              {i > 0 && <ArrowRight className="w-3 h-3 text-muted/50" />}
              <span className="bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                {step}
              </span>
            </span>
          ))}
        </div>

        {/* Service Status */}
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className={`w-2.5 h-2.5 rounded-full ${statusColor}`} />
          <span>AI Service: {statusLabel}</span>
          <span className="text-xs">— Gemini 3.8 Flash</span>
        </div>

        {/* Step 1: Subject Selector */}
        <section>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-primary" />
            Step 1: Select Subject
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SUBJECTS.map((s) => {
              const isSelected = selectedSubject?.id === s.id;
              const isCustom = s.id === "custom";
              return (
                <button
                  key={s.id}
                  onClick={() => handleSubjectSelect(s)}
                  className={`flex items-center gap-3 p-4 rounded-xl border text-left transition-all ${
                    isSelected
                      ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                      : "border-card-border bg-card-bg hover:border-primary/40"
                  }`}
                >
                  {isCustom ? (
                    <Upload className="w-5 h-5 text-muted" />
                  ) : (
                    <BookOpen className="w-5 h-5 text-primary" />
                  )}
                  <span className="font-medium text-sm">{s.name}</span>
                  {isSelected && (
                    <CheckCircle2 className="w-4 h-4 text-primary ml-auto" />
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Step 2: Task Selector or Custom Upload */}
        {selectedSubject && selectedSubject.id !== "custom" && (
          <section>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Step 2: Select Task
            </h2>
            {tasks.length === 0 ? (
              <p className="text-muted text-sm">
                No preloaded tasks for this subject.
              </p>
            ) : (
              <div className="space-y-3">
                {tasks.map((t) => {
                  const isSelected = selectedTask?.id === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => handleTaskSelect(t)}
                      className={`w-full flex items-start gap-3 p-4 rounded-xl border text-left transition-all ${
                        isSelected
                          ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                          : "border-card-border bg-card-bg hover:border-primary/40"
                      }`}
                    >
                      <FileText className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{t.title}</p>
                        <p className="text-xs text-muted mt-1 line-clamp-2">
                          {t.instructions.split("\n")[0]}
                        </p>
                      </div>
                      {isSelected && (
                        <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Custom Upload */}
        {selectedSubject?.id === "custom" && (
          <section>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Upload className="w-5 h-5 text-primary" />
              Step 2: Upload Academic Material
            </h2>

            <div className="border-2 border-dashed border-card-border rounded-xl p-6 text-center bg-card-bg">
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.docx,.pdf"
                onChange={handleFileUpload}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="cursor-pointer flex flex-col items-center gap-2"
              >
                <Upload className="w-8 h-8 text-muted" />
                <span className="text-sm font-medium">
                  {isUploading
                    ? "Processing..."
                    : "Click to upload .txt, .docx, or .pdf"}
                </span>
                <span className="text-xs text-muted">
                  The chatbot will use this content as the current discussion
                  context.
                </span>
              </label>
            </div>

            {uploadError && (
              <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700 dark:text-red-300">
                  {uploadError}
                </p>
              </div>
            )}

            {customDocument && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="w-4 h-4 text-primary" />
                  <span className="font-medium">{customDocument.fileName}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      customDocument.parseStatus === "readable"
                        ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                        : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300"
                    }`}
                  >
                    {customDocument.parseStatus === "readable"
                      ? "Readable"
                      : "Needs manual input"}
                  </span>
                </div>

                {customDocument.parseStatus === "readable" && (
                  <p className="text-xs text-muted">
                    Document loaded successfully. This confirms that the text
                    can be read; it does not confirm that the content is correct
                    or complete.
                  </p>
                )}

                <div>
                  <label className="text-xs font-medium text-muted block mb-1">
                    Extracted text (editable):
                  </label>
                  <textarea
                    value={editableText}
                    onChange={(e) => handleEditableTextChange(e.target.value)}
                    rows={8}
                    className="w-full rounded-lg border border-card-border bg-gray-50 dark:bg-gray-900 p-3 text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
                    placeholder="Paste or edit the document content here..."
                  />
                </div>
              </div>
            )}

            {/* Manual paste fallback */}
            {!customDocument && (
              <div className="mt-4">
                <label className="text-xs font-medium text-muted block mb-1">
                  Or paste content manually:
                </label>
                <textarea
                  value={editableText}
                  onChange={(e) => {
                    setEditableText(e.target.value);
                    if (e.target.value.trim().length > 10) {
                      setCustomDocument({
                        fileName: "Manual Input",
                        fileType: "text",
                        extractedText: e.target.value,
                        parseStatus: "readable",
                      });
                    }
                  }}
                  rows={6}
                  className="w-full rounded-lg border border-card-border bg-gray-50 dark:bg-gray-900 p-3 text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
                  placeholder="Paste your academic material here..."
                />
              </div>
            )}
          </section>
        )}

        {/* Step 3: Assistance Mode */}
        {canProceed && (
          <section>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-primary" />
              Step 3: Assistance Mode
            </h2>
            <div className="flex flex-wrap gap-2">
              {ASSISTANCE_MODES.map((m) => {
                const Icon = modeIcons[m.id];
                const isActive = assistanceMode === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setAssistanceMode(m.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                      isActive
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-card-border bg-card-bg text-muted hover:border-primary/40"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {m.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted mt-2">
              {
                ASSISTANCE_MODES.find((m) => m.id === assistanceMode)
                  ?.description
              }
            </p>
          </section>
        )}

        {/* Actions */}
        {canProceed && (
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => router.push("/task")}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-card-border bg-card-bg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <FileText className="w-4 h-4" />
              View Task Details
            </button>
            <button
              onClick={() => router.push("/task/chat")}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-dark transition-colors"
            >
              <MessageSquare className="w-4 h-4" />
              Open Chat
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
