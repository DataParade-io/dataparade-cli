# AI Inference Model Recommendation

Default recommendation for initial rollout:

- primary: `openai` provider with a high-accuracy reasoning model
- fallback: `local` provider (`ollama`-compatible endpoint) for privacy/offline workflows
- development/testing: `mock` provider for deterministic CI behavior

Selection policy:

1. prefer the model with best weighted score on `tieredPropertyCompleteness` and `interactionRecall`
2. require `precisionGuardrail >= 0.85`
3. if cloud model unavailable, automatically fall back to configured local model

Run benchmarking:

```bash
pnpm --filter @dataparade/cli eval:models -- --fixture <path> --models openai:modelA,local:modelB,mock:heuristic
```

Use generated reports:

- `cli/outputs/model-eval-report.json`
- `cli/outputs/model-eval-report.md`

