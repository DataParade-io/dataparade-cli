# Terraform patterns (CLI)

The Terraform analyzer performs **static, best-effort** parsing of `.tf` and `.tfvars` files. It does **not** run `terraform` or evaluate full HCL2 (heredocs, complex expressions, and `dynamic` blocks may be incomplete).

**All matching rules** (block openers, cross-reference regexes, resource-type → `componentSubType` / `cloud_provider` hints, provider display names, and **satellite** resources folded into a parent) live in [`terraform.patterns.yaml`](terraform.patterns.yaml) and are loaded via `terraform-detection-config.ts`, consistent with `typescript.patterns.yaml` / `python.patterns.yaml`.

**AWS resource type coverage:** hand-written regex hints in YAML are merged with **`aws-terraform-service-hints.generated.json`**, produced from **`@cdktf/provider-aws`** (tracks HashiCorp **[`terraform-provider-aws`](https://github.com/hashicorp/terraform-provider-aws)** ~> 6.x) and listing **~1.7k** `aws_*` strings in **`aws-terraform-catalog.snapshot.json`**. Generated `^aws_<service>_` rows are inserted immediately before the generic `^aws_` rule so uncommon services get a sensible `componentSubType` instead of falling through to `application`.

**Azure (`azurerm`) resource type coverage:** **`azure-terraform-service-hints.generated.json`** + **`azure-terraform-catalog.snapshot.json`** come from **`@cdktf/provider-azurerm`** (~1.2k `azurerm_*` types), which tracks the upstream **[`hashicorp/terraform-provider-azurerm`](https://github.com/hashicorp/terraform-provider-azurerm)** Azure Resource Manager provider; hints are merged before **`azurerm_default_family`**. The **`azapi_*`** provider has no CDKTF package in this flow; it stays covered by the hand-written **`^azapi_`** rule in [`terraform.patterns.yaml`](terraform.patterns.yaml).

**Kubernetes resource type coverage:** **`kubernetes-terraform-service-hints.generated.json`** + **`kubernetes-terraform-catalog.snapshot.json`** come from **`@cdktf/provider-kubernetes`** (HashiCorp **`kubernetes_*`** resources for in-cluster workloads, services, ingress, secrets, PVCs, etc.); hints merge before **`kubernetes_default_family`**. Provider topology in **`provider-topology.rules.yaml`** maps **`provider "kubernetes"`** to managed nodes (workload, service, ingress, config, storage, namespace).

Regenerate all provider snapshots from `cli/` with **`pnpm run generate:terraform-provider-hints`** (or AWS / Azure / Kubernetes only — see **`cli/README.md`**).

## Pattern IDs

| Pattern ID | Meaning |
|---|---|
| `terraform_resource` | `resource` or `data` block (address `type.name` or `data.type.name`). |
| `terraform_module` | `module` block. |
| `terraform_provider` | `provider` block (emitted as a `third_party` component). |

## Finding properties (representative)

- `terraform_address`: stable resource key used for cross-reference flow edges.
- `terraform_references`: other addresses referenced from the block body (string array), including references from **merged satellite** blocks (see below).
- `terraform_satellites` (optional): when a child resource is configured as a **satellite** of a primary resource in YAML (e.g. S3 ACL / ownership controls scoped by `bucket = …`), it is **not** emitted as its own node; metadata is attached here on the parent finding.
- `resource_type`, `block_name`, `cloud_provider`, `componentSubType` (classifier hint).
- `section_id` / `section_label`: derived from the file path for layout grouping.
- After **`applyDeterministicInferenceFallbacks`** (same pipeline step as TypeScript scans), matching AWS/Azure/Kubernetes/… resources may also have **`managed_by_provider`**, **`managed_service_key`**, and **`generated_by: "provider_topology_fallback"`** when they align with `provider-topology.rules.yaml` managed service nodes (e.g. labels **Aws S3**, **Aws Lambda**, **Kubernetes workload**). This mirrors TS SDK topology and enables the same provider→managed edge styling in graph export. Resources not covered by a managed node still get a **`provider → resource`** `api_call` via **`appendTerraformBareProviderAttachmentFlows`** inside that fallback pass.

## Provider topology (parity with TypeScript)

Static Terraform scans do **not** run a second topology engine. The **same** function, **`applyDeterministicInferenceFallbacks`** (`cli/src/ai-enrichment/fallbacks.ts`), loads **`cli/patterns/provider-topology.rules.yaml`**. For **TypeScript/JavaScript**, usage signals come from **`providerUsageCorpus(provider, flows)`**. For **Terraform on AWS**, each `managedServiceNode` lists **`terraformResourceTypePrefixes`** / **`terraformResourceTypes`** (HashiCorp `aws_*` resource type names, e.g. `aws_s3_bucket`, prefix `aws_lambda_`); matching uses **`resource_type` only**, not block labels like `lambda_bucket`. Providers without those fields (e.g. Supabase) still use legacy **`usageSignals`** matching on Terraform metadata. Shared helpers: **`cli/src/ai-enrichment/provider-topology-shared.ts`**. **`componentMatchesProvider`** treats Terraform’s **`provider_name`** (e.g. `aws`) as a match key so `provider "aws"` nodes participate in the AWS rule.

- References inside `module.*` outputs are not resolved.
- Optional merge from plan/state: **`terraform show -json`** via CLI `--terraform-json` / `--terraform-plan` (see `cli/README.md` and Epic 29 task DP-P0-CLI-906).
