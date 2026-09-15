import { briefSnapshot } from "./brief-snapshot";
import { scoreAction } from "./score-rubric";
import type { BriefSnapshot, InterviewScoreReport, SimulatedInterview } from "./types";

export function scoreInterview(
  interview: SimulatedInterview,
  brief: BriefSnapshot = briefSnapshot,
): InterviewScoreReport {
  const violations = interview.actions.flatMap((action, index) =>
    scoreAction(action, index, brief),
  );

  return {
    interviewId: interview.id,
    briefSha: brief.sha,
    passed: violations.length === 0,
    violations,
  };
}
