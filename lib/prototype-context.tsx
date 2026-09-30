"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import type {
  Subject,
  PreloadedTask,
  CustomDocument,
  AssistanceMode,
  PrototypeSettings,
} from "./types";

interface StudyFlowState {
  /* Selection */
  selectedSubject: Subject | null;
  selectedTask: PreloadedTask | null;
  customDocument: CustomDocument | null;
  studentAnswer: string;
  assistanceMode: AssistanceMode;

  /* Prototype */
  settings: PrototypeSettings;
  isMounted: boolean;

  /* Actions */
  setSelectedSubject: (s: Subject | null) => void;
  setSelectedTask: (t: PreloadedTask | null) => void;
  setCustomDocument: (d: CustomDocument | null) => void;
  setStudentAnswer: (a: string) => void;
  setAssistanceMode: (m: AssistanceMode) => void;
  updateSettings: (patch: Partial<PrototypeSettings>) => void;
  resetSession: () => void;
}

const defaultSettings: PrototypeSettings = {
  serviceMode: "primary",
  showReviewCheckpoint: true,
};

const StudyFlowContext = createContext<StudyFlowState | null>(null);

export function PrototypeProvider({ children }: { children: React.ReactNode }) {
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [selectedTask, setSelectedTask] = useState<PreloadedTask | null>(null);
  const [customDocument, setCustomDocument] = useState<CustomDocument | null>(
    null,
  );
  const [studentAnswer, setStudentAnswer] = useState("");
  const [assistanceMode, setAssistanceMode] = useState<AssistanceMode>("guide");
  const [settings, setSettings] = useState<PrototypeSettings>(defaultSettings);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    try {
      const saved = localStorage.getItem("studyflow-settings");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.serviceMode === "nvidia") {
          parsed.serviceMode = "primary";
        }
        setSettings({ ...defaultSettings, ...parsed });
      }
    } catch {
      /* ignore */
    }
  }, []);

  const updateSettings = useCallback((patch: Partial<PrototypeSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem("studyflow-settings", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const resetSession = useCallback(() => {
    setSelectedSubject(null);
    setSelectedTask(null);
    setCustomDocument(null);
    setStudentAnswer("");
    setAssistanceMode("guide");
    try {
      localStorage.removeItem("studyflow-chat");
      localStorage.removeItem("studyflow-settings");
    } catch {
      /* ignore */
    }
    setSettings(defaultSettings);
  }, []);

  return (
    <StudyFlowContext.Provider
      value={{
        selectedSubject,
        selectedTask,
        customDocument,
        studentAnswer,
        assistanceMode,
        settings,
        isMounted,
        setSelectedSubject,
        setSelectedTask,
        setCustomDocument,
        setStudentAnswer,
        setAssistanceMode,
        updateSettings,
        resetSession,
      }}
    >
      {children}
    </StudyFlowContext.Provider>
  );
}

export function usePrototype(): StudyFlowState {
  const ctx = useContext(StudyFlowContext);
  if (!ctx) {
    throw new Error("usePrototype must be used within PrototypeProvider");
  }
  return ctx;
}
