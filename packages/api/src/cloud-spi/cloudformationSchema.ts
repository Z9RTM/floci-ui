import type {CapabilitySchema, CloudProvider, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

const cloudformationColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Stack Name'},
    {name: 'status', label: 'Status', format: 'badge'},
    {name: 'region', label: 'Region'},
    {name: 'description', label: 'Description', path: 'metadata.description'},
    {name: 'createdAt', label: 'Created', format: 'datetime'},
    {name: 'updatedAt', label: 'Updated', path: 'metadata.updatedAt', format: 'datetime'},
]

const cloudformationFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

const cloudformationResourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List stacks', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect stack', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'create', label: 'Create stack', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'delete', label: 'Delete stack', enabled: true, status: 'available', runtimeRequired: true},
]

const cloudformationFields: FieldSchema[] = [
    {
        name: 'stackName',
        label: 'Stack Name',
        type: 'text',
        required: true,
        span: true,
        group: 'Required',
        description: 'Unique name for the CloudFormation stack.',
        validation: {
            pattern: '^[a-zA-Z][-a-zA-Z0-9]*$',
            minLength: 1,
            maxLength: 128,
            message: 'Stack name must begin with an alphabetic character and contain only letters, numbers, and hyphens.',
        },
    },
    {
        name: 'templateBody',
        label: 'Template Body',
        type: 'text',
        required: true,
        span: true,
        group: 'Required',
        description: 'JSON or YAML CloudFormation template.',
        validation: {
            minLength: 1,
            message: 'Provide a CloudFormation template body.',
        },
    },
    {
        name: 'capabilities',
        label: 'Capabilities',
        type: 'text',
        required: false,
        span: true,
        group: 'Optional',
        description: 'Comma-separated capabilities (e.g. CAPABILITY_IAM, CAPABILITY_NAMED_IAM, CAPABILITY_AUTO_EXPAND).',
    },
]

export function awsCloudFormationSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'iac',
        displayName: 'CloudFormation',
        fields: cloudformationFields,
        actions: ['list', 'inspect', 'create', 'delete'],
        capabilities: {
            resourceActions: cloudformationResourceActions,
        },
        filters: cloudformationFilters,
        columns: cloudformationColumns,
    }
}

export const awsIacSchema = awsCloudFormationSchema

export function cloudformationSchemaFor(cloud: CloudProvider): ServiceSchema | null {
    if (cloud === 'aws') return awsCloudFormationSchema()
    return null
}

export const iacSchemaFor = cloudformationSchemaFor
