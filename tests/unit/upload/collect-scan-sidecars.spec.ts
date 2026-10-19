import fs from 'fs';
import os from 'os';
import path from 'path';

import { collectScanSidecars } from '../../../src/upload/collect-scan-sidecars';

function fact(entityId: string, slot?: string, value?: string): unknown {
  return {
    dataparade: {
      asserts: `dp:scan/entity/${entityId}`,
      ...(slot ? { asserted_slot: slot, asserted_value: value } : {}),
    },
  };
}

describe('collectScanSidecars', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-sidecars-'));
    fs.writeFileSync(path.join(dir, 'dataflow.json'), '{}\n');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sends graphify only when the file exists, plus the knowledge graph and occurrence facts', () => {
    fs.mkdirSync(path.join(dir, 'graphify-out'));
    fs.writeFileSync(
      path.join(dir, 'graphify-out', 'graph.json'),
      JSON.stringify({ nodes: [{ id: 'src/api.ts' }] })
    );
    fs.writeFileSync(
      path.join(dir, 'dataparade-graph.json'),
      JSON.stringify({
        nodes: [{ id: 'dp::occurrence:email:src/api.ts:4' }],
        links: [
          {
            source: 'dp::occurrence:email:src/api.ts:4',
            target: 'src/api.ts',
            relation: 'occurs_in',
          },
        ],
      })
    );
    const discoveries = path.join(dir, 'ocsf-discoveries');
    fs.mkdirSync(discoveries);
    fs.writeFileSync(
      path.join(discoveries, 'component.json'),
      JSON.stringify(fact('cmp_orders'))
    );
    fs.writeFileSync(
      path.join(discoveries, 'occurrence.json'),
      JSON.stringify(
        fact('occurrence:email:src/api.ts:4', 'file_path', 'src/api.ts')
      )
    );
    fs.writeFileSync(
      path.join(discoveries, 'data-item.json'),
      JSON.stringify(
        fact(
          'data_item:email',
          'occurrence_ids',
          '["occurrence:email:src/api.ts:4"]'
        )
      )
    );

    const sidecars = collectScanSidecars(path.join(dir, 'dataflow.json'));

    expect(sidecars.graphifyGraph).toEqual({ nodes: [{ id: 'src/api.ts' }] });
    expect(sidecars.dataparadeGraph).toMatchObject({
      links: [
        expect.objectContaining({
          relation: 'occurs_in',
          target: 'src/api.ts',
        }),
      ],
    });
    expect(sidecars.facts).toHaveLength(2);
    expect(JSON.stringify(sidecars.facts)).toContain('occurrence:email');
    expect(JSON.stringify(sidecars.facts)).toContain('data_item:email');
    expect(JSON.stringify(sidecars.facts)).not.toContain('cmp_orders');
  });

  it('omits graphify when that file was not written', () => {
    fs.mkdirSync(path.join(dir, 'ocsf-discoveries'));
    const sidecars = collectScanSidecars(path.join(dir, 'dataflow.json'));
    expect(sidecars.graphifyGraph).toBeUndefined();
    expect(sidecars.facts).toEqual([]);
  });
});
