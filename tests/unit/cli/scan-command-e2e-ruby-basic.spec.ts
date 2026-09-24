import fs from 'fs';
import os from 'os';
import path from 'path';

import { run } from '../../../src/cli';
import { validateDataflowJson } from '../../../src/core/schema/dataflow-wrapper.schema';

describe('cli scan command - Ruby basic', () => {
  it('emits runtime boundaries without model components', async () => {
    const fixturesRoot = path.join(
      __dirname,
      '..',
      '..',
      'fixtures',
      'ruby-basic'
    );
    const outputPath = path.join(
      os.tmpdir(),
      `dataparade-scan-e2e-ruby-basic-${Date.now()}.json`
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

    const validation = validateDataflowJson(
      JSON.parse(fs.readFileSync(outputPath, 'utf8'))
    );
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;

    const nodes = validation.value.graph.nodes;
    expect(
      nodes.filter((node) => {
        const data = node.data as any;
        return (
          data.componentType === 'asset' && data.componentSubType === 'database'
        );
      })
    ).toHaveLength(1);
    expect(
      nodes.filter((node) => {
        const data = node.data as any;
        return (
          data.componentType === 'asset' && data.componentSubType === 'api'
        );
      })
    ).toHaveLength(1);
    expect(
      nodes.some((node) => {
        const data = node.data as any;
        return (
          data.componentType === 'third_party' && data.serviceName === 'stripe'
        );
      })
    ).toBe(true);
    expect(
      nodes.some((node) => ['User', 'Post'].includes(String(node.data.label)))
    ).toBe(false);
    expect(
      validation.value.graph.edges.some((edge) => edge.source === edge.target)
    ).toBe(false);

    fs.unlinkSync(outputPath);
  }, 15000);
});
