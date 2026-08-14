import {describe, expect, test} from 'bun:test'
import {AwsCloudFormationAdapter} from './AwsCloudFormationAdapter'
import {
    CloudFormationClient,
    CreateStackCommand,
    DeleteStackCommand,
    DescribeStacksCommand,
    type Stack,
} from '@aws-sdk/client-cloudformation'

const baseStack: Stack = {
    StackId: 'arn:aws:cloudformation:us-east-1:000000000000:stack/my-stack/12345678',
    StackName: 'my-stack',
    Description: 'Sample CloudFormation stack',
    StackStatus: 'CREATE_COMPLETE',
    CreationTime: new Date('2026-01-01T00:00:00.000Z'),
    LastUpdatedTime: new Date('2026-01-02T00:00:00.000Z'),
    Capabilities: ['CAPABILITY_IAM'],
    Parameters: [{ParameterKey: 'Env', ParameterValue: 'dev'}],
    Outputs: [{OutputKey: 'Endpoint', OutputValue: 'http://localhost:4566'}],
    Tags: [{Key: 'Owner', Value: 'Admin'}],
}

function fakeClient(handler: (command: unknown) => Promise<unknown>): CloudFormationClient {
    return {
        send: async (command: unknown) => handler(command),
    } as unknown as CloudFormationClient
}

