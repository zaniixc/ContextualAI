import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { GEMINI_MODEL } from "@/lib/constants";
import { parseDocumentBuffer } from "@/lib/server-document-parser";
import type {
  GeminiResponse,
  ProbingQuestion,
  ServiceSource,
} from "@/lib/types";

/* ── Rate Limiting Setup ── */
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60 * 1000;
const MAX_REQUESTS = 40;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  let timestamps = rateLimitMap.get(ip) || [];
  timestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW);

  if (timestamps.length >= MAX_REQUESTS) {
    return false;
  }

  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);
  return true;
}

/* ── Key Exhaustion Cooldown Cache (1hr cooldown on 429 quota exhaustion) ── */
const exhaustedKeys = new Map<string, number>();
const COOLDOWN_DURATION_MS = 60 * 60 * 1000;


/* ── Cognitive Offloading Detection ── */
function isCognitiveOffloading(msg: string): boolean {
  const clean = msg
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const patterns = [
    "please do this task for me",
    "please do this for me",
    "do this task for me",
    "do this for me",
    "do my task",
    "do my homework",
    "do my assignment",
    "write this essay for me",
    "write my essay",
    "write this paper for me",
    "write this for me",
    "write the answer for me",
    "give me the complete answer",
    "solve this for me",
    "answer this for me",
    "just do it",
  ];
  return patterns.some((p) => clean.includes(p));
}

/* ── System Instruction ── */
const SYSTEM_INSTRUCTION = `You are a contextual academic companion for tertiary-level students.

The student is working with either:
1. A preloaded academic task.
2. A custom academic document uploaded by the student.

The material may be an activity, handout, assignment, worksheet, problem set, presentation, reading, reflection paper, project instruction, or research activity.

You must distinguish between:
- The academic material (task instructions and content).
- The student's actual answer or draft.
- The student's casual chat message.
- The student's comments on probing questions.

Never treat a casual chat message as an academic answer.

CRITICAL PEDAGOGICAL SAFEGUARDS:
1. Cognitive Offloading Refusal: If the student asks you to do the task or assignment for them (e.g., "Please do this task for me", "write my essay", "do my homework"), you must NOT write or complete the assignment for them. You must uphold the thesis goal of mitigating cognitive offloading by refusing direct completion and guiding them with step-by-step feedback, an outline, and structural hints instead.
2. If no student answer is provided, do not evaluate accuracy, originality, argument strength, or completeness. Ask what type of help the student wants or guide them through the material.
3. If custom document text is provided, use it as context, but do not claim that the document is academically verified merely because it was readable.

Follow the selected assistance mode:
- Explain: clarify the material or instructions.
- Guide: ask questions, provide hints, and suggest next steps.
- Review: review the student's actual answer or draft. If no answer is provided, say: "I can review your answer once you provide it. For now, I can help you understand the instructions or plan your response."

Generate two to four probing questions under "To verify independently."
Each probing question MUST include:
- "question": the probing question string
- "reason": a short explanation of why this question is important

The probing questions must relate to the selected material, the current task, or the student's actual answer.

If the student provides comments on probing questions, treat those comments as student-provided reasoning. In the next response, acknowledge, evaluate, or build on those comments.
Do not blindly agree with student comments. Explain when a comment is reasonable, incomplete, uncertain, or needs evidence.

Do not claim to have verified a source unless source verification actually occurred.

Return ONLY valid JSON matching this schema:
{
  "status": "needs_clarification" | "document_overview" | "guided_help" | "answer_review" | "checklist",
  "directResponse": "string",
  "documentEvidence": [
    {
      "location": "string",
      "excerptOrSummary": "string",
      "whyItMatters": "string"
    }
  ],
  "keyPoints": ["string"],
  "probingQuestions": [
    {
      "question": "string",
      "reason": "string"
    }
  ],
  "suggestedNextActions": ["string"],
  "missingInformation": ["string"],
  "requiresStudentAnswer": boolean,
  "requiresReview": boolean
}

Do not include markdown code block syntax (like \`\`\`json). Return ONLY the raw JSON object.`;

