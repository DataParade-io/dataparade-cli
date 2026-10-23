import {
  buildTeachingLineGroups,
  flattenTeachingLines,
} from '../../../src/ui/teaching-lines';
import type { DetectedComponent, RawFinding } from '../../../src/core/types';

function finding(
  pattern: RawFinding['pattern'],
  properties: Record<string, unknown>
): RawFinding {
  return {
    pattern,
    name: pattern,
    confidence: 0.9,
    location: { filePath: 'x.ts', startLine: 1, endLine: 1 },
    properties,
  };
}

function thirdParty(serviceName: string): DetectedComponent {
  return {
    id: `tp-${serviceName}`,
    name: serviceName,
    type: 'third_party',
    confidence: 0.9,
    detectedFrom: [],
    properties: { serviceName },
    sourceLocations: [],
  };
}

describe('buildTeachingLineGroups', () => {
  it('counts routes by framework', () => {
    const groups = buildTeachingLineGroups(
      [
        finding('express_route', { framework: 'express' }),
        finding('express_route', { framework: 'express' }),
        finding('express_route', { framework: 'nest' }),
      ],
      []
    );
    expect(groups.routes).toEqual([
      'Found 2 Express routes',
      'Found 1 Nest route',
    ]);
  });

  it('formats data stores from client and databaseType without inventing Postgres', () => {
    const groups = buildTeachingLineGroups(
      [
        finding('database_connection', {
          client: 'typeorm',
          databaseType: 'sql',
        }),
        finding('database_connection', {
          client: 'pg',
          databaseType: 'postgres',
        }),
      ],
      []
    );
    expect(groups.stores).toEqual([
      'Talks to SQL (TypeORM)',
      'Talks to Postgres (pg)',
    ]);
  });

  it('coalesces outbound vendors from components and external_api_call findings', () => {
    const groups = buildTeachingLineGroups(
      [finding('external_api_call', { serviceName: 'sentry' })],
      [thirdParty('stripe'), thirdParty('Stripe'), thirdParty('openai')]
    );
    expect(groups.outbound).toEqual([
      'Calls out to OpenAI, Sentry, and Stripe',
    ]);
  });

  it('returns empty groups when nothing recognized', () => {
    const groups = buildTeachingLineGroups([], []);
    expect(flattenTeachingLines(groups)).toEqual([]);
  });

  it('counts every Next.js spelling as one framework and skips manifest hints', () => {
    const groups = buildTeachingLineGroups(
      [
        finding('express_route', { framework: 'next_or_react_route' }),
        finding('express_route', { framework: 'nextjs' }),
        finding('express_route', { framework: 'next' }),
        finding('express_route', {
          framework: 'nextjs',
          sourceContext: 'dependency_manifest',
        }),
      ],
      []
    );
    expect(groups.routes).toEqual(['Found 3 Next.js routes']);
  });

  it('turns underscores in vendor names into title-cased words', () => {
    const groups = buildTeachingLineGroups(
      [],
      [thirdParty('Google_identity'), thirdParty('stripe')]
    );
    expect(groups.outbound).toEqual(['Calls out to Google Identity and Stripe']);
  });
});

