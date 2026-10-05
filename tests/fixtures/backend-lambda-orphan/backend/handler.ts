import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * Minimal AWS Lambda handler fixture: intentional lone handler in a backend
 * section so the CLI absorb pass can inject Aws Lambda + section hub wiring.
 */
export const handler = async (
  _event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true }),
  };
};
