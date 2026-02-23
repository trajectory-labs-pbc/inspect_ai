## Tooling {#sec-tooling}

Extensions that support the development and execution of Inspect evaluations.

| Name | Description | Author |
|------|-------------|--------|
| [Inspect Flow](https://meridianlabs-ai.github.io/inspect_flow/) | Workflow orchestration for running Inspect evaluations at scale with repeatability and maintainability. | [Meridian](https://github.com/meridianlabs-ai/inspect_flow) |
| [Evaljobs](https://github.com/dvsrepo/evaljobs) | Run evals on Hugging Face GPUs and share results and code on the Hugging Face Hub. | [Hugging Face](https://github.com/dvsrepo/evaljobs) |
| [Inspect VS Code](https://marketplace.visualstudio.com/items?itemName=ukaisi.inspect-ai) | VS Code extension that assists with developing and debugging Inspect evaluations. | [Meridian](https://github.com/meridianlabs-ai/inspect-vscode) |

## Frameworks {#sec-frameworks}

Domain-specific frameworks for building and running evaluations in areas such as cybersecurity, AI safety, and alignment.

| Name | Description | Author |
|------|-------------|--------|
| [Inspect Cyber](https://ukgovernmentbeis.github.io/inspect_cyber/) | Python package that streamlines the process of creating agentic cyber evaluations in Inspect. | [UK AISI](https://github.com/UKGovernmentBEIS/inspect_cyber) |
| [Petri](https://safety-research.github.io/petri/) | Framework for rapidly testing concrete alignment hypotheses end‑to‑end, including automatic generation of realistic audit scenarios. | [Anthropic](https://www.anthropic.com/research/petri-open-source-auditing) |
| [Control Arena](https://github.com/UKGovernmentBEIS/control-arena) | Framework for running experiments on AI Control and Monitoring. | [UK AISI](https://github.com/UKGovernmentBEIS/control-arena) |

## Suites & Agents {#sec-suites}

Pre-built benchmark suites and agent scaffolds for running standardized evaluations.

| Name | Description | Author |
|------|-------------|--------|
| [Inspect SWE](https://meridianlabs-ai.github.io/inspect_swe/) | Software engineering agents (Claude Code and Codex CLI) for Inspect. | [Meridian](https://github.com/meridianlabs-ai/inspect_swe) |
| [OpenBench](https://github.com/groq/openbench) | Standardized, reproducible benchmarking for LLMs across 30+ evals. | [Groq](https://github.com/groq) |
| [Inspect Harbor](https://github.com/meridianlabs-ai/inspect_harbor) | Run Harbor RL tasks with Inspect AI, with access to 40+ registry datasets including terminal-bench, replicationbench, and compilebench. | [Meridian](https://github.com/meridianlabs-ai/inspect_harbor) |

## Analysis {#sec-analysis}

Tools for analyzing evaluation transcripts, visualizing results, and integrating with experiment tracking platforms.

| Name | Description | Author |
|------|-------------|--------|
| [Inspect Scout](https://meridianlabs-ai.github.io/inspect_scout/) | Transcript analysis for Inspect evalutions. | [Meridian](https://github.com/meridianlabs-ai/inspect_scout) |
| [Inspect Viz](https://meridianlabs-ai.github.io/inspect_viz/) | Interactive data visualization for Inspect evalutions. | [Meridian](https://github.com/meridianlabs-ai/inspect_viz) |
| [Docent](https://docs.transluce.org/) | Tools to summarize, cluster, and search over agent transcripts. | [Transluce](https://transluce.org/introducing-docent) |
| [Lunette](https://docs.lunette.dev) | Platform for understanding and improving agents. | [Fulcrum Research](https://fulcrumresearch.ai) |
| [Inspect WandB](https://github.com/DanielPolatajko/inspect_wandb) | Integration with Weights and Biases platform. | [Arcadia](https://www.arcadiaimpact.org/) |

## Sandboxes {#sec-sandboxes}

Alternative sandbox backends for running evaluation tool calls in cloud and on-premises infrastructure.

| Name | Description | Author |
|------|-------------|--------|
| [k8s Sandbox](https://k8s-sandbox.aisi.org.uk/) | Python package that provides a Kubernetes sandbox environment for Inspect. | [UK AISI](https://github.com/UKGovernmentBEIS/inspect_k8s_sandbox) |
| [EC2 Sandbox](https://github.com/UKGovernmentBEIS/inspect_ec2_sandbox) | Python package that provides a EC2 virtual machine sandbox environment for Inspect. | [UK AISI](https://github.com/UKGovernmentBEIS/inspect_ec2_sandbox) |
| [Modal Sandbox](https://github.com/meridianlabs-ai/inspect_sandboxes/tree/main/src/inspect_sandboxes/modal) | Serverless container sandbox for Inspect using Modal's cloud infrastructure. | [Meridian](https://github.com/meridianlabs-ai/inspect_sandboxes) |
| [Proxmox Sandbox](https://github.com/UKGovernmentBEIS/inspect_proxmox_sandbox) | Use virtual machines, running within a [Proxmox](https://www.proxmox.com/en/products/proxmox-virtual-environment/overview) instance, as Inspect sandboxes. | [UK AISI](https://github.com/UKGovernmentBEIS/inspect_proxmox_sandbox) |
| [Inspect Policy Sandbox](https://github.com/Dedulus/inspect-policy-sandbox) | Policy enforced sandbox wrapper for Inspect AI that allows fine grained control over command execution and file I/O without modifying core sandbox backends. | [Arnab Mitra](https://github.com/Dedulus) |
