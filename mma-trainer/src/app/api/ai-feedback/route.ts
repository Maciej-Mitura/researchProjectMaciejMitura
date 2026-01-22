import { NextRequest, NextResponse } from "next/server";
import type { FeedbackSummary } from "@/app/lib/pose/feedbackSummary";

// Use OpenAI or provider-agnostic wrapper
// For now, we'll use a placeholder that returns structured feedback
// In production, replace with actual OpenAI SDK call

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const summary: FeedbackSummary = body.summary;

    // Validate summary
    if (!summary || !summary.technique) {
      return NextResponse.json({ error: "Invalid summary data" }, { status: 400 });
    }

    // Check for API key
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // Return mock feedback for development
      return NextResponse.json({
        headline: "Good attempt! Focus on extension and timing.",
        topFixes: [
          {
            issue: "Lead elbow angle",
            fix: "Extend your lead arm more fully. Your elbow should be straighter at peak extension.",
            priority: "high",
          },
          {
            issue: "Extension timing",
            fix: "Your extension peaks slightly late. Try to accelerate faster at the start.",
            priority: "medium",
          },
          {
            issue: "Guard position",
            fix: "Keep your rear hand up during the jab. Don't let it drop.",
            priority: "low",
          },
        ],
        drill: "Practice slow-motion jabs focusing on full extension. Hold at peak extension for 1 second, then return to guard.",
        whatToFocusNext: "Work on increasing your peak extension to match the reference. Aim for 20% more extension.",
        safetyNotes: "Ensure proper warm-up before training. Stop if you feel any joint pain.",
      });
    }

    // Build prompt for OpenAI
    const prompt = `You are a professional MMA coach analyzing a student's ${summary.technique} technique.

CRITICAL RULES:
- You MUST only use the data provided. Do NOT invent measurements or observations.
- Output ONLY valid JSON. No markdown, no explanations outside JSON.
- Base all feedback on the actual metrics provided.

Data provided:
- Overall score: ${summary.overallScore ?? "N/A"}
- Number of attempts: ${summary.attempts.length}
- Consistency: ${(summary.aggregate.consistency * 100).toFixed(0)}%
- Worst joints: ${summary.aggregate.worstJoints.map((w) => `${w.joint} (${w.avgErrorDeg.toFixed(1)}° error)`).join(", ")}
- Data quality: ${summary.dataQuality.occlusionRisk} (${(summary.dataQuality.validFrameRatioAvg * 100).toFixed(0)}% valid frames)

Per-attempt details:
${summary.attempts
  .map(
    (a, i) =>
      `Attempt ${i + 1}: score=${a.score ?? "N/A"}, extDelta=${a.extDelta.toFixed(3)}, dtwCost=${a.dtwAvgCost?.toFixed(2) ?? "N/A"}, worstJoints=${a.worstJoints.map((w) => `${w.joint}(${w.errorDeg.toFixed(1)}°)`).join(", ")}`
  )
  .join("\n")}

Generate coaching feedback in this JSON format:
{
  "headline": "One sentence summary of overall performance",
  "topFixes": [
    {
      "issue": "Specific issue name",
      "fix": "Actionable instruction to fix it",
      "priority": "high" | "medium" | "low"
    }
  ],
  "drill": "A specific drill or exercise to practice",
  "whatToFocusNext": "What to prioritize in next session",
  "safetyNotes": "Any safety concerns or reminders"
}`;

    // Call OpenAI API
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // Use gpt-4o-mini (cost-effective)
        messages: [
          {
            role: "system",
            content: "You are a professional MMA coach. Provide concise, actionable feedback based only on the data provided. Output valid JSON only.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API error:", errorText);
      return NextResponse.json({ error: "Failed to generate feedback" }, { status: 500 });
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: "No content in response" }, { status: 500 });
    }

    const feedback = JSON.parse(content);
    return NextResponse.json(feedback);
  } catch (error) {
    console.error("Error generating AI feedback:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
