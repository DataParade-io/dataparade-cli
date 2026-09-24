/**
 * Demo: one connectivity gap that auto-fixes, one that remains a RED flag.
 *
 * Run (from cli/):
 *   pnpm run build && node scripts/demo-red-flags.mjs
 *
 * Local only — does not upload or push anything.
 */
const {
  applyDeterministicInferenceFallbacks,
} = require('../dist/src/ai-enrichment/fallbacks');
const {
  applyConnectivityRedFlagPass,
  collectRedFlags,
} = require('../dist/src/ai-enrichment/red-flags');
const {
  clearProviderTopologyRulesCacheForTest,
} = require('../dist/src/ai-enrichment/provider-topology-rules');

clearProviderTopologyRulesCacheForTest();

function printCase(title, before, after) {
  console.log('\n' + '='.repeat(72));
  console.log(title);
  console.log('='.repeat(72));
  console.log('\nBEFORE (components / flows):');
  console.log(
    JSON.stringify(
      {
        components: before.components.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          subType: c.subType,
          isMainApplication: c.properties?.isMainApplication,
          section_id: c.properties?.section_id,
        })),
        flows: before.flows,
      },
      null,
      2
    )
  );
  console.log('\nAFTER repair:');
  console.log(
    JSON.stringify(
      {
        components: after.components.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          subType: c.subType,
          isMainApplication: c.properties?.isMainApplication,
          section_id: c.properties?.section_id,
        })),
        flows: after.dataFlows.map((f) => ({
          id: f.id,
          from: f.sourceComponentId,
          to: f.targetComponentId,
          type: f.type,
          notes: f.enrichmentNotes ?? f.description,
        })),
        redFlags: after.redFlags,
      },
      null,
      2
    )
  );
}

// ---------------------------------------------------------------------------
// Case 1 — AUTO-FIX: lone AWS/Lambda handler in a backend section
// Fallbacks inject a hub; red-flag pass absorbs handler into Aws Lambda and
// wires hub → Aws Lambda; no leftover handler flags.
// ---------------------------------------------------------------------------
{
  const components = [
    {
      id: 'handler_lambda',
      name: 'Aws Lambda Handler',
      type: 'asset',
      subType: 'function',
      confidence: 0.9,
      detectedFrom: [{ pattern: 'lambda_handler' }],
      sourceLocations: [],
      properties: {
        section_id: 'backend',
        section_label: 'backend',
        section_role: 'service',
        handlerType: 'serverless_handler',
      },
    },
  ];
  const flows = [];

  const fallback = applyDeterministicInferenceFallbacks(components, flows);
  const after = applyConnectivityRedFlagPass(
    fallback.components,
    fallback.dataFlows
  );

  printCase(
    'CASE 1 — AUTO-FIXED (handler orphan → hub + edge; redFlags empty)',
    { components, flows },
    after
  );
}

// ---------------------------------------------------------------------------
// Case 2 — NOT auto-fixed: hub exists, but a non-handler asset stays degree-0.
// We only auto-wire handlers + orphan third parties — not arbitrary caches.
// ---------------------------------------------------------------------------
{
  const components = [
    {
      id: 'hub_backend',
      name: 'backend',
      type: 'asset',
      subType: 'application',
      confidence: 1,
      detectedFrom: [],
      sourceLocations: [],
      properties: {
        section_id: 'backend',
        section_label: 'backend',
        isMainApplication: true,
      },
    },
    {
      id: 'orphan_cache',
      name: 'Orphan Redis',
      type: 'asset',
      subType: 'cache',
      confidence: 0.9,
      detectedFrom: [],
      sourceLocations: [],
      properties: {
        section_id: 'backend',
        section_label: 'backend',
      },
    },
  ];
  const flows = [];

  // Pass through the same pipeline stages (hubs already present; no handler repair).
  const fallback = applyDeterministicInferenceFallbacks(components, flows);
  const after = applyConnectivityRedFlagPass(
    fallback.components,
    fallback.dataFlows
  );

  // If somehow empty, show raw collect for clarity.
  if (after.redFlags.length === 0) {
    after.redFlags = collectRedFlags(after.components, after.dataFlows);
  }

  printCase(
    'CASE 2 — NOT AUTO-FIXED (orphan cache → disconnected_section_node RED flag)',
    { components, flows },
    after
  );
}

console.log(
  '\nDone. Case 1 should have redFlags: []. Case 2 should list disconnected_section_node.\n'
);
