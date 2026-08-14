import { useState, useRef, type DragEvent, type ChangeEvent, type FormEvent } from "react";
import {
  CheckCircle2,
  Copy,
  FileCode,
  Layers,
  Loader2,
  Plus,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createCloudResource,
  uploadStorageObject,
} from "@/api/cloudProxyClient";
import { formatBytes } from "@/lib/format";
import type { CloudProvider } from "@/types/cloud";
import type { CloudResource } from "@/types/resource";

// ─── Stack Creation Form ──────────────────────────────────────────────────────

interface CreateStackFormProps {
  cloud: CloudProvider;
  region?: string;
  onSuccess: (resource: CloudResource) => void;
  onCancel: () => void;
}

export function CreateStackForm({
  cloud,
  region = "us-east-1",
  onSuccess,
  onCancel,
}: CreateStackFormProps) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stackName, setStackName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [templateBody, setTemplateBody] = useState("");
  const [s3Key, setS3Key] = useState<string | null>(null);
  const [s3Url, setS3Url] = useState<string | null>(null);
  const [isUploadingS3, setIsUploadingS3] = useState(false);
  const [s3UploadNote, setS3UploadNote] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const createMut = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      createCloudResource(cloud, "iac", values),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ["cloud-resources", cloud, "iac"] });
      onSuccess(created);
    },
  });

  async function handleFileSelected(file: File) {
    setSelectedFile(file);
    setValidationError(null);
    setS3UploadNote(null);

    // Auto-suggest stack name if not yet entered
    if (!stackName.trim()) {
      const sanitized = file.name
        .replace(/\.[^/.]+$/, "")
        .replace(/[^a-zA-Z0-9-]/g, "-")
        .replace(/^[^a-zA-Z]+/, "");
      if (sanitized) {
        setStackName(sanitized.slice(0, 128));
      }
    }

    // Read template body text in browser
    try {
      const text = await file.text();
      setTemplateBody(text);
    } catch {
      setValidationError("Failed to read the selected template file.");
      return;
    }

    // Auto-upload to local S3 bucket
    const bucketName = `cf-templates-floci-${region}`;
    const timestamp = new Date().toISOString().replace(/[:]/g, "");
    const randomSuffix = Math.random().toString(36).slice(2, 5);
    const key = `${timestamp}${randomSuffix}-${file.name}`;
    const url = `https://s3.${region}.amazonaws.com/${bucketName}/${key}`;

    setIsUploadingS3(true);
    try {
      // Ensure the template bucket exists
      try {
        await createCloudResource("aws", "storage", { bucketName, region });
      } catch {
        // Bucket might already exist, which is expected
      }

      // Upload template object
      await uploadStorageObject("aws", bucketName, key, file);
      setS3Key(key);
      setS3Url(url);
      setS3UploadNote("Uploaded to S3 template bucket");
      void qc.invalidateQueries({
        queryKey: ["cloud-resources", "aws", "storage"],
      });
    } catch (err) {
      // S3 runtime might be unavailable, but keep templateBody so creation still works
      setS3UploadNote(
        `Local S3 upload skipped (${err instanceof Error ? err.message : "S3 offline"}). Template will be sent directly via TemplateBody.`,
      );
    } finally {
      setIsUploadingS3(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      void handleFileSelected(file);
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleFileSelected(file);
    }
  }

  function handleClearFile() {
    setSelectedFile(null);
    setTemplateBody("");
    setS3Key(null);
    setS3Url(null);
    setS3UploadNote(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function copyS3Url() {
    if (!s3Url) return;
    void navigator.clipboard.writeText(s3Url);
    setCopiedUrl(true);
    window.setTimeout(() => setCopiedUrl(false), 1500);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedName = stackName.trim();

    if (!trimmedName) {
      setValidationError("Stack name is required.");
      return;
    }
    if (!/^[a-zA-Z][-a-zA-Z0-9]*$/.test(trimmedName)) {
      setValidationError(
        "Stack name must begin with an alphabetic character and contain only letters, numbers, and hyphens.",
      );
      return;
    }
    if (!templateBody) {
      setValidationError("Please select or upload a CloudFormation template file.");
      return;
    }

    setValidationError(null);
    createMut.mutate({
      stackName: trimmedName,
      templateBody,
      templateUrl: s3Url || undefined,
      region,
      capabilities: [
        "CAPABILITY_IAM",
        "CAPABILITY_NAMED_IAM",
        "CAPABILITY_AUTO_EXPAND",
      ],
    });
  }

  return (
    <form className="dynamic-form cfn-create-form" onSubmit={handleSubmit}>
      <div className="dynamic-form-group">Stack Details</div>

      <label className="dynamic-field dynamic-field--span">
        <span>
          Stack Name <em className="field-required">*</em>
        </span>
        <input
          className="input"
          value={stackName}
          onChange={(e) => {
            setStackName(e.target.value);
            setValidationError(null);
          }}
          placeholder="e.g. my-service-stack"
          required
          autoFocus
        />
        <small>
          Unique name for the CloudFormation stack (1-128 alphanumeric characters or hyphens).
        </small>
      </label>

      <div className="dynamic-form-group">Template Specification</div>

      <div className="dynamic-field dynamic-field--span">
        <span>
          Upload a template file <em className="field-required">*</em>
        </span>

        {!selectedFile ? (
          <div
            className={`template-dropzone ${isDragOver ? "dropzone-active" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".yaml,.yml,.json,.template,text/yaml,application/json,text/plain"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
            <UploadCloud size={28} className="dropzone-icon" />
            <div className="dropzone-text">
              <strong>Drag and drop template file here</strong>
              <span>or click to browse from your computer (.yaml, .yml, .json)</span>
            </div>
          </div>
        ) : (
          <div className="template-selected-box">
            <div className="file-badge">
              <FileCode size={20} className="file-badge-icon" />
              <div className="file-badge-info">
                <strong>{selectedFile.name}</strong>
                <span>{formatBytes(selectedFile.size)}</span>
              </div>
              <button
                type="button"
                className="icon-btn danger"
                onClick={handleClearFile}
                title="Remove template file"
              >
                <Trash2 size={14} />
              </button>
            </div>

            {isUploadingS3 && (
              <div className="s3-status uploading">
                <Loader2 size={13} className="spin" />
                <span>Uploading template to local S3 bucket...</span>
              </div>
            )}

            {s3Url && !isUploadingS3 && (
              <div className="s3-url-card">
                <div className="s3-url-header">
                  <span className="badge healthy">
                    <CheckCircle2 size={11} style={{ marginRight: 3 }} />
                    S3 Stored
                  </span>
                  <button
                    type="button"
                    className="button compact"
                    onClick={copyS3Url}
                    title="Copy S3 URL"
                  >
                    <Copy size={12} />
                    {copiedUrl ? "Copied" : "Copy URL"}
                  </button>
                </div>
                <div className="s3-url-text mono">{s3Url}</div>
                {s3Key && (
                  <div className="muted compact-text mono" style={{ fontSize: 10 }}>
                    Key: {s3Key}
                  </div>
                )}
              </div>
            )}

            {s3UploadNote && !s3Url && (
              <p className="muted compact-text" style={{ margin: "4px 0 0" }}>
                {s3UploadNote}
              </p>
            )}
          </div>
        )}
      </div>

      {validationError && <div className="form-error">{validationError}</div>}
      {createMut.isError && (
        <div className="form-error">
          {createMut.error instanceof Error
            ? createMut.error.message
            : "Stack creation failed"}
        </div>
      )}

      <div className="field-row" style={{ marginTop: 8 }}>
        <button
          className="button primary"
          type="submit"
          disabled={!stackName.trim() || !templateBody || isUploadingS3 || createMut.isPending}
        >
          {createMut.isPending ? (
            <>
              <Loader2 size={14} className="spin" />
              Creating stack…
            </>
          ) : (
            <>
              <Plus size={14} />
              Create stack
            </>
          )}
        </button>
        <button
          className="button"
          type="button"
          disabled={createMut.isPending}
          onClick={onCancel}
        >
          <X size={14} />
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Stack Details Deep Panel ─────────────────────────────────────────────────

interface ProvisioningPanelProps {
  cloud: CloudProvider;
  resource?: CloudResource;
  runtimeReachable?: boolean;
}

export function ProvisioningPanel({
  cloud,
  resource,
  runtimeReachable,
}: ProvisioningPanelProps) {
  const [tab, setTab] = useState<"parameters" | "outputs" | "details">("parameters");
  const [copiedId, setCopiedId] = useState(false);

  if (cloud !== "aws" || !runtimeReachable || !resource || resource.service !== "iac") {
    return null;
  }

  const metadata = resource.metadata ?? {};
  const stackId = (metadata.stackId as string) ?? resource.id;
  const description = (metadata.description as string) || null;
  const statusReason = (metadata.stackStatusReason as string) || null;
  const timeoutInMinutes = metadata.timeoutInMinutes as number | null;
  const disableRollback = metadata.disableRollback as boolean | null;
  const enableTerminationProtection = metadata.enableTerminationProtection as boolean | null;

  const parameters = Array.isArray(metadata.parameters)
    ? (metadata.parameters as Array<{
        ParameterKey?: string;
        ParameterValue?: string;
        ResolvedValue?: string;
        Description?: string;
      }>)
    : [];

  const outputs = Array.isArray(metadata.outputs)
    ? (metadata.outputs as Array<{
        OutputKey?: string;
        OutputValue?: string;
        Description?: string;
        ExportName?: string;
      }>)
    : [];

  const capabilities = Array.isArray(metadata.capabilities)
    ? (metadata.capabilities as string[])
    : [];

  const tags = Array.isArray(metadata.tags)
    ? (metadata.tags as Array<{ Key?: string; Value?: string; key?: string; value?: string }>)
    : [];

  function copyStackId() {
    void navigator.clipboard.writeText(stackId);
    setCopiedId(true);
    window.setTimeout(() => setCopiedId(false), 1500);
  }

  return (
    <section className="table-panel">
      <div className="dynamic-stage-header">
        <div>
          <p className="eyebrow">Stack Inspection</p>
          <h3>
            <Layers size={15} />
            {resource.name}
          </h3>
          {description && <p className="muted compact-text">{description}</p>}
        </div>
        <span className="badge neutral">{resource.status ?? "UNKNOWN"}</span>
      </div>

      <div className="sns-tabs" style={{ padding: "0 12px" }}>
        <button
          type="button"
          className={`sns-tab${tab === "parameters" ? " active" : ""}`}
          onClick={() => setTab("parameters")}
        >
          Parameters ({parameters.length})
        </button>
        <button
          type="button"
          className={`sns-tab${tab === "outputs" ? " active" : ""}`}
          onClick={() => setTab("outputs")}
        >
          Outputs ({outputs.length})
        </button>
        <button
          type="button"
          className={`sns-tab${tab === "details" ? " active" : ""}`}
          onClick={() => setTab("details")}
        >
          Details & Tags
        </button>
      </div>

      <div style={{ padding: 12 }}>
        {tab === "parameters" && (
          <div>
            {parameters.length === 0 ? (
              <p className="muted compact-text">No parameters defined for this stack.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Value</th>
                    <th>Resolved Value</th>
                  </tr>
                </thead>
                <tbody>
                  {parameters.map((param, i) => (
                    <tr key={param.ParameterKey ?? i}>
                      <td className="mono" style={{ fontWeight: 600 }}>
                        {param.ParameterKey}
                      </td>
                      <td className="mono">{param.ParameterValue ?? "-"}</td>
                      <td className="mono">{param.ResolvedValue ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === "outputs" && (
          <div>
            {outputs.length === 0 ? (
              <p className="muted compact-text">No outputs exported by this stack.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Value</th>
                    <th>Export Name</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {outputs.map((out, i) => (
                    <tr key={out.OutputKey ?? i}>
                      <td className="mono" style={{ fontWeight: 600 }}>
                        {out.OutputKey}
                      </td>
                      <td className="mono">{out.OutputValue ?? "-"}</td>
                      <td className="mono">{out.ExportName ?? "-"}</td>
                      <td>{out.Description ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === "details" && (
          <div className="meta-grid">
            <div className="meta-row">
              <span className="meta-label">Stack ID</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="meta-value mono" style={{ fontSize: 11 }}>
                  {stackId}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={copyStackId}
                  title="Copy Stack ID"
                >
                  <Copy size={12} />
                </button>
                {copiedId && <span className="badge healthy">Copied</span>}
              </div>
            </div>

            {statusReason && (
              <div className="meta-row">
                <span className="meta-label">Status Reason</span>
                <span className="meta-value">{statusReason}</span>
              </div>
            )}

            {timeoutInMinutes !== null && timeoutInMinutes !== undefined && (
              <div className="meta-row">
                <span className="meta-label">Timeout</span>
                <span className="meta-value">{timeoutInMinutes} minutes</span>
              </div>
            )}

            {disableRollback !== null && disableRollback !== undefined && (
              <div className="meta-row">
                <span className="meta-label">Rollback on Failure</span>
                <span className="meta-value">{disableRollback ? "Disabled" : "Enabled"}</span>
              </div>
            )}

            {enableTerminationProtection !== null && enableTerminationProtection !== undefined && (
              <div className="meta-row">
                <span className="meta-label">Termination Protection</span>
                <span className="meta-value">{enableTerminationProtection ? "Enabled" : "Disabled"}</span>
              </div>
            )}

            {capabilities.length > 0 && (
              <div className="meta-row">
                <span className="meta-label">Capabilities</span>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {capabilities.map((cap) => (
                    <span key={cap} className="badge neutral mono">
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {tags.length > 0 && (
              <div className="meta-row">
                <span className="meta-label">Tags</span>
                <div className="metadata-tags">
                  {tags.map((tag, i) => {
                    const key = tag.Key ?? tag.key ?? "";
                    const val = tag.Value ?? tag.value ?? "";
                    return (
                      <span className="metadata-tag" key={i}>
                        <strong>{key}</strong>
                        <span>{val}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// Backwards-compatible aliases
export const IacPanel = ProvisioningPanel;
export const CloudFormationPanel = ProvisioningPanel;
