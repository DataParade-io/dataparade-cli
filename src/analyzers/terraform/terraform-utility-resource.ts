/**
 * Terraform "utility" providers (names, sleeps, etc.) should not become
 * standalone infrastructure nodes in dataflow output.
 */
export function isTerraformUtilityResourceType(resourceType: string): boolean {
  const rt = resourceType.trim();
  if (!rt) return false;
  return /^(random|time|null|tls|terraform)_/.test(rt);
}

/**
 * IAM / identity resources are properties of workloads (Lambda, ECS, etc.), not
 * separate services in the dataflow diagram.
 */
export function isTerraformIdentityInfrastructureResourceType(
  resourceType: string,
): boolean {
  const rt = resourceType.trim().toLowerCase();
  if (!rt) return false;
  return rt.startsWith("aws_iam_");
}

/** Omit from graph: utilities plus non-service identity resources. */
export function isTerraformOmittedFromServiceGraphResourceType(
  resourceType: string,
): boolean {
  return (
    isTerraformUtilityResourceType(resourceType) ||
    isTerraformIdentityInfrastructureResourceType(resourceType)
  );
}