/* ── Build Prompt ── */
function buildPrompt(body: Record<string, unknown>): string {
  const subject = body.subject as { name?: string } | null;
  const task = body.task as {
    title?: string;
    instructions?: string;
    content?: string;
  } | null;
  const customDoc = body.customDocument as {
    fileName?: string;
    extractedText?: string;
    parseStatus?: string;
  } | null;
  const studentAnswer = (body.studentAnswer as string) || "";
  const userMessage = (body.userMessage as string) || "";
  const mode = (body.assistanceMode as string) || "guide";
  const prevResponse = body.previousResponse as {
    directResponse?: string;
    probingQuestions?: ProbingQuestion[];
  } | null;
  const probingComments = (body.probingQuestionComments || []) as Array<{
    question: string;
    comment: string;
  }>;
  const history = (body.conversationHistory || []) as Array<{
    role: string;
    content: string;
  }>;

  let prompt = `${SYSTEM_INSTRUCTION}\n\n`;

  // Context: Subject
  prompt += `Selected Subject: ${subject?.name || "General"}\n`;

  // Context: Task or Custom Document
  if (task) {
    prompt += `Task Title: ${task.title}\n`;
    if (task.instructions) {
      prompt += `Task Instructions / Guidelines:\n${task.instructions}\n\n`;
    }
    if (task.content) {
      prompt += `Task Content / Reference Material:\n${task.content}\n\n`;
    }
  } else if (customDoc?.extractedText) {
    prompt += `Uploaded Document: ${customDoc.fileName || "Custom Academic Material"}\n`;
    prompt += `Document Status: ${customDoc.parseStatus || "readable"}\n`;
    prompt += `Document Text:\n${customDoc.extractedText}\n\n`;
  }

  // Context: Student Answer
  if (studentAnswer.trim()) {
    prompt += `Student's Actual Submitted Answer/Draft:\n"${studentAnswer.trim()}"\n\n`;
  } else {
    prompt += `Student's Actual Submitted Answer: None provided yet.\n\n`;
  }

  // Context: Previous AI Response
  if (prevResponse?.directResponse) {
    prompt += `Previous AI Response:\n"${prevResponse.directResponse.substring(0, 400)}"\n\n`;
  }

  // Context: Student Comments on Probing Questions
  if (probingComments.length > 0) {
    prompt += `Student's Comments on Probing Questions:\n`;
    for (const item of probingComments) {
      prompt += `- Question: "${item.question}"\n  Student's Comment: "${item.comment}"\n`;
    }
    prompt += `\nCRITICAL INSTRUCTION: The student has reviewed your probing questions and provided these specific comments. You MUST explicitly evaluate, build upon, or guide their reasoning based on these comments in your directResponse!\n\n`;
  }

  // Context: Recent Conversation History
  if (history.length > 0) {
    prompt += `Recent Conversation History:\n`;
    for (const h of history.slice(-4)) {
      prompt += `${h.role === "user" ? "Student" : "Assistant"}: ${h.content.substring(0, 200)}\n`;
    }
    prompt += `\n`;
  }

  // Current User Message & Mode
  prompt += `Selected Assistance Mode: ${mode.toUpperCase()}\n`;
  prompt += `Student's Latest Message: "${userMessage}"\n\n`;

  prompt += `SPECIFIC GUIDELINES FOR THIS TURN:
1. If the student asks you to do the task or assignment for them (e.g. "Please do this task for me", "write my essay", "do my homework"), you MUST politely refuse direct completion to mitigate cognitive offloading, and instead break down the task into manageable steps and outline guidance.
2. If the student message is casual (e.g. "hello", "let's start", "sure, please let's start tackling the contents of the task"), do NOT evaluate their academic argument. Guide them on the task or ask what they want to tackle first.
3. If the student asks "how can I strengthen my argument?" and NO answer has been submitted, do NOT evaluate missing points or evidence; instead inform them you need to see their draft/claim first.
4. If an answer IS submitted (e.g. "I think modern techniques are better because they are faster"), evaluate that specific claim against the task guidelines.
5. Output strictly valid JSON.`;

  return prompt;
}

