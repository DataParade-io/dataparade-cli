export { classifyRawFindings } from "./component-factory";
export {
  dedupeComponents,
  mergeDatabaseAssetsByType,
  compactAuthServiceComponents,
  mergeGlobalIdentityProviderThirdParties,
} from "./postprocessing";
export {
  injectApplicationAssetsPerSectionIfMissing,
  injectApplicationAssetIfMissing,
  injectActorIfMissing,
  synthesizeSectionApiNodes,
} from "./application-injection";

