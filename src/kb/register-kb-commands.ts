import type { Command } from "commander";

import { DEFAULT_OUTPUT_DIRNAME } from "../facts/layout";
import { writeKbBrief } from "./brief";
import { KbError, resolveKbPaths } from "./kb-store";
import { migrateInterviewRecords } from "./migrate";
import { landInterviewAnswer, landReviewAnswer } from "./land";
import { pushKbDiagram, writeKbDiagram } from "./project-diagram";
import { SlotValueError } from "./slot-shapes";

const DEFAULT_KB_DIR = DEFAULT_OUTPUT_DIRNAME;

/** All kb commands print one JSON object so agents can parse results. */
function print(result: unknown): void {
   
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
    .description("Knowledge base: interview briefs, confirmed answers (answers.json), and diagram projection");

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
    .description("Land one confirmed answer in answers.json: an interview answer, or a reviewer's set/remove of a Fact")
    .option("--source <source>", "interview (default) or review", "interview")
    .option("--brief <sha>", "interview: brief_sha the question was asked from (from 'kb brief')")
    .requiredOption("--target <id>", "The Fact asked about: its id from the brief or facts.json, or dp:a0/system")
    .option("--slot <slot>", "interview: in_scope | actor_kind | data_categories | purpose")
    .option("--action <action>", "review: set (default) or remove", "set")
    .option("--property <name>", "review set: the property to override")
    .option("--value <value>", "The value (interview data_categories: comma list or JSON array)")
    .requiredOption("--reviewer <email>", "The developer who confirmed this answer")
    .option("--evidence <path>", "interview: unedited transcript (relative to the KB dir, or absolute); review: a note or path")
    .option("--skill-sha <sha>", "interview: full SHA of the interview skill (e.g. git hash-object SKILL.md)")
    .option("--kb <dir>", "Knowledge base directory", DEFAULT_KB_DIR)
    .option("--dry-run", "Validate without writing")
    .action(
      (options: {
        source: string;
        brief?: string;
        target: string;
        slot?: string;
        action: string;
        property?: string;
        value?: string;
        reviewer: string;
        evidence?: string;
        skillSha?: string;
        kb: string;
        dryRun?: boolean;
      }) => {
        try {
          const paths = resolveKbPaths(options.kb);
          if (options.source === "review") {
            if (options.action !== "set" && options.action !== "remove") {
              throw new KbError("BAD_ANSWER", `--action must be set or remove; got '${options.action}'.`);
            }
            print({
              ok: true,
              ...landReviewAnswer(paths, {
                target: options.target,
                action: options.action,
                property: options.property ?? options.slot,
                value: options.value,
                reviewer: options.reviewer,
                evidence: options.evidence,
                dryRun: options.dryRun,
              }),
            });
            return;
          }
          if (options.source !== "interview") {
            throw new KbError("BAD_ANSWER", `--source must be interview or review; got '${options.source}'.`);
          }
          for (const [flag, value] of [
            ["--brief", options.brief],
            ["--slot", options.slot],
            ["--value", options.value],
            ["--evidence", options.evidence],
            ["--skill-sha", options.skillSha],
          ] as const) {
            if (!value) throw new KbError("BAD_ANSWER", `${flag} is required for an interview answer.`);
          }
          print({
            ok: true,
            ...landInterviewAnswer(paths, {
              briefSha: options.brief as string,
              target: options.target,
              slot: options.slot as string,
              value: options.value as string,
              reviewer: options.reviewer,
              evidence: options.evidence as string,
              skillSha: options.skillSha as string,
              dryRun: options.dryRun,
            }),
          });
        } catch (error) {
          fail(error);
        }
      },
    );

  kb.command("migrate")
    .description("Convert interview records from an old ocsf-discoveries/ folder (CLI 0.0.26 and earlier) into answers.json")
    .option("--kb <dir>", "Knowledge base directory", DEFAULT_KB_DIR)
    .option("--from <dir>", "Old OCSF folder (default: <kb>/ocsf-discoveries)")
    .option("--dry-run", "Count what would be migrated without writing")
    .action((options: { kb: string; from?: string; dryRun?: boolean }) => {
      try {
        print({ ok: true, ...migrateInterviewRecords(resolveKbPaths(options.kb), { from: options.from, dryRun: options.dryRun }) });
      } catch (error) {
        fail(error);
      }
    });

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
