import {ValidationError} from '../cloud-spi/errors'
import {
    CloudFormationClient,
    CreateStackCommand,
    DeleteStackCommand,
    DescribeStacksCommand,
    type Capability,
    type Stack,
} from '@aws-sdk/client-cloudformation'
import {cloudformation as defaultCloudFormation} from '../aws'
import {awsCloudFormationSchema} from '../cloud-spi/cloudformationSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

export class AwsCloudFormationAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'iac' as const

    constructor(private readonly client: CloudFormationClient = defaultCloudFormation) {}

    schema(): ServiceSchema {
        return awsCloudFormationSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const res = await this.client.send(new DescribeStacksCommand({}))
        const resources: CloudResource[] = (res.Stacks ?? []).map((stack) => mapStackToResource(stack))
        return filterBySearch(resources, query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        try {
            const res = await this.client.send(new DescribeStacksCommand({StackName: id}))
            const stack = res.Stacks?.[0]
            if (!stack) return null
            return mapStackToResource(stack)
        } catch (error) {
            if (isStackNotFoundError(error)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const values = input.values
        const stackName = stringValue(values.stackName ?? values.name)
        const templateBody = stringValue(values.templateBody)
        const templateUrl = stringValue(values.templateUrl)
        const capabilitiesInput = values.capabilities

        if (!stackName) throw new ValidationError('stackName is required')
        if (!isValidStackName(stackName)) {
            throw new ValidationError('Stack name must begin with an alphabetic character and contain only letters, numbers, and hyphens.')
        }
        if (!templateBody && !templateUrl) {
            throw new ValidationError('templateBody or templateUrl is required')
        }
        if (templateBody && templateUrl) {
            throw new ValidationError('Specify either templateBody or templateUrl, not both.')
        }

        const capabilities = parseCapabilities(capabilitiesInput)

        const res = await this.client.send(
            new CreateStackCommand({
                StackName: stackName,
                TemplateBody: templateBody || undefined,
                TemplateURL: templateUrl || undefined,
                Capabilities: capabilities.length > 0 ? capabilities : undefined,
            }),
        )

        const region = stringValue(values.region) || extractRegion(res.StackId)

        return {
            id: stackName,
            name: stackName,
            cloud: 'aws',
            service: 'iac',
            type: 'stack',
            region,
            createdAt: new Date().toISOString(),
            status: 'CREATE_IN_PROGRESS',
            metadata: {
                provider: 'aws',
                stackId: res.StackId ?? null,
                description: null,
                capabilities: capabilities.length > 0 ? capabilities : undefined,
                parameters: [],
                outputs: [],
                tags: [],
            },
        }
    }

    async delete(id: string): Promise<void> {
        if (!id) throw new ValidationError('Stack name or ID is required')
        await this.client.send(new DeleteStackCommand({StackName: id}))
    }
}

function mapStackToResource(stack: Stack): CloudResource {
    const stackName = stack.StackName ?? ''
    return {
        id: stackName,
        name: stackName,
        cloud: 'aws',
        service: 'iac',
        type: 'stack',
        region: extractRegion(stack.StackId),
        createdAt: stack.CreationTime?.toISOString() ?? null,
        status: stack.StackStatus ?? null,
        metadata: {
            provider: 'aws',
            stackId: stack.StackId,
            description: stack.Description ?? null,
            updatedAt: stack.LastUpdatedTime?.toISOString() ?? null,
            stackStatusReason: stack.StackStatusReason ?? null,
            disableRollback: stack.DisableRollback ?? null,
            enableTerminationProtection: stack.EnableTerminationProtection ?? null,
            timeoutInMinutes: stack.TimeoutInMinutes ?? null,
            capabilities: stack.Capabilities ?? [],
            parameters: stack.Parameters ?? [],
            outputs: stack.Outputs ?? [],
            tags: (stack.Tags ?? []).map((t) => ({
                key: t.Key ?? '',
                value: t.Value ?? '',
            })),
        },
    }
}

function extractRegion(stackId?: string | null): string {
    if (stackId && stackId.startsWith('arn:')) {
        const parts = stackId.split(':')
        if (parts[3]) {
            return parts[3]
        }
    }
    return process.env.AWS_REGION || 'us-east-1'
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function isValidStackName(value: string): boolean {
    return /^[a-zA-Z][-a-zA-Z0-9]{0,127}$/.test(value)
}

function parseCapabilities(value: unknown): Capability[] {
    if (Array.isArray(value)) {
        return value.map((item) => String(item).trim() as Capability).filter(Boolean)
    }
    if (typeof value === 'string' && value.trim()) {
        return value
            .split(',')
            .map((item) => item.trim() as Capability)
            .filter(Boolean)
    }
    return []
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}

function isStackNotFoundError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    const err = error as {name?: string; message?: string; $metadata?: {httpStatusCode?: number}}
    if (err.$metadata?.httpStatusCode === 404) return true
    if (err.name === 'ValidationError' || err.name === 'ResourceNotFoundException') {
        const msg = (err.message ?? '').toLowerCase()
        if (msg.includes('does not exist') || msg.includes('not found')) {
            return true
        }
    }
    return false
}
