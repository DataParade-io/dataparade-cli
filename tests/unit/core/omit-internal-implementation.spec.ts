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
              filePath:
                'backend/src/diagrams/services/asset-context.service.ts',
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
          properties: {
            serviceName: 'sendgrid',
            client: 'axios',
            section_id: 'backend',
          },
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

    expect(result.components.map((component) => component.name).sort()).toEqual(
      ['Sendgrid', 'Users', 'backend']
    );
    expect(
      result.dataFlows.map((flow) => [
        flow.sourceComponentId,
        flow.targetComponentId,
      ])
    ).toEqual([
      ['hub', 'users'],
      ['hub', 'sendgrid'],
    ]);
  });

  it('keeps section hubs that were promoted from a service class or an HTTP call', () => {
    const result = omitInternalImplementationNodes(
      [
        {
          id: 'backend',
          name: 'backend',
          type: 'asset',
          subType: 'service',
          detectedFrom: [{ pattern: 'auth_middleware' }],
          sourceLocations: [
            {
              filePath:
                'backend/src/diagrams/services/asset-context.service.ts',
              startLine: 5,
            },
          ],
          properties: { isMainApplication: true, section_id: 'backend' },
        },
        {
          id: 'lambdas',
          name: 'lambdas',
          type: 'asset',
          subType: 'api',
          properties: {
            isMainApplication: 'true',
            client: 'axios',
            section_id: 'backend/lambdas',
          },
        },
        {
          id: 'customer',
          name: 'Customer',
          type: 'actor',
          properties: { section_id: 'backend' },
        },
      ],
      [
        {
          sourceComponentId: 'customer',
          targetComponentId: 'backend',
          type: 'user_interaction',
        },
      ],
      { readSource }
    );

    expect(result.components.map((component) => component.id)).toEqual([
      'backend',
      'lambdas',
      'customer',
    ]);
    expect(result.dataFlows).toHaveLength(1);
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