/* ── Grounded Academic Engine for Known Scenarios & Offline Fallback ── */
function generateGroundedFallback(
  body: Record<string, unknown>,
): GeminiResponse {
  const task = body.task as { title?: string; content?: string } | null;
  const customDoc = body.customDocument as {
    fileName?: string;
    extractedText?: string;
  } | null;
  const studentAnswer = ((body.studentAnswer as string) || "").trim();
  const rawMessage = (body.userMessage as string) || "";
  const userMessage = rawMessage.trim().toLowerCase();
  const mode = (body.assistanceMode as string) || "guide";
  const probingComments = (body.probingQuestionComments || []) as Array<{
    question: string;
    comment: string;
  }>;

  // Detect Contemporary Arts content from preloaded task or custom uploaded text
  const docText = (customDoc?.extractedText || "").toLowerCase();
  const taskText = (task?.content || "").toLowerCase();
  const combinedContext = `${task?.title || ""} ${taskText} ${customDoc?.fileName || ""} ${docText}`.toLowerCase();

  const isContemporaryArts =
    combinedContext.includes("contemporary art") ||
    combinedContext.includes("modern technique") ||
    combinedContext.includes("traditional authenticity");

  // SCENARIO 1: Mitigating Cognitive Offloading (Refusal to do the task for the student)
  if (isCognitiveOffloading(rawMessage)) {
    return {
      status: "guided_help",
      directResponse:
        "As your academic companion, I cannot complete or write this task for you. Directly doing the work replaces your critical thinking and fosters cognitive offloading, which defeats the purpose of your academic learning.\n\nInstead, let's break down this task into manageable steps so you can draft it yourself:\n1. **Clarify the Core Objective**: What specific question, argument, or calculation is required?\n2. **Identify Supporting Concepts**: What course principles or evidence apply here?\n3. **Draft an Outline**: Write an initial thesis or draft in your own words, and I will provide feedback and structural review.",
      documentEvidence: [
        {
          location: "Task Guidelines",
          excerptOrSummary:
            "Your essay must contain at least 250 words. Your essay must be your own work. Do not use AI tools, generators, or copied content from the internet.",
          whyItMatters:
            "The rubric strictly requires authentic student authorship; automated task completion violates the assignment guidelines.",
        },
        {
          location: "Essay Topic",
          excerptOrSummary:
            "Modern Techniques vs. Traditional Authenticity in Contemporary Arts",
          whyItMatters:
            "The central learning goal is your personal analytical synthesis of innovation versus cultural heritage.",
        },
      ],
      keyPoints: [
        "Thesis Principle: Mitigate cognitive offloading by preserving student authorship",
        "Companion Role: Metacognitive scaffolding, guiding questions, and structural feedback",
        "Next Action: Break the task into small checkpoints and formulate your initial draft",
      ],
      probingQuestions: [
        {
          question:
            "What is the single most important concept your instructor wants you to learn here?",
          reason:
            "Pinpointing the learning objective keeps your work focused without relying on automated completion.",
        },
        {
          question:
            "Which part of the task feels most challenging to start on your own?",
          reason:
            "Pinpointing the obstacle allows us to break it down into manageable hints.",
        },
        {
          question:
            "How would you summarize the debate between modern techniques and traditional authenticity in one sentence?",
          reason:
            "Expressing the core debate in your own words creates the foundation for your essay draft.",
        },
      ],
      suggestedNextActions: [
        "Break down the task instructions",
        "Help me create an outline",
        "Give me a guiding hint on the first concept",
      ],
      missingInformation: [],
      requiresStudentAnswer: true,
      requiresReview: false,
    };
  }

  // SCENARIO 2: Breaking Down the Task
  if (
    userMessage.includes("break down") ||
    userMessage.includes("breakdown") ||
    userMessage.includes("outline this")
  ) {
    return {
      status: "guided_help",
      directResponse:
        "Here is a 4-part breakdown to structure your response:\n\n1. **Introduction & Stance**: Introduce the tension between modern techniques (digital tools, innovative media) and traditional authenticity (craftsmanship, cultural heritage). State your perspective—do you favor one, or do you advocate for synthesis?\n\n2. **Modern Techniques Analysis**: Discuss what modern methods enable (efficiency, experimental digital media, global reach) and give an example.\n\n3. **Traditional Authenticity Analysis**: Explain why cultural preservation and human craftsmanship remain indispensable.\n\n4. **Synthesis & Conclusion**: Conclude by showing how artists can merge both approaches to honor heritage while embracing innovation.\n\nWhich of these 4 steps would you like to start outlining first?",
      documentEvidence: [
        {
          location: "Contemporary Arts Discussion",
          excerptOrSummary:
            "Rather than viewing modern techniques and traditional authenticity as opposing forces, contemporary artists can combine them.",
          whyItMatters:
            "Offers a balanced synthesis approach for the concluding section of your essay.",
        },
      ],
      keyPoints: [
        "Part 1: Introduction and clear thesis statement (approx. 50 words)",
        "Part 2: Merits of modern techniques and digital innovation (approx. 75 words)",
        "Part 3: Value of traditional authenticity and cultural preservation (approx. 75 words)",
        "Part 4: Synthesis conclusion meeting the 250-word requirement (approx. 50 words)",
      ],
      probingQuestions: [
        {
          question:
            "Do modern techniques and traditional authenticity necessarily oppose each other, or can they complement one another?",
          reason:
            "Synthesizing both viewpoints provides a stronger, more mature argument than choosing only one side.",
        },
        {
          question:
            "What specific artistic example (e.g. digital weaving, AI painting, photography) could support your analysis?",
          reason:
            "Concrete evidence grounds theoretical claims in actual artistic practice.",
        },
      ],
      suggestedNextActions: [
        "Help me draft Part 1 (Introduction)",
        "Give me an example of combining both techniques",
        "Check my word count requirements",
      ],
      missingInformation: [],
      requiresStudentAnswer: false,
      requiresReview: false,
    };
  }

  // SCENARIO 3: Student provided comments on probing questions
  if (probingComments.length > 0) {
    const firstComment = probingComments[0];
    return {
      status: "guided_help",
      directResponse: `Thank you for sharing your thoughts on the probing question ("${firstComment.question}"). Your perspective that "${firstComment.comment}" is a thoughtful starting point. To develop this into an academically defensible point, consider what concrete evidence or example from the material supports this idea, and how it addresses both sides of the prompt.`,
      documentEvidence: [
        {
          location: "Student Probing Question Feedback",
          excerptOrSummary: firstComment.comment,
          whyItMatters:
            "Reflects student's independent reasoning and active synthesis.",
        },
      ],
      keyPoints: [
        `Student focus: "${firstComment.comment}"`,
        "Next step: Connect this insight directly to specific examples or techniques",
        "Consider potential counterarguments to balance the analysis",
      ],
      probingQuestions: [
        {
          question:
            "What specific artwork or artistic practice best illustrates your point?",
          reason:
            "Grounding abstract ideas in concrete artistic examples strengthens your argument.",
        },
        {
          question:
            "How might an artist combining both methods respond to this observation?",
          reason:
            "Considering synthesis helps you write a balanced, nuanced essay.",
        },
      ],
      suggestedNextActions: [
        "Draft a paragraph explaining this insight",
        "Explore an example combining both techniques",
        "Review essay structure requirements",
      ],
      missingInformation: [],
      requiresStudentAnswer: true,
      requiresReview: false,
    };
  }

  // SCENARIO 4: Contemporary Arts Essay — Premeditated Defense Scenarios
  if (isContemporaryArts) {
    // 4a. Casual kickoff: "Sure, please let’s start tackling the contents of the task." or "let's start"
    if (
      userMessage.includes("start tackling") ||
      userMessage.includes("let's start") ||
      userMessage.includes("lets start") ||
      userMessage === "sure" ||
      userMessage === "hello" ||
      userMessage === "hi"
    ) {
      return {
        status: "guided_help",
        directResponse:
          "Let's begin with the essay prompt. The task asks you to discuss the relationship between modern techniques and traditional authenticity in contemporary arts. Before we plan your response, what do you think is the main difference between the two approaches?",
        documentEvidence: [
          {
            location: "Task Overview",
            excerptOrSummary:
              "A debate has emerged between the use of modern techniques and the preservation of traditional authenticity.",
            whyItMatters:
              "This core tension forms the foundation of your required 250-word essay.",
          },
        ],
        keyPoints: [
          "Minimum word count requirement: at least 250 words",
          "Core theme: Modern techniques (digital tools, AI, innovative forms) vs. Traditional authenticity (cultural heritage, handmade craft)",
          "Objective: Explore whether they are in opposition or can be combined",
        ],
        probingQuestions: [
          {
            question: "What is the strongest reason to value modern techniques?",
            reason:
              "Understanding the advantages of innovation helps build the first side of the discussion.",
          },
          {
            question:
              "What role does cultural heritage play in traditional authenticity?",
            reason:
              "Preserving community identity and craftsmanship is central to traditional arts.",
          },
          {
            question: "Do the two approaches necessarily conflict?",
            reason:
              "Exploring synthesis allows for a more mature and balanced conclusion.",
          },
          {
            question: "What example could support your position?",
            reason:
              "Academic essays require concrete illustrations to validate analytical claims.",
          },
        ],
        suggestedNextActions: [
          "Explain the difference between modern and traditional in your own words",
          "Outline the main points for your essay",
          "Draft the introductory sentence",
        ],
        missingInformation: [],
        requiresStudentAnswer: false,
        requiresReview: false,
      };
    }

    // 4b. "How can I strengthen my argument?"
    if (
      userMessage.includes("strengthen") ||
      userMessage.includes("improve my argument")
    ) {
      if (!studentAnswer) {
        return {
          status: "needs_clarification",
          directResponse:
            "I can help strengthen it, but I need to see your current argument first. You can paste your paragraph or write your main claim in one sentence. Then I can check whether the claim is clear, supported, balanced, and connected to the task.",
          documentEvidence: [],
          keyPoints: [
            "No student draft or answer submitted yet",
            "A claim must be stated before argument strength can be evaluated",
          ],
          probingQuestions: [
            {
              question:
                "What is your main claim or thesis in one clear sentence?",
              reason: "A clear thesis statement anchors the entire argument.",
            },
            {
              question:
                "Which side of the debate do you lean toward, or do you argue for synthesis?",
              reason:
                "Clarifying your stance helps determine what evidence is needed.",
            },
          ],
          suggestedNextActions: [
            "Write my thesis statement in the answer box",
            "Help me brainstorm arguments for modern techniques",
            "Help me brainstorm arguments for traditional authenticity",
          ],
          missingInformation: ["Student draft or central claim"],
          requiresStudentAnswer: true,
          requiresReview: false,
        };
      } else if (
        studentAnswer.toLowerCase().includes("faster") ||
        studentAnswer.toLowerCase().includes("better because")
      ) {
        return {
          status: "answer_review",
          directResponse:
            "Your claim is clear, but 'faster' alone may not be enough to prove that modern techniques are better. You could strengthen it by explaining what faster production allows artists to do and by acknowledging a limitation or value of traditional methods. For example, you might compare flexibility and accessibility with cultural meaning and craftsmanship.",
          documentEvidence: [
            {
              location: "Student Draft",
              excerptOrSummary: studentAnswer,
              whyItMatters: "The initial claim focuses on speed/efficiency.",
            },
            {
              location: "Task Content Paragraph 3",
              excerptOrSummary:
                "Handmade artworks can also demonstrate patience, skill, and personal expression in ways that technology cannot completely replace.",
              whyItMatters:
                "Contrasts the value of speed with the deliberate depth of traditional craftsmanship.",
            },
          ],
          keyPoints: [
            "Claim is direct, but efficiency is only one dimension of artistic value",
            "Consider what digital speed enables: rapid experimentation, wider reach, revision",
            "Acknowledge the counter-perspective: cultural heritage, patience, human touch",
          ],
          probingQuestions: [
            {
              question:
                "Does speed in production compromise the depth or cultural significance of the art?",
              reason: "Critically examining efficiency prevents one-sided claims.",
            },
            {
              question:
                "How can you rephrase 'faster' into a broader artistic advantage (e.g., iterative exploration or global accessibility)?",
              reason:
                "Using formal academic terminology elevates the sophistication of your essay.",
            },
          ],
          suggestedNextActions: [
            "Revise the claim to include creative flexibility",
            "Add a sentence acknowledging traditional craftsmanship",
            "Draft supporting examples",
          ],
          missingInformation: [],
          requiresStudentAnswer: true,
          requiresReview: true,
        };
      }
    }
  }

  // SCENARIO 5: Review mode without student answer
  if (mode === "review" && !studentAnswer) {
    return {
      status: "needs_clarification",
      directResponse:
        "I can review your answer once you provide it. For now, I can help you understand the instructions or plan your response.",
      documentEvidence: [],
      keyPoints: [
        "Review mode requires an existing student draft or answer",
        "You can type or paste your draft in the answer drawer anytime",
      ],
      probingQuestions: [
        {
          question:
            "What is the single most important concept your instructor wants you to learn here?",
          reason:
            "Ensures your planned response addresses the primary objective.",
        },
        {
          question:
            "What guidelines (word count, format, rubrics) must your answer satisfy?",
          reason: "Verifying formatting constraints prevents marks deduction.",
        },
      ],
      suggestedNextActions: [
        "Explain the task instructions",
        "Help me outline my response",
        "Give me a hint on the first concept",
      ],
      missingInformation: ["Student answer draft"],
      requiresStudentAnswer: true,
      requiresReview: false,
    };
  }

  // Default Grounded Pedagogical Guidance
  const targetTitle =
    task?.title || customDoc?.fileName || "your academic material";
  return {
    status: "guided_help",
    directResponse: `Let's focus on "${targetTitle}". To work through this effectively, let's break down the core requirements and identify your initial perspective before drafting a full response. How would you summarize what this task is asking you to accomplish?`,
    documentEvidence: [],
    keyPoints: [
      `Active Material: ${targetTitle}`,
      "Pedagogical focus: Metacognitive scaffolding before drafting",
      "Preserves student authorship and critical evaluation",
    ],
    probingQuestions: [
      {
        question:
          "What is the single most important concept your instructor wants you to learn here?",
        reason:
          "Pinpointing the learning objective keeps your work on target.",
      },
      {
        question:
          "Which claim or question in this material needs the strongest evidence?",
        reason:
          "Identifying evidence requirements strengthens academic rigor.",
      },
      {
        question: "How would you explain this concept in your own words?",
        reason: "Self-explanation solidifies conceptual mastery.",
      },
    ],
    suggestedNextActions: [
      "Break down the main instructions",
      "Give me a guiding hint to get started",
      "Create a step-by-step checklist",
    ],
    missingInformation: [],
    requiresStudentAnswer: false,
    requiresReview: false,
  };
}

