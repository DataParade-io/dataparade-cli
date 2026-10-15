import { omitInternalImplementationNodes } from '../../../src/core/pipeline/omit-internal-implementation';

const nestSource = `
import { Injectable } from "@nestjs/common";

@Injectable()
export class AssetContextService {
  findAll() {}
}
`;

const directusSource = `
export class UsersService extends ItemsService {
  constructor() {
    super("directus_users", {});
  }
}
`;

describe('omitInternalImplementationNodes', () => {
  const readSource = (filePath: string) => {
    if (filePath.endsWith('asset-context.service.ts')) return nestSource;
    if (filePath.endsWith('users.ts')) return directusSource;
    return undefined;
  };

  it('drops NestJS service classes and bare HTTP clients, and keeps named services', () => {
    const result = omitInternalImplementationNodes(
      [
        {
          id: 'hub',
          name: 'backend',
          type: 'asset',
          subType: 'application',
          properties: { isMainApplication: true, section_id: 'backend' },
        },
        {
          id: 'asset-context',
          name: 'Assetcontext',
          type: 'asset',
          subType: 'service',
          detectedFrom: [{ pattern: 'auth_middleware' }],
          sourceLocations: [
            {
              filePath: 'backend/src/diagrams/services/asset-context.service.ts',
              startLine: 5,
            },
          ],
          properties: { section_id: 'backend' },
        },
        {
          id: 'users',
          name: 'Users',
          type: 'asset',
          subType: 'service',
          detectedFrom: [{ pattern: 'auth_middleware' }],
          sourceLocations: [
            { filePath: 'api/src/services/users.ts', startLine: 2 },
          ],
          properties: { section_id: 'backend' },
        },
        {
          id: 'axios',
          name: 'Axios Call',
          type: 'asset',
          subType: 'api',
          properties: { client: 'axios', section_id: 'backend' },
        },
        {
          id: 'sendgrid',
          name: 'Sendgrid',
          type: 'third_party',
          properties: { serviceName: 'sendgrid', client: 'axios', section_id: 'backend' },
        },
      ],
      [
        {
          id: 'flow-service',
          sourceComponentId: 'hub',
          targetComponentId: 'asset-context',
          type: 'api_call',
        },
        {
          id: 'flow-users',
          sourceComponentId: 'hub',
          targetComponentId: 'users',
          type: 'api_call',
        },
        {
          id: 'flow-axios',
          sourceComponentId: 'hub',
          targetComponentId: 'axios',
          type: 'api_call',
        },
        {
          id: 'flow-sendgrid',
          sourceComponentId: 'axios',
          targetComponentId: 'sendgrid',
          type: 'api_call',
        },
      ],
      { readSource }
    );

    expect(result.components.map((component) => component.name).sort()).toEqual([
      'Sendgrid',
      'Users',
      'backend',
    ]);
    expect(result.dataFlows.map((flow) => [flow.sourceComponentId, flow.targetComponentId])).toEqual([
      ['hub', 'users'],
      ['hub', 'sendgrid'],
    ]);
  });

  it('keeps a service class when its source file cannot be read', () => {
    const result = omitInternalImplementationNodes(
      [
        {
          id: 'svc',
          name: 'Assetcontext',
          type: 'asset',
          subType: 'service',
          detectedFrom: [{ pattern: 'auth_middleware' }],
          sourceLocations: [
            { filePath: 'src/services/asset-context.service.ts', startLine: 1 },
          ],
        },
      ],
      [],
      { readSource: () => undefined }
    );

    expect(result.components).toHaveLength(1);
  });
});
