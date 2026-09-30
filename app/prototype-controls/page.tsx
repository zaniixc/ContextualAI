"use client";

import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { usePrototype } from "@/lib/prototype-context";
import { Settings, RotateCcw, Trash2 } from "lucide-react";
import type { ServiceMode } from "@/lib/types";

const SERVICE_MODES: {
  value: ServiceMode;
  label: string;
  description: string;
}[] = [
  {
    value: "primary",
    label: "Primary (Gemini with NVIDIA Fallback)",
    description: "Uses Gemini first, falls back to NVIDIA DeepSeek on rate limits.",
  },
  {
    value: "nvidia",
    label: "NVIDIA DeepSeek (Direct)",
    description: "Directly uses the NVIDIA DeepSeek-v4.1-flash API.",
  },
  {
    value: "fallback-1",
    label: "Force Fallback Key 1",
    description: "Simulates primary key failure.",
  },
  {
    value: "fallback-2",
    label: "Force Fallback Key 2",
    description: "Simulates both primary and fallback 1 failure.",
  },
  {
    value: "local",
    label: "Force Local Fallback",
    description: "Simulates complete API failure.",
  },
];

export default function PrototypeControlsPage() {
  const router = useRouter();
  const { settings, updateSettings, resetSession } = usePrototype();

  const handleReset = () => {
    if (
      confirm(
        "Reset all prototype data? This clears chat history, selections, and settings.",
      )
    ) {
      resetSession();
      try {
        localStorage.removeItem("studyflow-chat");
      } catch {
        /* ignore */
      }
      router.push("/dashboard");
    }
  };

  const handleClearChat = () => {
    try {
      localStorage.removeItem("studyflow-chat");
    } catch {
      /* ignore */
    }
    alert("Chat history cleared.");
  };

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="w-6 h-6 text-primary" />
            Prototype Controls
          </h1>
          <p className="text-muted text-sm mt-1">
            These controls are for thesis defense demonstration only.
          </p>
        </div>

        {/* AI Service Mode */}
        <section className="bg-card-bg border border-card-border rounded-xl p-5">
          <h2 className="text-sm font-semibold mb-3">AI Service Mode</h2>
          <div className="space-y-2">
            {SERVICE_MODES.map((m) => (
              <label
                key={m.value}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  settings.serviceMode === m.value
                    ? "border-primary bg-primary/5"
                    : "border-card-border hover:border-primary/40"
                }`}
              >
                <input
                  type="radio"
                  name="serviceMode"
                  value={m.value}
                  checked={settings.serviceMode === m.value}
                  onChange={() => updateSettings({ serviceMode: m.value })}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium">{m.label}</p>
                  <p className="text-xs text-muted">{m.description}</p>
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* Demo Controls */}
        <section className="bg-card-bg border border-card-border rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold mb-2">Demo Controls</h2>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Reset Demo
            </button>
            <button
              onClick={handleClearChat}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-card-border text-sm font-medium text-muted hover:text-foreground hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Clear Chat History
            </button>
          </div>
        </section>

        {/* Review Checkpoint Toggle */}
        <section className="bg-card-bg border border-card-border rounded-xl p-5">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.showReviewCheckpoint}
              onChange={(e) =>
                updateSettings({ showReviewCheckpoint: e.target.checked })
              }
              className="rounded"
            />
            <div>
              <p className="text-sm font-medium">Enable Review Checkpoint</p>
              <p className="text-xs text-muted">
                Show context review modal before sending comments to the AI.
              </p>
            </div>
          </label>
        </section>
      </div>
    </AppShell>
  );
}
