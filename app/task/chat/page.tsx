"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { usePrototype } from "@/lib/prototype-context";
import { SUGGESTED_PROMPTS, ASSISTANCE_MODES } from "@/lib/study-data";
import { generateId } from "@/lib/utils";
import type {
  ChatMessage,
  GeminiResponse,
  ProbingQuestionComment,
  AssistanceMode,
} from "@/lib/types";
import {
  Send,
  ChevronLeft,
  AlertTriangle,
  Lightbulb,
  Compass,
  ClipboardCheck,
  Loader2,
  MessageSquare,
  HelpCircle,
  Plus,
  Pencil,
  Trash2,
  ChevronRight,
  X,
  Eye,
  FileText,
} from "lucide-react";

/* ── Page ── */

export default function ChatPage() {
  const router = useRouter();
  const {
    selectedSubject,
    selectedTask,
    customDocument,
    studentAnswer,
    assistanceMode,
    setAssistanceMode,
    settings,
  } = usePrototype();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Probing question comment state */
  const [comments, setComments] = useState<Record<string, string>>({});
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [draftComment, setDraftComment] = useState("");

  /* Context review panel */
  const [showContextReview, setShowContextReview] = useState(false);

  /* Last AI response for context chaining */
  const [lastResponse, setLastResponse] = useState<GeminiResponse | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Guard: no subject selected
  if (!selectedSubject) {
    return (
      <AppShell>
        <div className="text-center py-16">
          <AlertTriangle className="w-8 h-8 text-warning mx-auto mb-3" />
          <p className="text-muted mb-4">
            No subject selected. Please start from the dashboard.
          </p>
          <button
            onClick={() => router.push("/dashboard")}
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium"
          >
            Go to Dashboard
          </button>
        </div>
      </AppShell>
    );
  }

  const taskTitle =
    selectedTask?.title || customDocument?.fileName || "Custom Material";

  // Scroll to bottom on new messages
  /* eslint-disable-next-line react-hooks/rules-of-hooks */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  /* ── Send message to API ── */
  /* eslint-disable-next-line react-hooks/rules-of-hooks */
  const sendMessage = useCallback(
    async (
      messageText: string,
      probingComments: ProbingQuestionComment[] = [],
    ) => {
      if (!messageText.trim() && probingComments.length === 0) return;

      setIsLoading(true);
      setError(null);

      // Add user message to chat
      const userMsg: ChatMessage = {
        id: generateId(),
        role: "user",
        content: messageText.trim() || "Continue with my comments.",
        timestamp: new Date().toISOString(),
        assistanceMode,
        probingQuestionComments:
          probingComments.length > 0 ? probingComments : undefined,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");

      // Build conversation history (last 6 messages)
      const recentHistory = messages
        .filter((m) => m.role !== "system")
        .slice(-6)
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content:
            m.role === "assistant" && m.responseData
              ? m.responseData.directResponse
              : m.content,
        }));

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        const requestBody = {
          subject: selectedSubject,
          task: selectedTask || null,
          customDocument: customDocument || null,
          studentAnswer: studentAnswer.trim() || null,
          userMessage: messageText.trim(),
          assistanceMode,
          previousResponse: lastResponse
            ? {
                directResponse: lastResponse.directResponse,
                probingQuestions: lastResponse.probingQuestions,
              }
            : null,
          probingQuestionComments: probingComments,
          conversationHistory: recentHistory,
          forceMode:
            settings.serviceMode !== "primary"
              ? settings.serviceMode
              : undefined,
        };

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to get response");
        }

        const responseData: GeminiResponse = data.data;
        const source = data.source || "gemini-live";

        const assistantMsg: ChatMessage = {
          id: generateId(),
          role: "assistant",
          content: responseData.directResponse,
          timestamp: new Date().toISOString(),
          assistanceMode,
          responseData,
          source,
        };

        setMessages((prev) => [...prev, assistantMsg]);
        setLastResponse(responseData);
        setComments({}); // Reset comments for new probing questions
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        const errMsg =
          err instanceof Error
            ? err.name === "AbortError"
              ? "Request timed out. Please try again or switch to Local Fallback in Controls."
              : err.message
            : "Something went wrong.";
        setError(errMsg);
      } finally {
        setIsLoading(false);
      }
    },
    [
      messages,
      selectedSubject,
      selectedTask,
      customDocument,
      studentAnswer,
      assistanceMode,
      lastResponse,
      settings.serviceMode,
    ],
  );

  /* ── Comment helpers ── */
  const addComment = (question: string) => {
    if (!draftComment.trim()) return;
    setComments((prev) => ({ ...prev, [question]: draftComment.trim() }));
    setEditingComment(null);
    setDraftComment("");
  };

  const removeComment = (question: string) => {
    setComments((prev) => {
      const next = { ...prev };
      delete next[question];
      return next;
    });
  };

  const commentedQuestions: ProbingQuestionComment[] = Object.entries(
    comments,
  ).map(([question, comment]) => ({ question, comment }));

  /* ── Continue with comments ── */
  const handleContinueWithComments = () => {
    setShowContextReview(true);
  };

  const confirmContinue = () => {
    setShowContextReview(false);
    sendMessage("Continue with my comments.", commentedQuestions);
  };

  /* ── Handle form submit ── */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage(input);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim()) sendMessage(input);
    }
  };

  const modeIcons: Record<AssistanceMode, React.ElementType> = {
    explain: Lightbulb,
    guide: Compass,
    review: ClipboardCheck,
  };

  const prompts = SUGGESTED_PROMPTS[assistanceMode] || [];

  return (
    <AppShell>
      <div className="flex flex-col h-[calc(100vh-8rem)]">
        {/* Chat Header */}
        <div className="flex items-center justify-between border-b border-card-border pb-3 mb-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => router.push("/task")}
              className="text-muted hover:text-foreground shrink-0"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <p className="text-xs text-primary font-medium">
                {selectedSubject.name}
              </p>
              <p className="text-sm font-semibold truncate">{taskTitle}</p>
            </div>
          </div>

          {/* Mode selector */}
          <div className="flex items-center gap-1">
            {ASSISTANCE_MODES.map((m) => {
              const Icon = modeIcons[m.id];
              return (
                <button
                  key={m.id}
                  onClick={() => setAssistanceMode(m.id)}
                  title={m.description}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    assistanceMode === m.id
                      ? "bg-primary/10 text-primary"
                      : "text-muted hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {messages.length === 0 && (
            <div className="text-center py-12 space-y-4">
              <MessageSquare className="w-10 h-10 text-muted/30 mx-auto" />
              <p className="text-muted text-sm">
                Start the conversation. Select a suggested prompt or type your
                message.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {prompts.map((p) => (
                  <button
                    key={p}
                    onClick={() => sendMessage(p)}
                    className="px-3 py-1.5 rounded-full border border-card-border bg-card-bg text-xs text-muted hover:border-primary/40 hover:text-foreground transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`animate-slide-up ${
                msg.role === "user" ? "flex justify-end" : ""
              }`}
            >
              {msg.role === "user" ? (
                /* User bubble */
                <div className="max-w-[80%] bg-primary text-white rounded-2xl rounded-br-md px-4 py-3">
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  {msg.probingQuestionComments &&
                    msg.probingQuestionComments.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-white/20 space-y-1">
                        <p className="text-xs font-medium opacity-80">
                          Comments attached:
                        </p>
                        {msg.probingQuestionComments.map((c, i) => (
                          <p key={i} className="text-xs opacity-70">
                            Q: {c.question.substring(0, 50)}...
                            <br />
                            A: {c.comment}
                          </p>
                        ))}
                      </div>
                    )}
                </div>
              ) : (
                /* Assistant response */
                <div className="space-y-3">
                  {/* Source badge */}
                  {msg.source && (
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          msg.source === "gemini-live" || msg.source === "nvidia-live"
                            ? "bg-green-500"
                            : msg.source === "gemini-backup"
                              ? "bg-yellow-500"
                              : "bg-blue-500"
                        }`}
                      />
                      <span>
                        {msg.source === "gemini-live"
                          ? "Live AI (Gemini)"
                          : msg.source === "nvidia-live"
                            ? "Live AI (NVIDIA DeepSeek)"
                            : msg.source === "gemini-backup"
                              ? "Backup AI"
                              : "Local Fallback"}
                      </span>
                    </div>
                  )}

                  {/* Main response */}
                  <div className="bg-card-bg border border-card-border rounded-xl p-4">
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">
                      {msg.responseData?.directResponse || msg.content}
                    </p>
                  </div>

                  {/* Key Points */}
                  {msg.responseData?.keyPoints &&
                    msg.responseData.keyPoints.length > 0 && (
                      <div className="bg-primary/5 border border-primary/10 rounded-lg p-3">
                        <p className="text-xs font-semibold text-primary mb-2">
                          Key Points
                        </p>
                        <ul className="space-y-1">
                          {msg.responseData.keyPoints.map((kp, i) => (
                            <li
                              key={i}
                              className="text-xs text-foreground/80 flex items-start gap-2"
                            >
                              <span className="text-primary mt-0.5">-</span>
                              {kp}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                  {/* Document Evidence */}
                  {msg.responseData?.documentEvidence &&
                    msg.responseData.documentEvidence.length > 0 && (
                      <div className="bg-gray-50 dark:bg-gray-900 border border-card-border rounded-lg p-3">
                        <p className="text-xs font-semibold text-muted mb-2 flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          Document Evidence
                        </p>
                        {msg.responseData.documentEvidence.map((de, i) => (
                          <div key={i} className="text-xs mb-2 last:mb-0">
                            <p className="font-medium text-foreground/80">
                              {de.location}
                            </p>
                            <p className="text-muted italic">
                              &quot;{de.excerptOrSummary}&quot;
                            </p>
                            <p className="text-muted">{de.whyItMatters}</p>
                          </div>
                        ))}
                      </div>
                    )}

                  {/* Probing Questions — the key feature */}
                  {msg.responseData?.probingQuestions &&
                    msg.responseData.probingQuestions.length > 0 &&
                    msg.id ===
                      messages.filter((m) => m.role === "assistant").at(-1)
                        ?.id && (
                      <div className="bg-card-bg border border-card-border rounded-xl p-4">
                        <p className="text-xs font-semibold text-muted mb-3 flex items-center gap-1.5">
                          <HelpCircle className="w-3.5 h-3.5" />
                          To verify independently:
                        </p>
                        <div className="space-y-4">
                          {msg.responseData.probingQuestions.map((pq, i) => {
                            const hasComment = !!comments[pq.question];
                            const isEditing = editingComment === pq.question;

                            return (
                              <div
                                key={i}
                                className="border-l-2 border-primary/30 pl-3 space-y-2"
                              >
                                <p className="text-sm font-medium text-foreground/90">
                                  {pq.question}
                                </p>
                                {pq.reason && (
                                  <p className="text-xs text-muted">
                                    {pq.reason}
                                  </p>
                                )}

                                {/* Comment display */}
                                {hasComment && !isEditing && (
                                  <div className="bg-primary/5 rounded-lg p-2.5 flex items-start justify-between gap-2">
                                    <div>
                                      <p className="text-xs font-medium text-primary mb-0.5">
                                        Your comment:
                                      </p>
                                      <p className="text-xs text-foreground/80">
                                        {comments[pq.question]}
                                      </p>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                      <button
                                        onClick={() => {
                                          setEditingComment(pq.question);
                                          setDraftComment(
                                            comments[pq.question],
                                          );
                                        }}
                                        className="p-1 text-muted hover:text-primary"
                                        title="Edit"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={() =>
                                          removeComment(pq.question)
                                        }
                                        className="p-1 text-muted hover:text-red-500"
                                        title="Remove"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {/* Comment editing */}
                                {isEditing && (
                                  <div className="space-y-2">
                                    <textarea
                                      value={draftComment}
                                      onChange={(e) =>
                                        setDraftComment(e.target.value)
                                      }
                                      rows={2}
                                      className="w-full rounded-lg border border-card-border bg-gray-50 dark:bg-gray-900 p-2 text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
                                      placeholder="Type your comment..."
                                      autoFocus
                                    />
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => addComment(pq.question)}
                                        disabled={!draftComment.trim()}
                                        className="px-3 py-1 rounded text-xs font-medium bg-primary text-white disabled:opacity-50"
                                      >
                                        Save
                                      </button>
                                      <button
                                        onClick={() => {
                                          setEditingComment(null);
                                          setDraftComment("");
                                        }}
                                        className="px-3 py-1 rounded text-xs font-medium text-muted hover:text-foreground"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {/* Add comment button */}
                                {!hasComment && !isEditing && (
                                  <button
                                    onClick={() => {
                                      setEditingComment(pq.question);
                                      setDraftComment("");
                                    }}
                                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                                  >
                                    <Plus className="w-3 h-3" />
                                    Add comment
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Continue with comments button */}
                        {commentedQuestions.length > 0 && (
                          <div className="mt-4 pt-3 border-t border-card-border">
                            <button
                              onClick={handleContinueWithComments}
                              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-dark transition-colors"
                            >
                              <MessageSquare className="w-4 h-4" />
                              Continue with my comments
                              <span className="bg-white/20 px-1.5 py-0.5 rounded text-xs">
                                {commentedQuestions.length}
                              </span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                  {/* Suggested Next Actions */}
                  {msg.responseData?.suggestedNextActions &&
                    msg.responseData.suggestedNextActions.length > 0 &&
                    msg.id ===
                      messages.filter((m) => m.role === "assistant").at(-1)
                        ?.id && (
                      <div className="flex flex-wrap gap-2">
                        {msg.responseData.suggestedNextActions.map(
                          (action, i) => (
                            <button
                              key={i}
                              onClick={() => sendMessage(action)}
                              className="px-3 py-1.5 rounded-full border border-card-border bg-card-bg text-xs text-muted hover:border-primary/40 hover:text-foreground transition-colors"
                            >
                              {action}
                            </button>
                          ),
                        )}
                      </div>
                    )}
                </div>
              )}
            </div>
          ))}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex items-center gap-2 text-muted text-sm animate-slide-up">
              <Loader2 className="w-4 h-4 animate-spin" />
              Thinking...
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
              {error}
              <button onClick={() => setError(null)} className="ml-2 underline">
                Dismiss
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Student answer indicator */}
        {studentAnswer.trim() && (
          <div className="shrink-0 border-t border-card-border pt-2 mt-2">
            <div className="flex items-center gap-2 text-xs text-muted">
              <FileText className="w-3 h-3" />
              Student answer attached (
              {studentAnswer.trim().split(/\s+/).length} words)
              <button
                onClick={() => router.push("/task")}
                className="text-primary hover:underline"
              >
                Edit
              </button>
            </div>
          </div>
        )}

        {/* Input Area */}
        <form
          onSubmit={handleSubmit}
          className="shrink-0 border-t border-card-border pt-3 mt-2"
        >
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Type your message..."
              className="flex-1 rounded-lg border border-card-border bg-gray-50 dark:bg-gray-900 px-3 py-2.5 text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-4 py-2.5 rounded-lg bg-primary text-white disabled:opacity-50 hover:bg-primary-dark transition-colors shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>

      {/* ── Context Review Modal ── */}
      {showContextReview && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card-bg border border-card-border rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto shadow-xl">
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Eye className="w-4 h-4 text-primary" />
                  Context that will be sent to the AI
                </h3>
                <button
                  onClick={() => setShowContextReview(false)}
                  className="text-muted hover:text-foreground"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-2">
                  <span className="text-xs font-medium text-muted w-24 shrink-0">
                    Subject:
                  </span>
                  <span>{selectedSubject.name}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-xs font-medium text-muted w-24 shrink-0">
                    Task:
                  </span>
                  <span className="text-sm">{taskTitle}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-xs font-medium text-muted w-24 shrink-0">
                    Mode:
                  </span>
                  <span className="capitalize">{assistanceMode}</span>
                </div>
                {lastResponse && (
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-medium text-muted w-24 shrink-0">
                      Previous AI:
                    </span>
                    <span className="text-xs text-muted line-clamp-3">
                      {lastResponse.directResponse.substring(0, 200)}...
                    </span>
                  </div>
                )}

                <hr className="border-card-border" />

                <p className="text-xs font-semibold text-primary">
                  Your comments ({commentedQuestions.length}):
                </p>
                {commentedQuestions.map((c, i) => (
                  <div
                    key={i}
                    className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 space-y-1"
                  >
                    <p className="text-xs text-muted">Q: {c.question}</p>
                    <p className="text-sm font-medium">{c.comment}</p>
                    <button
                      onClick={() => removeComment(c.question)}
                      className="text-xs text-red-500 hover:underline flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowContextReview(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-muted hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmContinue}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-dark transition-colors"
                >
                  Continue
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
