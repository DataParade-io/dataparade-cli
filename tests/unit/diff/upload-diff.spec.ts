import fs from "fs";
import os from "os";
import path from "path";

import { describeUploadedComparison, uploadDiffScans, type UploadFn } from "../../../src/diff/upload-diff";

describe("diff --upload (DATAP-886, DATAP-890)", () => {
  let work: string;
  const BASE = "b".repeat(40);
  const HEAD = "c".repeat(40);
  const ROOT = "a".repeat(40);
  const renames = [{ from: "mailer.ts", to: "email.ts", similarity: 92 }];

  const writeScan = (dir: string, commit: string) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "dataflow.json"), JSON.stringify({ metadata: { projectName: "shop" }, commit }));
    fs.writeFileSync(path.join(dir, "facts.json"), JSON.stringify({ schemaVersion: 1, scan: { stamps: { commitSha: commit } } }));
  };

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "upload-diff-"));
    writeScan(path.join(work, "base"), BASE);
    writeScan(path.join(work, "head"), HEAD);
  });
  afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

  const result = () => ({
    baseSha: BASE,
    headSha: HEAD,
    rootCommit: ROOT,
    renames,
    scanDirs: { base: path.join(work, "base"), head: path.join(work, "head") },
  });

  const stored = (scanId: string, comparison?: unknown) => ({ stored: true, scanId, repositoryId: "repo-1", created: true, comparable: true, ...(comparison ? { comparison } : {}) });

  it("uploads the base, then the head with the rename map and root commit", async () => {
    const comparison = {
      compared: true,
      created: true,
      comparison: { id: "cmp-1", changeSet: { renames: "applied" } },
      bindings: [
        { answerId: "a1", status: "carried", reason: "unchanged" },
        { answerId: "a2", status: "carried", reason: "renamed" },
        { answerId: "a3", status: "reopened", reason: "neighbours_changed" },
      ],
      summary: "renamed: 1 component",
    };
    const upload = jest
      .fn()
      .mockResolvedValueOnce({ draftId: "d-base", complete: stored("s-base") })
      .mockResolvedValueOnce({ draftId: "d-head", complete: stored("s-head", comparison) });

    const uploaded = await uploadDiffScans({ apiKey: "key", repo: work, result: result(), upload: upload as unknown as UploadFn });

    expect(upload).toHaveBeenCalledTimes(2);
    const [baseCall, headCall] = upload.mock.calls.map((call) => call[0]);
    expect(baseCall).toMatchObject({ apiKey: "key", projectName: "shop", command: "upload", dataflow: { commit: BASE } });
    expect(baseCall.compare).toBeUndefined();
    expect(baseCall.files.map((f: { relativePath: string }) => f.relativePath)).toEqual(["facts.json"]);
    expect(headCall).toMatchObject({ dataflow: { commit: HEAD }, compare: { baseCommitSha: BASE, rootCommitSha: ROOT, renames } });
    expect(uploaded.comparison).toEqual(comparison);
    expect(describeUploadedComparison(uploaded)).toBe("Stored comparison cmp-1 (answers: 2 carried, 1 reopened).");
  });

  it("says why the backend did not compare", async () => {
    const upload = jest
      .fn()
      .mockResolvedValueOnce({ draftId: "d-base", complete: stored("s-base") })
      .mockResolvedValueOnce({ draftId: "d-head", complete: stored("s-head", { compared: false, reason: "stamps_differ", message: "different cliVersion" }) });
    const uploaded = await uploadDiffScans({ apiKey: "key", repo: work, result: result(), upload: upload as unknown as UploadFn });
    expect(describeUploadedComparison(uploaded)).toBe("The backend did not compare the scans (stamps_differ): different cliVersion");
  });

  it("says when a scan was not stored", async () => {
    const upload = jest
      .fn()
      .mockResolvedValueOnce({ draftId: "d-base", complete: { stored: false, reason: "no_repository_identity" } })
      .mockResolvedValueOnce({ draftId: "d-head", complete: null });
    const uploaded = await uploadDiffScans({ apiKey: "key", repo: work, result: result(), upload: upload as unknown as UploadFn });
    expect(uploaded.comparison).toBeNull();
    expect(describeUploadedComparison(uploaded)).toBe("The base scan was uploaded but not stored for comparison (no_repository_identity).");
  });

  it("needs the kept scans", async () => {
    await expect(uploadDiffScans({ apiKey: "key", repo: work, result: { ...result(), scanDirs: undefined }, upload: jest.fn() })).rejects.toThrow("kept no scans");
  });
});