describe('AwsCloudFormationAdapter', () => {
    test('identifies itself as the AWS IaC adapter', () => {
        const adapter = new AwsCloudFormationAdapter(fakeClient(async () => ({})))
        expect(adapter.cloud).toBe('aws')
        expect(adapter.service).toBe('iac')
    })

    test('schema returns AWS CloudFormation schema with available capabilities', () => {
        const adapter = new AwsCloudFormationAdapter(fakeClient(async () => ({})))
        const schema = adapter.schema()

        expect(schema.cloud).toBe('aws')
        expect(schema.service).toBe('iac')
        expect(schema.displayName).toBe('CloudFormation')
        expect(schema.actions).toEqual(['list', 'inspect', 'create', 'delete'])
        expect(schema.columns.map((c) => c.name)).toContain('name')
        expect(schema.columns.map((c) => c.name)).toContain('status')
    })

    test('lists stacks and exposes metadata', async () => {
        const client = fakeClient(async (command) => {
            if (command instanceof DescribeStacksCommand) {
                return {Stacks: [baseStack]}
            }
            throw new Error('Unexpected command')
        })

        const adapter = new AwsCloudFormationAdapter(client)
        const resources = await adapter.list()

        expect(resources).toHaveLength(1)
        expect(resources[0].id).toBe('my-stack')
        expect(resources[0].name).toBe('my-stack')
        expect(resources[0].cloud).toBe('aws')
        expect(resources[0].service).toBe('iac')
        expect(resources[0].type).toBe('stack')
        expect(resources[0].region).toBe('us-east-1')
        expect(resources[0].status).toBe('CREATE_COMPLETE')
        expect(resources[0].createdAt).toBe('2026-01-01T00:00:00.000Z')
        expect(resources[0].metadata.description).toBe('Sample CloudFormation stack')
        expect(resources[0].metadata.updatedAt).toBe('2026-01-02T00:00:00.000Z')
        expect(resources[0].metadata.capabilities).toEqual(['CAPABILITY_IAM'])
        expect(resources[0].metadata.outputs).toHaveLength(1)
    })

    test('filters list by search term', async () => {
        const otherStack: Stack = {
            ...baseStack,
            StackName: 'another-stack',
            StackId: 'arn:aws:cloudformation:us-east-1:000000000000:stack/another-stack/87654321',
        }

        const client = fakeClient(async () => ({
            Stacks: [baseStack, otherStack],
        }))

        const adapter = new AwsCloudFormationAdapter(client)
        const result = await adapter.list({search: 'another'})

        expect(result).toHaveLength(1)
        expect(result[0].name).toBe('another-stack')
    })

    test('get returns stack when found', async () => {
        const client = fakeClient(async (command) => {
            if (command instanceof DescribeStacksCommand) {
                expect(command.input.StackName).toBe('my-stack')
                return {Stacks: [baseStack]}
            }
            throw new Error('Unexpected command')
        })

        const adapter = new AwsCloudFormationAdapter(client)
        const result = await adapter.get('my-stack')

        expect(result).not.toBeNull()
        expect(result?.id).toBe('my-stack')
        expect(result?.name).toBe('my-stack')
        expect(result?.status).toBe('CREATE_COMPLETE')
    })

    test('get returns null when stack is not found (ValidationError does not exist)', async () => {
        const notFoundErr = Object.assign(new Error('Stack with id missing-stack does not exist'), {
            name: 'ValidationError',
            $metadata: {httpStatusCode: 400},
        })

        const client = fakeClient(async () => {
            throw notFoundErr
        })

        const adapter = new AwsCloudFormationAdapter(client)
        const result = await adapter.get('missing-stack')

        expect(result).toBeNull()
    })

    test('get returns null when http status is 404', async () => {
        const err = Object.assign(new Error('ResourceNotFound'), {
            $metadata: {httpStatusCode: 404},
        })

        const client = fakeClient(async () => {
            throw err
        })

        const adapter = new AwsCloudFormationAdapter(client)
        const result = await adapter.get('missing-stack')

        expect(result).toBeNull()
    })

    test('get rethrows non-404 errors', async () => {
        const err = Object.assign(new Error('InternalError'), {
            $metadata: {httpStatusCode: 500},
        })

        const client = fakeClient(async () => {
            throw err
        })

        const adapter = new AwsCloudFormationAdapter(client)
        await expect(adapter.get('bad-stack')).rejects.toThrow('InternalError')
    })

    test('create validates required fields', async () => {
        const adapter = new AwsCloudFormationAdapter(fakeClient(async () => ({})))

        await expect(adapter.create({values: {}})).rejects.toThrow('stackName is required')
        await expect(
            adapter.create({values: {stackName: '123-invalid'}}),
        ).rejects.toThrow('Stack name must begin with an alphabetic character')
        await expect(
            adapter.create({values: {stackName: 'valid-stack'}}),
        ).rejects.toThrow('templateBody or templateUrl is required')
    })

    test('create sends CreateStackCommand with templateUrl', async () => {
        let sentCommand: CreateStackCommand | undefined

        const client = fakeClient(async (command) => {
            if (command instanceof CreateStackCommand) {
                sentCommand = command
                return {
                    StackId: 'arn:aws:cloudformation:us-east-1:000000000000:stack/url-stack/8888',
                }
            }
            throw new Error('Unexpected command')
        })

        const adapter = new AwsCloudFormationAdapter(client)
        const result = await adapter.create({
            values: {
                stackName: 'url-stack',
                templateUrl: 'https://s3.amazonaws.com/cf-templates/stack.yaml',
            },
        })

        expect(sentCommand?.input.StackName).toBe('url-stack')
        expect(sentCommand?.input.TemplateURL).toBe('https://s3.amazonaws.com/cf-templates/stack.yaml')
        expect(result.id).toBe('url-stack')
    })

    test('create sends CreateStackCommand and returns resource', async () => {
        let sentCommand: CreateStackCommand | undefined

        const client = fakeClient(async (command) => {
            if (command instanceof CreateStackCommand) {
                sentCommand = command
                return {
                    StackId: 'arn:aws:cloudformation:us-east-1:000000000000:stack/new-stack/9999',
                }
            }
            throw new Error('Unexpected command')
        })

        const adapter = new AwsCloudFormationAdapter(client)
        const result = await adapter.create({
            values: {
                stackName: 'new-stack',
                templateBody: '{"AWSTemplateFormatVersion":"2010-09-09","Resources":{}}',
                capabilities: 'CAPABILITY_IAM, CAPABILITY_NAMED_IAM',
            },
        })

        expect(sentCommand).toBeDefined()
        expect(sentCommand?.input.StackName).toBe('new-stack')
        expect(sentCommand?.input.TemplateBody).toBe('{"AWSTemplateFormatVersion":"2010-09-09","Resources":{}}')
        expect(sentCommand?.input.Capabilities).toEqual(['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM'])

        expect(result.id).toBe('new-stack')
        expect(result.name).toBe('new-stack')
        expect(result.cloud).toBe('aws')
        expect(result.service).toBe('iac')
        expect(result.type).toBe('stack')
        expect(result.region).toBe('us-east-1')
        expect(result.status).toBe('CREATE_IN_PROGRESS')
        expect(result.metadata.stackId).toBe('arn:aws:cloudformation:us-east-1:000000000000:stack/new-stack/9999')
    })

    test('extracts custom region from StackId ARN or explicit region input', async () => {
        const tokyoStack: Stack = {
            ...baseStack,
            StackName: 'tokyo-stack',
            StackId: 'arn:aws:cloudformation:ap-northeast-1:000000000000:stack/tokyo-stack/1111',
        }

        const client = fakeClient(async (command) => {
            if (command instanceof DescribeStacksCommand) {
                return {Stacks: [tokyoStack]}
            }
            if (command instanceof CreateStackCommand) {
                return {
                    StackId: 'arn:aws:cloudformation:eu-west-1:000000000000:stack/eu-stack/2222',
                }
            }
            throw new Error('Unexpected command')
        })

        const adapter = new AwsCloudFormationAdapter(client)
        const listResult = await adapter.list()
        expect(listResult[0].region).toBe('ap-northeast-1')

        const createWithCustomRegion = await adapter.create({
            values: {
                stackName: 'eu-stack',
                templateBody: '{}',
                region: 'sa-east-1',
            },
        })
        expect(createWithCustomRegion.region).toBe('sa-east-1')

        const createWithArnRegion = await adapter.create({
            values: {
                stackName: 'eu-stack',
                templateBody: '{}',
            },
        })
        expect(createWithArnRegion.region).toBe('eu-west-1')
    })

    test('delete sends DeleteStackCommand with stack name', async () => {
        let deletedStackName: string | undefined

        const client = fakeClient(async (command) => {
            if (command instanceof DeleteStackCommand) {
                deletedStackName = command.input.StackName
                return {}
            }
            throw new Error('Unexpected command')
        })

        const adapter = new AwsCloudFormationAdapter(client)
        await adapter.delete('stack-to-delete')

        expect(deletedStackName).toBe('stack-to-delete')
    })
})