/* ── Call Gemini API with Fast Timeout & Immediate Quota Failover ── */
async function callGeminiApi(
  apiKey: string,
  promptText: string,
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });

  // 1. Try interactions.create with strict 3500ms timeout
  try {
    const interaction = await ai.interactions.create(
      { model: GEMINI_MODEL, input: promptText },
      { maxRetries: 0, timeout: 3500 },
    );
    if (interaction.output_text) {
      return interaction.output_text;
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // If it's a quota or rate limit error, fail immediately so key rotation / NVIDIA can take over
    if (
      errMsg.includes("429") ||
      errMsg.includes("quota") ||
      errMsg.includes("Rate limit") ||
      errMsg.includes("RESOURCE_EXHAUSTED")
    ) {
      throw err;
    }

    // Attempt generateContent fallback for non-quota errors
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: promptText,
      });
      if (response.text) {
        return response.text;
      }
    } catch {
      throw err;
    }
    throw err;
  }

  throw new Error("No output text returned from Gemini API");
}

/* ── Call NVIDIA DeepSeek API (OpenAI-compatible with strict 9s timeout) ── */
async function callNvidiaApi(
  apiKey: string,
  promptText: string,
): Promise<string> {
  const openai = new OpenAI({
    apiKey,
    baseURL: "https://integrate.api.nvidia.com/v1",
    timeout: 9000,
    maxRetries: 0,
  });

  const completion = await openai.chat.completions.create({
    model: "deepseek-ai/deepseek-v4.1-flash",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: promptText,
          },
        ],
      },
    ],
    temperature: 0.2,
    top_p: 0.7,
    max_tokens: 2048,
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) {
    throw new Error("No output text returned from NVIDIA DeepSeek API");
  }
  return text;
}

