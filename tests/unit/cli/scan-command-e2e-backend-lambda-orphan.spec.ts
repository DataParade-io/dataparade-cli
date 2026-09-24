import fs from 'fs';
import os from 'os';
import path from 'path';

import { run } from '../../../src/cli';
import { validateDataflowJson } from '../../../src/core/schema/dataflow-wrapper.schema';

describe('cli scan command - backend lambda handler absorb', () => {
  it('absorbs the AWS handler into Aws Lambda and wires the section hub', async () => {
    const fixturesRoot = path.join(
      __dirname,
      '..',
      '..',
      'fixtures',
      'backend-lambda-orphan'
    );

    const outputPath = path.join(
      os.tmpdir(),
      `dataparade-scan-e2e-backend-lambda-orphan-${Date.now()}.json`
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

    const { graph, metadata } = validation.value;
    const backendNodes = graph.nodes.filter(
      (n: any) => n?.data?.section_id === 'backend'
    );
    expect(backendNodes.length).toBeGreaterThanOrEqual(1);

    const hubs = backendNodes.filter(
      (n: any) =>
        n?.data?.isMainApplication === true ||
        n?.data?.isMainApplication === 'true'
    );
    expect(hubs.length).toBeGreaterThanOrEqual(1);
    const hubIds = new Set(hubs.map((h: any) => h.id));

    const handlerNodes = backendNodes.filter((n: any) => {
      if (hubIds.has(n.id)) return false;
      const subType = String(
        n?.data?.componentSubType ?? n?.data?.subType ?? ''
      );
      return (
        subType === 'function' || n?.data?.handlerType === 'serverless_handler'
      );
    });
    expect(handlerNodes).toHaveLength(0);

    const lambdaNodes = backendNodes.filter(
      (n: any) =>
        n?.data?.managed_service_key === 'lambda' ||
        (String(n?.data?.componentSubType ?? '') === 'compute_service' &&
          /lambda/i.test(String(n?.data?.label ?? '')))
    );
    expect(lambdaNodes.length).toBeGreaterThanOrEqual(1);
    const lambdaIds = new Set(lambdaNodes.map((n: any) => n.id));

    const hubLinkedToLambda = graph.edges.some(
      (e: any) =>
        (hubIds.has(e.source) && lambdaIds.has(e.target)) ||
        (hubIds.has(e.target) && lambdaIds.has(e.source))
    );
    expect(hubLinkedToLambda).toBe(true);

    const redFlags = (metadata as Record<string, unknown> | undefined)
      ?.redFlags as
      | Array<{ code?: string; sectionId?: string; componentId?: string }>
      | undefined;

    const blocking = (redFlags ?? []).filter(
      (f) =>
        f.sectionId === 'backend' &&
        (f.code === 'missing_section_hub' || f.code === 'disconnected_handler')
    );
    expect(blocking).toHaveLength(0);

    fs.unlinkSync(outputPath);
  }, 30000);
});
