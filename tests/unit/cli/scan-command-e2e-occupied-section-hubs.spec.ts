import fs from 'fs';
import os from 'os';
import path from 'path';

import { run } from '../../../src/cli';
import { validateDataflowJson } from '../../../src/core/schema/dataflow-wrapper.schema';

describe('cli scan command - occupied section hubs', () => {
  it('gives every non-empty service section a main-app hub and hub→third_party edges', async () => {
    const fixturesRoot = path.join(
      __dirname,
      '..',
      '..',
      'fixtures',
      'tooling-third-party-only'
    );

    const outputPath = path.join(
      os.tmpdir(),
      `dataparade-scan-e2e-occupied-section-hubs-${Date.now()}.json`
    );

    await run([
      'node',
      'cli',
      'scan',
      fixturesRoot,
      '--output',
      outputPath,
      '--no-ai-inference',
      '--skip-auto-upload',
    ]);

    const contents = fs.readFileSync(outputPath, 'utf8');
    const parsed = JSON.parse(contents);
    const validation = validateDataflowJson(parsed);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;

    const { graph } = validation.value;
    const sectionIds = new Set(
      graph.nodes
        .map((n: any) => n?.data?.section_id)
        .filter((v: unknown) => typeof v === 'string' && v.trim().length > 0)
    );

    for (const sectionId of sectionIds) {
      if (
        sectionId === 'root' ||
        sectionId === 'global' ||
        sectionId === '<unsectioned>'
      ) {
        continue;
      }
      const sectionNodes = graph.nodes.filter(
        (n: any) => n?.data?.section_id === sectionId
      );
      if (sectionNodes.length === 0) continue;

      const hubs = sectionNodes.filter(
        (n: any) =>
          n?.data?.isMainApplication === true ||
          n?.data?.isMainApplication === 'true'
      );
      expect(hubs.length).toBeGreaterThanOrEqual(1);

      const thirdParties = sectionNodes.filter(
        (n: any) =>
          n?.type === 'third_party' || n?.type === 'third_party_service'
      );
      if (thirdParties.length === 0) continue;

      const hubIds = new Set(hubs.map((h: any) => h.id));
      for (const tp of thirdParties) {
        const linked = graph.edges.some(
          (e: any) => hubIds.has(e.source) && e.target === tp.id
        );
        expect(linked).toBe(true);
      }
    }

    fs.unlinkSync(outputPath);
  }, 20000);
});
