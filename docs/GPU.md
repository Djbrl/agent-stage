# Running your own model on a GPU

agent-stage can rent a GPU on [NVIDIA Brev](https://brev.nvidia.com), run an open model on it with vLLM, and
destroy the machine when you're done, all from the app (Settings → Models → "My GPU (Brev + vLLM)").

**Start GPU**: creates the machine (trying several L40S-class types in order, in case one is sold out), installs
vLLM, loads the model, and opens an SSH tunnel to it. About 10–12 minutes, mostly boot and model download.
**Stop**: destroys the machine. **Auto-stop**: destroyed after 20 idle minutes (configurable), so a forgotten GPU
can't drain your credits.

## Why destroy instead of pause?
Some Brev machine types can be stopped and restarted. We measured both routes (October 2026 prices):

| | Destroy each session (default) | Pause (stoppable type) |
|---|---|---|
| GPU while running | L40S at **$1.06/h** | L40S at **$1.74/h** (Crusoe), $2.23/h (AWS) |
| While not in use | **$0** | ≈ $10–12/month of disk (Crusoe bills its 128 GB OS disk at $0.08/GiB/month) |
| Start-up | ~10–12 min (boot + install + download) | ~9 min (boot + load; the model is already on disk) |
| Risk | the type may be sold out → fall back to the next | a stopped machine can't restart if its GPU sells out; data is stuck until it does |

At three hours a day for a month, destroying costs about **$100**, pausing about **$175**. On a $100 credit that's
roughly 90 GPU hours against 50. Pausing only wins if you start and stop many times a day and every minute counts.

Sources: Brev docs ([GPU instances](https://docs.nvidia.com/brev/concepts/gpu-instances),
[console reference](https://docs.nvidia.com/brev/guides/console-reference)), Crusoe
([pricing](https://www.crusoe.ai/cloud/pricing), [billing FAQ](https://support.crusoecloud.com/hc/en-us/articles/31619771210267-FAQ-On-Demand-Billing-Questions)),
and live `brev search gpu --stoppable` output.

## Doing it by hand
`scripts/serve-vllm.sh` is the same setup the app runs: copy it to any GPU machine with SSH and run it.
