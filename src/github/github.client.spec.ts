import {
  GithubClient,
  GithubGraphqlError,
  type GithubOctokit,
} from './github.client.js';

function clientReturning(data: unknown) {
  const request = vi.fn().mockResolvedValue({ status: 200, data, headers: {} });
  const client = new GithubClient({ request } as unknown as GithubOctokit);
  return { client, request };
}

describe('GithubClient.graphql', () => {
  it('posts the query and variables and returns data', async () => {
    const { client, request } = clientReturning({
      data: { viewer: { login: 'x' } },
    });

    await expect(
      client.graphql('query { viewer { login } }', { a: 1 }),
    ).resolves.toEqual({
      viewer: { login: 'x' },
    });
    expect(request).toHaveBeenCalledWith('POST /graphql', {
      query: 'query { viewer { login } }',
      variables: { a: 1 },
    });
  });

  it('throws GithubGraphqlError when the 200 response carries errors', async () => {
    const { client } = clientReturning({
      data: { repository: null },
      errors: [
        { type: 'NOT_FOUND', message: 'Could not resolve to a Repository' },
      ],
    });

    const err = await client.graphql('query { x }').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GithubGraphqlError);
    expect((err as GithubGraphqlError).errors[0].type).toBe('NOT_FOUND');
  });

  it('throws when the response has no data and no errors', async () => {
    const { client } = clientReturning({ message: 'Server Error' });
    await expect(client.graphql('query { x }')).rejects.toThrow(
      /neither data nor errors \(HTTP 200\): {"message":"Server Error"}/,
    );
  });

  it('reports an empty body with its status instead of crashing', async () => {
    const { client } = clientReturning(undefined);
    await expect(client.graphql('query { x }')).rejects.toThrow(
      /neither data nor errors \(HTTP 200\): undefined/,
    );
  });

  it('includes a non-JSON body, truncated, in the error', async () => {
    const { client } = clientReturning(`<html>${'x'.repeat(1000)}</html>`);
    const err = (await client.graphql('query { x }').catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/\(HTTP 200\): "<html>x+/);
    expect(err.message.length).toBeLessThan(400);
  });
});