/* ── Parse JSON safely (supporting DeepSeek reasoning and code blocks) ── */
function parseGeminiOutput(raw: string): GeminiResponse {
  let cleaned = raw.trim();

  // Strip DeepSeek <think> reasoning blocks if present
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Strip markdown code block wrappers
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
  }

  // Attempt direct JSON parse
  try {
    const parsed = JSON.parse(cleaned);
    return {
      status: parsed.status || "guided_help",
      directResponse: parsed.directResponse || parsed.response || cleaned,
      documentEvidence: Array.isArray(parsed.documentEvidence)
        ? parsed.documentEvidence
        : [],
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      probingQuestions: Array.isArray(parsed.probingQuestions)
        ? parsed.probingQuestions
        : [],
      suggestedNextActions: Array.isArray(parsed.suggestedNextActions)
        ? parsed.suggestedNextActions
        : [],
      missingInformation: Array.isArray(parsed.missingInformation)
        ? parsed.missingInformation
        : [],
      requiresStudentAnswer: !!parsed.requiresStudentAnswer,
      requiresReview: !!parsed.requiresReview,
    };
  } catch {
    // If direct parse failed, attempt to find { ... } JSON substring inside cleaned
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          status: parsed.status || "guided_help",
          directResponse: parsed.directResponse || parsed.response || cleaned,
          documentEvidence: Array.isArray(parsed.documentEvidence)
            ? parsed.documentEvidence
            : [],
          keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
          probingQuestions: Array.isArray(parsed.probingQuestions)
            ? parsed.probingQuestions
            : [],
          suggestedNextActions: Array.isArray(parsed.suggestedNextActions)
            ? parsed.suggestedNextActions
            : [],
          missingInformation: Array.isArray(parsed.missingInformation)
            ? parsed.missingInformation
            : [],
          requiresStudentAnswer: !!parsed.requiresStudentAnswer,
          requiresReview: !!parsed.requiresReview,
        };
      } catch {
        // Fall through to text fallback
      }
    }

    // Unstructured text fallback
    return {
      status: "guided_help",
      directResponse: cleaned || raw.trim(),
      documentEvidence: [],
      keyPoints: ["Academic guidance response"],
      probingQuestions: [
        {
          question:
            "How does this response relate to your specific coursework instructions?",
          reason:
            "Ensures the generated output is checked against your course requirements.",
        },
      ],
      suggestedNextActions: [
        "Ask for a simpler explanation",
        "Ask for a step-by-step hint",
      ],
      missingInformation: [],
      requiresStudentAnswer: false,
      requiresReview: false,
    };
  }
}

