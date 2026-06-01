export const NODE_HORIZONTAL_SPACING = 350;
export const NODE_VERTICAL_SPACING = 200;
export const NODES_PER_ROW = 4;
export const MANAGED_NODE_X_OFFSET = 320;
export const MANAGED_NODE_Y_BASE_OFFSET = 40;
/** Match {@link NODE_VERTICAL_SPACING} so managed service cards do not overlap. */
export const MANAGED_NODE_Y_STEP = NODE_VERTICAL_SPACING;

/** Horizontal step between Terraform layout lanes (single-section TF scans). */
export const TERRAFORM_LANE_X_STEP = 400;

/** Horizontal space per section (TF lanes + optional managed column beside provider). */
export const SECTION_BLOCK_WIDTH = Math.max(
  NODES_PER_ROW * NODE_HORIZONTAL_SPACING,
  5 * TERRAFORM_LANE_X_STEP + MANAGED_NODE_X_OFFSET + 120,
);
