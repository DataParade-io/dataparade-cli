import type { Command } from "commander";

import { writeKbBrief } from "./brief";
import { KbError, resolveKbPaths } from "./kb-store";
import { landInterviewAnswer } from "./land";
import { pushKbDiagram, writeKbDiagram } from "./project-diagram";
import { SlotValueError } from "./slot-shapes";

const DEFAULT_KB_DIR = ".dataparade";

/** All kb commands print one JSON object so agents can parse results. */
function print(result: unknown): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}

function fail(error: unknown): void {
  const code = error instanceof KbError ? error.code : error instanceof SlotValueError ? "BAD_VALUE" : "ERROR";
  print({ ok: false, code, error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
}

export function registerKbCommands(program: Command): void {
  const kb = program
    .command("kb")
    .description("Knowledge base: interview briefs, confirmed answers (Discoveries), and diagram projection");

  kb.command("brief")
    .description("Snapshot the KB as a brief: what is known, and the open interview questions in asking order")
    .option("--kb <dir>", "Knowledge base directory (where scan wrote dataflow.json)", DEFAULT_KB_DIR)
    .option("--all", "Include already-answered questions in the printed list")
    .action((options: { kb: string; all?: boolean }) => {
      try {
        const written = writeKbBrief(resolveKbPaths(options.kb));
        const questions = written.brief.questions.filter((q) => options.all || q.status === "unknown");
        print({
          ok: true,
          brief_sha: written.sha,
          brief_path: written.path,
          open_questions: written.brief.questions.filter((q) => q.status === "unknown").length,
          answered: written.brief.questions.filter((q) => q.status === "answered").length,
          orphaned_answers: written.orphanCount,
          questions,
        });
      } catch (error) {
        fail(error);
      }
    });

  kb.command("land")
    .description("Land one developer-confirmed interview answer as a source=interview Discovery")
    .requiredOption("--brief <sha>", "brief_sha the question was asked from (from 'kb brief')")
    .requiredOption("--target <id>", "Entity asked about: asserts URI or id from the brief, or dp:a0/system")
    .requiredOption("--slot <slot>", "in_scope | actor_kind | data_categories | purpose")
    .requiredOption("--value <value>", "Ontology value (data_categories: comma list or JSON array)")
    .requiredOption("--reviewer <email>", "The developer who confirmed this answer")
    .requiredOption("--evidence <path>", "Unedited interview transcript (relative to the KB dir, or absolute)")
    .requiredOption("--skill-sha <sha>", "Full SHA of the interview skill (e.g. git hash-object SKILL.md)")
    .option("--kb <dir>", "Knowledge base directory", DEFAULT_KB_DIR)
    .option("--dry-run", "Validate without writing")
    .action(
      (options: {
        brief: string;
        target: string;
        slot: string;
        value: string;
        reviewer: string;
        evidence: string;
        skillSha: string;
        kb: string;
        dryRun?: boolean;
      }) => {
        try {
          const landed = landInterviewAnswer(resolveKbPaths(options.kb), {
            briefSha: options.brief,
            target: options.target,
            slot: options.slot,
            value: options.value,
            reviewer: options.reviewer,
            evidence: options.evidence,
            skillSha: options.skillSha,
            dryRun: options.dryRun,
          });
          print({ ok: true, ...landed });
        } catch (error) {
          fail(error);
        }
      },
    );

  kb.command("project")
    .description("Project the KB into diagram.json for the viewer, optionally pushing it to open tabs")
    .option("--kb <dir>", "Knowledge base directory", DEFAULT_KB_DIR)
    .option("--project-name <name>", "System label (default: projectName from the scan)")
    .option("--push", "Send the diagram to the running viewer (diagram bridge)")
    .option("--host <url>", "Viewer origin for --push", "http://localhost:3001")
    .action(async (options: { kb: string; projectName?: string; push?: boolean; host: string }) => {
      try {
        const projected = writeKbDiagram(resolveKbPaths(options.kb), { projectName: options.projectName });
        const pushed = options.push ? await pushKbDiagram(projected.wrapper, options.host) : null;
        print({
          ok: pushed ? pushed.ok : true,
          diagram_path: projected.path,
          nodes: projected.wrapper.graph.nodes.length,
          edges: projected.wrapper.graph.edges.length,
          ...projected.wrapper.metadata,
          ...(pushed ? { push: pushed } : {}),
        });
        if (pushed && !pushed.ok) process.exitCode = 1;
      } catch (error) {
        fail(error);
      }
    });
}
