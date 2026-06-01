import {
  isTerraformIdentityInfrastructureResourceType,
  isTerraformOmittedFromServiceGraphResourceType,
  isTerraformUtilityResourceType,
} from "../../../../src/analyzers/terraform/terraform-utility-resource";

describe("terraform-utility-resource", () => {
  it("treats random_* as utility", () => {
    expect(isTerraformUtilityResourceType("random_string.x")).toBe(true);
    expect(isTerraformUtilityResourceType("aws_s3_bucket.x")).toBe(false);
  });

  it("treats aws_iam_* as identity (not service nodes)", () => {
    expect(isTerraformIdentityInfrastructureResourceType("aws_iam_role")).toBe(
      true,
    );
    expect(
      isTerraformIdentityInfrastructureResourceType("aws_iam_role_policy"),
    ).toBe(true);
    expect(isTerraformIdentityInfrastructureResourceType("aws_lambda_function")).toBe(
      false,
    );
  });

  it("omits utilities and IAM from service graph", () => {
    expect(isTerraformOmittedFromServiceGraphResourceType("random_id.x")).toBe(
      true,
    );
    expect(isTerraformOmittedFromServiceGraphResourceType("aws_iam_role.x")).toBe(
      true,
    );
    expect(
      isTerraformOmittedFromServiceGraphResourceType("aws_ecs_service.x"),
    ).toBe(false);
  });
});
