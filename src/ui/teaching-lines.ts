import type { DetectedComponent, RawFinding } from '../core/types';
import type { TeachingLineGroups } from './types';

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function titleCaseToken(token: string): string {
  if (!token) return token;
  if (token === token.toUpperCase() && token.length <= 4) return token;
  return token.charAt(0).toUpperCase() + token.slice(1);
}

function prettyFramework(framework: string): string {
  const lower = framework.toLowerCase();
  if (lower === 'express') return 'Express';
  if (lower === 'nest') return 'Nest';
  if (lower === 'next_or_react_route') return 'Next.js';
  if (lower === 'fastapi') return 'FastAPI';
  if (lower === 'flask') return 'Flask';
  if (lower === 'django') return 'Django';
  return titleCaseToken(framework.replace(/_/g, ' '));
}

function prettyClient(client: string): string {
  const lower = client.toLowerCase();
  if (lower === 'typeorm') return 'TypeORM';
  if (lower === 'prisma') return 'Prisma';
  if (lower === 'mongoose') return 'Mongoose';
  if (lower === 'psycopg2' || lower === 'psycopg') return 'psycopg';
  if (lower === 'pg') return 'pg';
  if (lower === 'knex') return 'Knex';
  return titleCaseToken(client);
}

function prettyDatabaseType(databaseType: string): string {
  const lower = databaseType.toLowerCase();
  if (lower === 'postgres' || lower === 'postgresql') return 'Postgres';
  if (lower === 'mysql') return 'MySQL';
  if (lower === 'mongodb' || lower === 'mongo') return 'MongoDB';
  if (lower === 'sqlite') return 'SQLite';
  if (lower === 'redis') return 'Redis';
  if (lower === 'sql') return 'SQL';
  return titleCaseToken(databaseType);
}

function prettyVendor(serviceName: string): string {
  const lower = serviceName.toLowerCase();
  const known: Record<string, string> = {
    stripe: 'Stripe',
    sendgrid: 'Sendgrid',
    sentry: 'Sentry',
    openai: 'OpenAI',
    aws: 'AWS',
    auth0: 'Auth0',
  };
  if (known[lower]) return known[lower];
  return titleCaseToken(serviceName);
}

/**
 * Build teaching lines from deterministic findings/components.
 * Empty groups are omitted by the renderer.
 */
export function buildTeachingLineGroups(
  findings: RawFinding[],
  components: DetectedComponent[]
): TeachingLineGroups {
  const routeCounts = new Map<string, number>();
  for (const finding of findings) {
    if (finding.pattern !== 'express_route') continue;
    const framework = asString(finding.properties?.framework) ?? 'framework';
    routeCounts.set(framework, (routeCounts.get(framework) ?? 0) + 1);
  }

  const routes = [...routeCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([framework, count]) => {
      const name = prettyFramework(framework);
      return count === 1
        ? `Found 1 ${name} route`
        : `Found ${count} ${name} routes`;
    });

  const storeKeys = new Set<string>();
  const stores: string[] = [];
  for (const finding of findings) {
    if (finding.pattern !== 'database_connection') continue;
    const client = asString(finding.properties?.client) ?? 'database';
    const databaseType = asString(finding.properties?.databaseType) ?? 'SQL';
    const key = `${client}|${databaseType}`;
    if (storeKeys.has(key)) continue;
    storeKeys.add(key);
    stores.push(
      `Talks to ${prettyDatabaseType(databaseType)} (${prettyClient(client)})`
    );
  }

  const vendorNames = new Set<string>();
  for (const component of components) {
    if (component.type !== 'third_party') continue;
    const serviceName = asString(component.properties?.serviceName);
    if (serviceName) vendorNames.add(serviceName.toLowerCase());
  }
  for (const finding of findings) {
    if (finding.pattern !== 'external_api_call') continue;
    const serviceName = asString(finding.properties?.serviceName);
    if (serviceName) vendorNames.add(serviceName.toLowerCase());
  }

  const outboundSorted = [...vendorNames].sort((a, b) => a.localeCompare(b));
  const outboundLabels = outboundSorted.map(prettyVendor);
  const outbound =
    outboundLabels.length === 0
      ? []
      : outboundLabels.length === 1
        ? [`Calls out to ${outboundLabels[0]}`]
        : outboundLabels.length === 2
          ? [`Calls out to ${outboundLabels[0]} and ${outboundLabels[1]}`]
          : [
              `Calls out to ${outboundLabels.slice(0, -1).join(', ')}, and ${outboundLabels[outboundLabels.length - 1]}`,
            ];

  return { routes, stores, outbound };
}

/** Flatten groups into display strings (without the leading bullet). */
export function flattenTeachingLines(groups: TeachingLineGroups): string[] {
  return [...groups.routes, ...groups.stores, ...groups.outbound];
}