/* ── POST Handler ── */
export async function POST(request: Request) {
  try {
    // 1. Rate Limiting
    const ip =
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "anonymous";
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { success: false, error: "Too many requests. Please wait a moment." },
        { status: 429 },
      );
    }

    // 2. Parse Body
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON payload." },
        { status: 400 },
      );
    }

    // 3. Document Extraction (if base64 buffer passed)
    const customDoc = body.customDocument as Record<string, unknown> | null;
    if (customDoc?.base64 && typeof customDoc.base64 === "string") {
      try {
        const buffer = Buffer.from(customDoc.base64 as string, "base64");
        const parsed = await parseDocumentBuffer(
          buffer,
          (customDoc.fileName as string) || "document",
          5000,
        );
        if (parsed.text) {
          customDoc.extractedText = parsed.text;
        }
      } catch {
        // Fall back to existing extractedText
      }
    }

    // 4. Force Local Fallback Check
    const forceMode = body.forceMode as string | undefined;
    if (forceMode === "local") {
      const fallback = generateGroundedFallback(body);
      return NextResponse.json({
        success: true,
        data: fallback,
        source: "local-fallback" as ServiceSource,
        timestamp: new Date().toISOString(),
      });
    }

    // 5. Build AI Prompt
    const promptText = buildPrompt(body);

    const nvidiaKey =
      process.env.NVIDIA_API_KEY ||
      process.env.DEEPSEEK_NVDIA_API ||
      process.env.DEEPSEEK_API;

    // 6. Direct NVIDIA DeepSeek Mode if explicitly selected
    if (forceMode === "nvidia") {
      if (nvidiaKey) {
        try {
          const rawResponse = await callNvidiaApi(nvidiaKey, promptText);
          const parsed = parseGeminiOutput(rawResponse);
          return NextResponse.json({
            success: true,
            data: parsed,
            source: "nvidia-live" as ServiceSource,
            timestamp: new Date().toISOString(),
          });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn("Direct NVIDIA API notice:", errMsg.substring(0, 100));
        }
      }
      // If direct NVIDIA failed or key missing, immediately return grounded fallback (do NOT fall through to broken Gemini keys!)
      const fallback = generateGroundedFallback(body);
      return NextResponse.json({
        success: true,
        data: fallback,
        source: "local-fallback" as ServiceSource,
        timestamp: new Date().toISOString(),
      });
    }

    // 7. Key Rotation across Gemini Keys (with 1hr quota cooldown check)
    const now = Date.now();
    const keys = [
      {
        key: process.env.GEMINI_API_KEY,
        source: "gemini-live" as ServiceSource,
      },
      {
        key: process.env.GEMINI_API_KEY_FALLBACK_1,
        source: "gemini-backup" as ServiceSource,
      },
      {
        key: process.env.GEMINI_API_KEY_FALLBACK_2,
        source: "gemini-backup" as ServiceSource,
      },
    ];

    let candidateKeys = keys.filter((k) => {
      if (!k.key) return false;
      const cooldownUntil = exhaustedKeys.get(k.key);
      if (cooldownUntil && now < cooldownUntil) {
        return false;
      }
      return true;
    });

    if (forceMode === "fallback-1") {
      candidateKeys = candidateKeys.filter((_, i) => i >= 1);
    } else if (forceMode === "fallback-2") {
      candidateKeys = candidateKeys.filter((_, i) => i >= 2);
    }

    // Execute Live Call with Gemini Key Rotation (if candidate keys exist)
    for (const { key, source } of candidateKeys) {
      if (!key) continue;
      try {
        const rawResponse = await callGeminiApi(key, promptText);
        const parsed = parseGeminiOutput(rawResponse);
        return NextResponse.json({
          success: true,
          data: parsed,
          source,
          timestamp: new Date().toISOString(),
        });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(
          `Gemini key notice for ${source}:`,
          errMsg.substring(0, 100),
        );
        if (
          errMsg.includes("429") ||
          errMsg.includes("quota") ||
          errMsg.includes("Rate limit") ||
          errMsg.includes("RESOURCE_EXHAUSTED")
        ) {
          exhaustedKeys.set(key, Date.now() + COOLDOWN_DURATION_MS);
        }
      }
    }

    // 8. Resilient NVIDIA DeepSeek API Failover
    // If Gemini keys hit quota or are unavailable, try NVIDIA DeepSeek
    if (nvidiaKey) {
      try {
        const rawResponse = await callNvidiaApi(nvidiaKey, promptText);
        const parsed = parseGeminiOutput(rawResponse);
        return NextResponse.json({
          success: true,
          data: parsed,
          source: "nvidia-live" as ServiceSource,
          timestamp: new Date().toISOString(),
        });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn("NVIDIA DeepSeek failover notice:", errMsg.substring(0, 100));
      }
    }

    // 9. Graceful Fallback if all API keys fail or are exhausted
    const fallbackData = generateGroundedFallback(body);
    return NextResponse.json({
      success: true,
      data: fallbackData,
      source: "local-fallback" as ServiceSource,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    console.error("Unhandled API route error:", err);
    return NextResponse.json(
      {
        success: false,
        error: "An unexpected error occurred. Please try again.",
      },
      { status: 500 },
    );
  }
}
